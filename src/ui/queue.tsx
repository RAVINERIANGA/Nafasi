"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Category } from "@/domain/types";
import { CATEGORY_LABEL } from "@/domain/labels";
import { cx, formatClock, formatDuration, formatWhen } from "@/domain/format";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import {
  OFFLINE_EVENT,
  appendSyncReceipts,
  computeBackoffMs,
  deleteDraft,
  enqueue,
  ensureSampleQueue,
  newOpId,
  readDrafts,
  readQueue,
  readSyncReceipts,
  removeOp,
  type DraftRecord,
  type QueueOp,
  type SyncReceipt,
} from "@/services/offline";
import { ConnectivityBanner, PinStepUpField, problemMessage } from "@/ui/clinic-helpers";
import { SmsFallbackModal, type SmsPreviewInput } from "@/ui/sms-preview";
import { DeskFrame } from "@/ui/frame";

const OP_LABEL: Record<QueueOp["kind"], string> = {
  upsert: "New / updated referral",
  broadcast: "Emergency broadcast",
  vitals: "Vital observation",
  cancel: "Cancellation",
};

function draftSummary(draft?: DraftRecord, op?: QueueOp) {
  const payload = draft?.payload ?? {};
  const patient = (payload.patient ?? {}) as Record<string, unknown>;
  const rawCategory = op?.summary?.category ?? payload.category;
  const category =
    typeof rawCategory === "string" && rawCategory in CATEGORY_LABEL
      ? (rawCategory as Category)
      : undefined;
  const hospitalNumber =
    op?.summary?.hospitalNumber ??
    (typeof patient.hospitalNumber === "string" ? patient.hospitalNumber : undefined);
  const patientName =
    op?.summary?.patientName ??
    (typeof patient.name === "string" ? patient.name : undefined);
  const diagnosis =
    op?.summary?.diagnosis ??
    (typeof payload.diagnosis === "string" ? payload.diagnosis : undefined);

  return { category, hospitalNumber, patientName, diagnosis };
}

function buildSmsInput(
  referralId: string,
  draft?: DraftRecord,
  op?: QueueOp,
  facilityCode?: string,
  userCode?: string,
): SmsPreviewInput {
  const summary = draftSummary(draft, op);
  const payload = draft?.payload ?? {};
  const patient = (payload.patient ?? {}) as Record<string, unknown>;
  const vitals = Array.isArray(payload.vitals) ? (payload.vitals as Record<string, unknown>[]) : [];
  const lastVital = vitals.at(-1) ?? (op?.kind === "vitals" ? op.body : undefined);

  return {
    referralId,
    category: summary.category ?? "other",
    hospitalNumber: summary.hospitalNumber,
    age: typeof patient.age === "number" || typeof patient.age === "string" ? patient.age : undefined,
    ageUnit: patient.ageUnit === "months" ? "months" : "years",
    sex: typeof patient.sex === "string" ? patient.sex : undefined,
    diagnosis: summary.diagnosis,
    vital: lastVital
      ? {
          systolic: lastVital.systolic as number | string | undefined,
          diastolic: lastVital.diastolic as number | string | undefined,
          pulse: lastVital.pulse as number | string | undefined,
          spo2: lastVital.spo2 as number | string | undefined,
          avpu: lastVital.avpu as string | undefined,
        }
      : undefined,
    facilityCode,
    userCode,
  };
}

