"use client";

import { useEffect, useState } from "react";
import { CATEGORY_LABEL } from "@/domain/labels";
import { formatWhen } from "@/domain/format";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import { ensureSampleQueue, enqueue, readDrafts, readQueue, removeOp, deleteDraft, type DraftRecord, type QueueOp } from "@/services/offline";
import { DeskFrame } from "@/ui/frame";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "The queue could not be read.";
}

export function DeviceQueue() {
  const { connectivity } = useApp();
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [queue, setQueue] = useState<QueueOp[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    await ensureSampleQueue();
    const [nextDrafts, nextQueue] = await Promise.all([readDrafts(), readQueue()]);
    setDrafts(nextDrafts);
    setQueue(nextQueue.sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt)));
  }

  useEffect(() => {
    void load().catch((caught) => setError(problem(caught)));
  }, []);

  async function send(ops: QueueOp[]) {
    if (connectivity === "offline") {
      setError("This device is offline. The queue stays here and has not been sent.");
      return;
    }
    const needsPin = ops.some((op) => op.needsPin || op.kind === "broadcast" || op.kind === "cancel");
    setBusy(true);
    setError("");
    setNote("");
    try {
      let pinToken: string | undefined;
      if (needsPin) {
        if (pin.length < 4) {
          setError("Enter your PIN. Broadcast and cancel stay queued until you confirm.");
          setBusy(false);
          return;
        }
        pinToken = (await api<{ pinToken: string }>("auth/pin", { body: { purpose: "step_up", pin } })).pinToken;
      }
      const operations = ops.map((op) => {
        const draft = drafts.find((item) => item.id === op.referralId);
        const body = op.kind === "upsert" && Object.keys(op.body).length === 0 ? (draft?.payload ?? {}) : op.body;
        return { opId: op.opId, kind: op.kind, referralId: op.referralId, body, deviceTime: new Date().toISOString() };
      });
      const result = await api<{ results: { opId: string; status: string; message?: string }[] }>("sync/referrals", { body: { operations }, pinToken });
      for (const item of result.results) {
        const op = ops.find((row) => row.opId === item.opId);
        if (!op) continue;
        if (item.status === "applied" || item.status === "duplicate") {
          await removeOp(op.opId);
          if (op.kind === "upsert") await deleteDraft(op.referralId);
        } else {
          await enqueue({ ...op, attempts: op.attempts + 1, lastError: item.message ?? "Sync failed.", hold: false });
        }
      }
      const failed = result.results.filter((item) => item.status === "error");
      setNote(failed.length ? `${failed.length} action${failed.length === 1 ? "" : "s"} stayed on this device.` : "Queued actions were handed to the simulated server.");
      setPin("");
      await load();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskFrame role="clinic">
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <h1 className="font-display text-3xl text-teal-dark">On this device</h1>
          <p className="mt-1 text-sm text-ink/70">Drafts and unsent actions live in this browser. They are not on the server until you send them. The sample referral is fictional.</p>
        </header>
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        {note ? <p className="text-sm text-moss">{note}</p> : null}
        {queue.length === 0 && drafts.length === 0 ? <p className="text-sm text-ink/60">Nothing is waiting on this device.</p> : null}
        <ul className="space-y-3">
          {queue.map((op) => {
            const draft = drafts.find((item) => item.id === op.referralId);
            const patient = (draft?.payload.patient ?? {}) as { name?: string; hospitalNumber?: string };
            const category = String(draft?.payload.category ?? "");
            return (
              <li key={op.opId} className="rounded-3xl border border-line bg-card p-4 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal">{op.hold ? "Held on this device" : op.kind}</p>
                <h2 className="mt-1 font-display text-2xl">{patient.name || patient.hospitalNumber || op.referralId}</h2>
                <p className="text-sm text-ink/70">
                  {category && category in CATEGORY_LABEL ? CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] : op.kind} · queued {formatWhen(op.enqueuedAt)}
                </p>
                {typeof draft?.payload.diagnosis === "string" ? <p className="mt-1 text-sm">{draft.payload.diagnosis}</p> : null}
                {op.lastError ? <p className="mt-2 text-sm text-amber">{op.lastError}</p> : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send([{ ...op, hold: false }])}
                  className="mt-3 rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Send now
                </button>
              </li>
            );
          })}
        </ul>
        {queue.some((op) => op.kind === "broadcast" || op.kind === "cancel" || op.needsPin) ? (
          <label className="block text-xs font-semibold text-ink/70">
            PIN for broadcast or cancel
            <input value={pin} onChange={(event) => setPin(event.target.value)} type="password" inputMode="numeric" className="mt-1 w-40 rounded-xl border border-line bg-white px-3 py-2 text-sm" />
          </label>
        ) : null}
      </div>
    </DeskFrame>
  );
}