export function DeviceQueue() {
  const router = useRouter();
  const { connectivity, session } = useApp();
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [queue, setQueue] = useState<QueueOp[]>([]);
  const [receipts, setReceipts] = useState<SyncReceipt[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);
  const [smsTarget, setSmsTarget] = useState<SmsPreviewInput | null>(null);

  const sendingRef = useRef(false);

  const load = useCallback(async () => {
    await ensureSampleQueue();
    const [nextDrafts, nextQueue] = await Promise.all([readDrafts(), readQueue()]);
    const facId = session?.facility.id;
    setDrafts(
      nextDrafts
        .filter((d) => !facId || !d.facilityId || d.facilityId === facId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
    setQueue(
      nextQueue
        .filter((o) => !facId || !o.facilityId || o.facilityId === facId)
        .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt)),
    );
    setReceipts(readSyncReceipts(facId));
  }, [session?.facility.id]);

  useEffect(() => {
    void load().catch((caught) => setError(problemMessage(caught, "The queue could not be read.")));
  }, [load]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener(OFFLINE_EVENT, handler);
    return () => window.removeEventListener(OFFLINE_EVENT, handler);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const send = useCallback(
    async (requestedOps: QueueOp[], automatic = false) => {
      if (sendingRef.current) return;
      if (!requestedOps.length) return;
      if (connectivity === "offline") {
        if (!automatic) setError("This device is offline. Items stay queued here and have NOT been sent.");
        return;
      }

      // Include prerequisite pending upsert ops for the same referralId in chronological order
      const allQueue = await readQueue();
      const opMap = new Map<string, QueueOp>();
      for (const op of requestedOps) {
        for (const dep of allQueue) {
          if (dep.referralId === op.referralId && dep.kind === "upsert" && dep.enqueuedAt <= op.enqueuedAt) {
            opMap.set(dep.opId, { ...dep, hold: false });
          }
        }
        opMap.set(op.opId, { ...op, hold: false });
      }
      const ops = [...opMap.values()].sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));

      const needsPin = ops.some((op) => op.needsPin || op.kind === "broadcast" || op.kind === "cancel");
      if (needsPin && pin.length < 4) {
        if (!automatic) {
          setError("Enter your 4+ digit PIN below before sending a queued broadcast or cancellation.");
        }
        return;
      }

      sendingRef.current = true;
      setBusy(true);
      if (!automatic) {
        setError("");
        setNote("");
      }

      const currentDrafts = await readDrafts();

      try {
        let pinToken: string | undefined;
        if (needsPin) {
          pinToken = (await api<{ pinToken: string }>("auth/pin", { body: { purpose: "step_up", pin } })).pinToken;
        }

        const operations = ops.map((op) => {
          const draft = currentDrafts.find((item) => item.id === op.referralId);
          const body = op.kind === "upsert" && Object.keys(op.body).length === 0 ? (draft?.payload ?? {}) : op.body;
          return {
            opId: op.opId,
            kind: op.kind,
            referralId: op.referralId,
            body,
            deviceTime: new Date().toISOString(),
          };
        });

        const result = await api<{ results: { opId: string; status: string; message?: string }[] }>("sync/referrals", {
          body: { operations },
          pinToken,
        });

        const nextReceipts: SyncReceipt[] = [];
        const attemptIso = new Date().toISOString();

        for (const item of result.results) {
          const op = ops.find((row) => row.opId === item.opId);
          if (!op) continue;
          if (item.status === "applied" || item.status === "duplicate") {
            await removeOp(op.opId);
            const stillQueuedForReferral = (await readQueue()).some((q) => q.referralId === op.referralId);
            if (op.kind === "upsert" && !stillQueuedForReferral) {
              await deleteDraft(op.referralId);
            }
            nextReceipts.push({
              opId: op.opId,
              referralId: op.referralId,
              kind: op.kind,
              status: item.status === "duplicate" ? "duplicate" : "applied",
              deliveryLabel:
                op.kind === "broadcast"
                  ? "Sent (server queued broadcast for gateway ack)"
                  : "Sent (server acknowledged)",
              acknowledgedAt: attemptIso,
              facilityId: session?.facility.id,
              summary: op.summary,
            });
          } else {
            const nextAttempts = op.attempts + 1;
            await enqueue({
              ...op,
              attempts: nextAttempts,
              lastAttemptAt: attemptIso,
              nextAttemptAt: Date.now() + computeBackoffMs(nextAttempts),
              lastError: item.message ?? "Simulated server rejected sync.",
              hold: false,
            });
          }
        }

        if (nextReceipts.length) {
          appendSyncReceipts(nextReceipts);
        }

        const failedCount = result.results.filter((item) => item.status === "error").length;
        const okCount = nextReceipts.length;
        if (failedCount > 0) {
          setError(`${failedCount} queued ${failedCount === 1 ? "action" : "actions"} failed and stayed on this device.`);
        }
        if (okCount > 0) {
          setNote(
            `${okCount} ${okCount === 1 ? "action" : "actions"} acknowledged by the simulated server (idempotent UUID preserved).`,
          );
          if (needsPin) setPin("");
        }
        await load();
      } catch (caught) {
        const attemptIso = new Date().toISOString();
        const message = problemMessage(caught, "Sync failed.");
        // Record retry backoff on non-PIN errors or OfflineError without losing items
        if (caught instanceof OfflineError || (caught instanceof ApiClientError && caught.code !== "PIN_INVALID" && caught.code !== "PIN_REQUIRED")) {
          for (const op of ops) {
            const nextAttempts = op.attempts + 1;
            await enqueue({
              ...op,
              attempts: nextAttempts,
              lastAttemptAt: attemptIso,
              nextAttemptAt: Date.now() + computeBackoffMs(nextAttempts),
              lastError: message,
            });
          }
          await load();
        }
        if (!automatic || !(caught instanceof OfflineError)) {
          setError(message);
        }
      } finally {
        sendingRef.current = false;
        setBusy(false);
      }
    },
    [connectivity, pin, load, session?.facility.id],
  );

  // Automatic background backoff retry for non-PIN, unheld queued items when online
  useEffect(() => {
    if (connectivity === "offline" || !session || session.user.role !== "clinic") return;
    const interval = setInterval(() => {
      if (sendingRef.current) return;
      const due = queue.filter(
        (op) =>
          !op.hold &&
          !op.needsPin &&
          op.kind !== "broadcast" &&
          op.kind !== "cancel" &&
          op.nextAttemptAt <= Date.now(),
      );
      if (due.length > 0) {
        void send(due, true);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [connectivity, session, queue, send]);

  async function queueStandaloneDraft(draft: DraftRecord) {
    if (!session) return;
    const summary = draftSummary(draft);
    await enqueue({
      opId: newOpId(),
      kind: "upsert",
      referralId: draft.id,
      body: draft.payload,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: Date.now(),
      hold: false,
      facilityId: session.facility.id,
      userId: session.user.id,
      summary,
      lastError: "Queued on this device. Not sent.",
    });
    await load();
    setNote("Draft moved to the outbound queue (Queued: not sent).");
  }

  async function discardQueuedItem(op: QueueOp) {
    await removeOp(op.opId);
    const remaining = (await readQueue()).some((item) => item.referralId === op.referralId);
    if (!remaining && op.kind === "upsert") {
      await deleteDraft(op.referralId);
    }
    setConfirmDiscardId(null);
    await load();
    setNote("Queued item discarded from this device.");
  }

  async function discardDraftOnly(draftId: string) {
    await deleteDraft(draftId);
    setConfirmDiscardId(null);
    await load();
    setNote("Local draft discarded.");
  }

  const standaloneDrafts = drafts.filter((d) => !queue.some((op) => op.referralId === d.id));
  const requiresPinOps = queue.some((op) => op.needsPin || op.kind === "broadcast" || op.kind === "cancel");
  const readyNonPinOps = queue.filter((op) => !op.hold && !op.needsPin && op.kind !== "broadcast" && op.kind !== "cancel");

  return (
    <DeskFrame role="clinic">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/clinic" className="text-sm font-semibold text-teal hover:underline">
            ← Back to referrals
          </Link>
          {readyNonPinOps.length > 0 && connectivity !== "offline" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(readyNonPinOps)}
              className="min-h-[42px] rounded-full bg-teal px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Syncing…" : `Retry all ready (${readyNonPinOps.length})`}
            </button>
          ) : null}
        </div>

        <header>
          <h1 className="font-display text-3xl text-teal-dark">On this device</h1>
          <p className="mt-1 text-sm text-ink/70">
            Drafts and queued actions live in browser IndexedDB with idempotent client UUIDs. Nothing is shown as sent until the simulated server acknowledges it.
          </p>
        </header>

        <ConnectivityBanner
          connectivity={connectivity}
          queueCount={queue.length}
          draftCount={standaloneDrafts.length}
          showQueueLink={false}
        />

        {error ? <p className="rounded-2xl bg-clay/10 px-4 py-3 text-sm font-semibold text-clay">{error}</p> : null}
        {note ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-semibold text-teal-dark">{note}</p> : null}

        {requiresPinOps ? (
          <div className="rounded-2xl border border-amber/35 bg-amber/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber">PIN required for queued broadcast or cancel</p>
            <p className="mt-1 text-xs text-ink/80">
              Queued broadcasts and cancellations never auto-send without your clinician PIN step-up.
            </p>
            <div className="mt-3">
              <PinStepUpField
                id="queue-stepup-pin"
                value={pin}
                onChange={setPin}
                label="Enter PIN before tapping Retry now on broadcast/cancel"
              />
            </div>
          </div>
        ) : null}

        {/* Outbound Queue */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Outbound queue ({queue.length})
            </h2>
            <span className="text-xs text-ink/55">Status: Queued (not sent)</span>
          </div>

          {queue.length === 0 ? (
            <p className="rounded-2xl border border-line bg-card p-4 text-sm text-ink/65">
              No queued actions waiting to sync.
            </p>
          ) : (
            <ul className="space-y-3">
              {queue.map((op) => {
                const draft = drafts.find((item) => item.id === op.referralId);
                const summary = draftSummary(draft, op);
                const needsPin = Boolean(op.needsPin || op.kind === "broadcast" || op.kind === "cancel");
                const retryInSec =
                  !op.hold && !needsPin && op.nextAttemptAt > nowMs
                    ? Math.ceil((op.nextAttemptAt - nowMs) / 1000)
                    : 0;

                return (
                  <li key={op.opId} className="rounded-3xl border border-line bg-card p-4 shadow-card space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center rounded-full border border-amber/35 bg-amber/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber">
                        {op.hold ? "Held draft (not sent)" : "Queued: not sent"}
                      </span>
                      <span className="font-mono text-[11px] text-ink/55">
                        {op.referralId.slice(0, 12)} · {op.opId.slice(0, 10)}
                      </span>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-teal">
                        {OP_LABEL[op.kind]}
                        {summary.category ? ` · ${CATEGORY_LABEL[summary.category]}` : ""}
                      </p>
                      <h3 className="mt-0.5 font-display text-2xl text-ink">
                        {summary.patientName || summary.hospitalNumber || op.referralId}
                      </h3>
                      {summary.hospitalNumber && summary.patientName ? (
                        <p className="font-mono text-xs text-ink/65">ref {summary.hospitalNumber}</p>
                      ) : null}
                      {summary.diagnosis ? <p className="mt-1 text-sm text-ink/85">{summary.diagnosis}</p> : null}
                    </div>

                    <dl className="grid grid-cols-2 gap-2 rounded-2xl bg-paper/70 px-3 py-2 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="text-ink/55">Queued</dt>
                        <dd className="font-medium text-ink">{formatWhen(op.enqueuedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink/55">Attempts</dt>
                        <dd className="font-medium text-ink">
                          {op.attempts}
                          {op.lastAttemptAt ? ` · last ${formatClock(op.lastAttemptAt)}` : ""}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-ink/55">Retry state</dt>
                        <dd className="font-medium text-ink">
                          {connectivity === "offline"
                            ? "Waiting for link"
                            : op.hold
                              ? "Manual send only"
                              : needsPin
                                ? "Needs PIN to send"
                                : retryInSec > 0
                                  ? `Auto-retry in ${formatDuration(retryInSec)}`
                                  : "Ready now"}
                        </dd>
                      </div>
                    </dl>

                    {op.lastError ? (
                      <p className="rounded-xl bg-amber/10 px-3 py-2 text-xs text-ink">{op.lastError}</p>
                    ) : null}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy || connectivity === "offline" || (needsPin && pin.length < 4)}
                        onClick={() => void send([op])}
                        className="min-h-[44px] rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
                      >
                        {op.attempts > 0 ? "Retry now" : "Send now"}
                      </button>

                      {draft ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/clinic?draft=${encodeURIComponent(draft.id)}`)}
                          className="min-h-[44px] rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-ink"
                        >
                          Edit draft
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() =>
                          setSmsTarget(
                            buildSmsInput(
                              op.referralId,
                              draft,
                              op,
                              session?.facility.shortName,
                              session?.user.registrationNumber,
                            ),
                          )
                        }
                        className="min-h-[44px] rounded-full border border-line bg-paper px-4 py-2 text-xs font-semibold text-ink"
                      >
                        Compressed SMS preview
                      </button>

                      {confirmDiscardId === op.opId ? (
                        <button
                          type="button"
                          onClick={() => void discardQueuedItem(op)}
                          className="min-h-[44px] rounded-full bg-clay px-4 py-2 text-xs font-semibold text-white"
                        >
                          Confirm discard
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDiscardId(op.opId)}
                          className="min-h-[44px] rounded-full border border-line bg-white px-3.5 py-2 text-xs font-semibold text-clay"
                        >
                          Discard
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Local Autosave / Unqueued Drafts */}
        {standaloneDrafts.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Local drafts not queued yet ({standaloneDrafts.length})
            </h2>
            <ul className="space-y-2.5">
              {standaloneDrafts.map((draft) => {
                const summary = draftSummary(draft);
                return (
                  <li key={draft.id} className="rounded-3xl border border-line bg-card p-4 shadow-card space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-[11px] font-semibold text-ink/75">
                        Draft (local only)
                      </span>
                      <span className="text-xs text-ink/60">Saved {formatWhen(draft.updatedAt)}</span>
                    </div>
                    <p className="font-display text-xl text-ink">
                      {summary.patientName || summary.hospitalNumber || "Untitled draft"}
                    </p>
                    <p className="text-xs text-ink/70">
                      {summary.category ? CATEGORY_LABEL[summary.category] : "Uncategorised"}
                      {summary.diagnosis ? ` · ${summary.diagnosis}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => router.push(`/clinic?draft=${encodeURIComponent(draft.id)}`)}
                        className="min-h-[44px] rounded-full bg-teal px-4 py-2 text-xs font-semibold text-white"
                      >
                        Resume in wizard
                      </button>
                      <button
                        type="button"
                        onClick={() => void queueStandaloneDraft(draft)}
                        className="min-h-[44px] rounded-full border border-teal/40 bg-mist px-4 py-2 text-xs font-semibold text-teal-dark"
                      >
                        Move to send queue
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSmsTarget(
                            buildSmsInput(
                              draft.id,
                              draft,
                              undefined,
                              session?.facility.shortName,
                              session?.user.registrationNumber,
                            ),
                          )
                        }
                        className="min-h-[44px] rounded-full border border-line bg-paper px-3.5 py-2 text-xs font-semibold text-ink"
                      >
                        SMS preview
                      </button>
                      {confirmDiscardId === draft.id ? (
                        <button
                          type="button"
                          onClick={() => void discardDraftOnly(draft.id)}
                          className="min-h-[44px] rounded-full bg-clay px-3.5 py-2 text-xs font-semibold text-white"
                        >
                          Confirm discard
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDiscardId(draft.id)}
                          className="min-h-[44px] rounded-full border border-line bg-white px-3.5 py-2 text-xs font-semibold text-clay"
                        >
                          Discard
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {/* Synced this session */}
        {receipts.length > 0 ? (
          <section className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
              Acknowledged by server this session ({receipts.length})
            </h2>
            <ul className="space-y-2">
              {receipts.map((receipt) => (
                <li
                  key={`${receipt.opId}-${receipt.acknowledgedAt}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-moss/30 bg-moss/10 px-4 py-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-moss">
                      {receipt.deliveryLabel}
                      {receipt.status === "duplicate" ? " (idempotent replay)" : ""}
                    </p>
                    <p className="mt-0.5 text-ink/80">
                      {OP_LABEL[receipt.kind]} · {receipt.summary?.hospitalNumber || receipt.referralId} ·{" "}
                      {formatClock(receipt.acknowledgedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      sessionStorage.setItem("nafasi-open-referral", receipt.referralId);
                      router.push("/clinic");
                    }}
                    className="min-h-[38px] rounded-full border border-moss/40 bg-white px-3.5 py-1.5 text-xs font-semibold text-moss"
                  >
                    Open referral
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {smsTarget ? (
        <SmsFallbackModal open={true} input={smsTarget} onClose={() => setSmsTarget(null)} />
      ) : null}
    </DeskFrame>
  );
}
