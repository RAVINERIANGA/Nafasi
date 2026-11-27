"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { BroadcastMode, RankedFacility } from "@/domain/types";
import { ageLabel, cx, formatKm, vitalLine } from "@/domain/format";
import { CATEGORY_LABEL, DELIVERY_LABEL, STATUS_LABEL } from "@/domain/labels";
import { OfflineError, api } from "@/services/api";
import { enqueue, newOpId } from "@/services/offline";
import { useApp } from "@/services/provider";
import {
  ConnectivityBanner,
  DeliveryBadge,
  PinStepUpField,
  StatusBadge,
  problemMessage,
} from "@/ui/clinic-helpers";
import { SmsFallbackModal } from "@/ui/sms-preview";
import { DeskFrame } from "@/ui/frame";
import type { PresentedReferral } from "@/ui/types";

type Preview = {
  mode: BroadcastMode;
  ranked: RankedFacility[];
  selected: string[];
  note: string;
};

export function RoutingReview({ referralId }: { referralId: string }) {
  const router = useRouter();
  const { connectivity, session } = useApp();
  const [referral, setReferral] = useState<PresentedReferral | null>(null);
  const [mode, setMode] = useState<BroadcastMode>("single");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [broadcastPendingAck, setBroadcastPendingAck] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);

  const loadReferral = useCallback(async () => {
    if (!session || session.user.role !== "clinic" || connectivity === "offline") {
      setLoading(false);
      return;
    }
    try {
      const row = await api<PresentedReferral>(`referrals/${referralId}`);
      setReferral(row);
      setError("");
    } catch (caught) {
      setError(problemMessage(caught, "Could not load referral details."));
    } finally {
      setLoading(false);
    }
  }, [session, referralId, connectivity]);

  useEffect(() => {
    if (session?.config.defaultBroadcastMode) {
      setMode(session.config.defaultBroadcastMode);
    }
  }, [session?.config.defaultBroadcastMode]);

  useEffect(() => {
    void loadReferral();
  }, [loadReferral]);

  useEffect(() => {
    if (!referral || connectivity === "offline") return;
    if (referral.status !== "PREPARING" && referral.status !== "ESCALATED") return;
    setLoadingPreview(true);
    api<Preview>(`referrals/${referral.id}/routing?mode=${mode}`)
      .then((data) => {
        setPreview(data);
        setError("");
      })
      .catch((caught) => setError(problemMessage(caught, "The simulated server could not rank hospitals.")))
      .finally(() => setLoadingPreview(false));
  }, [referral, mode, connectivity]);

  // Watch live gateway acknowledgement if we just initiated broadcast
  useEffect(() => {
    if (!broadcastPendingAck || !referral || connectivity === "offline" || !session?.token) return;
    if (referral.status !== "BROADCASTING" && referral.delivery !== "queued" && referral.delivery !== "sent") {
      return;
    }
    const source = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
    const refresh = () => void loadReferral();
    source.addEventListener("referral.updated", refresh);
    const poll = setInterval(refresh, 1000);
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, [broadcastPendingAck, referral, connectivity, session?.token, loadReferral]);

  async function queueBroadcastOffline() {
    if (!referral || !session) return;
    await enqueue({
      opId: newOpId(),
      kind: "broadcast",
      referralId: referral.id,
      body: { mode },
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: Date.now(),
      needsPin: true,
      facilityId: session.facility.id,
      userId: session.user.id,
      summary: {
        category: referral.category,
        hospitalNumber: referral.patient.hospitalNumber,
        patientName: referral.patient.name,
        diagnosis: referral.diagnosis,
        mode,
      },
      lastError: "Broadcast queued on this device while offline. Enter PIN in On this device when ready.",
    });
    setNote("Broadcast queued on this device (Queued: not sent). Go to On this device when connectivity returns.");
  }

  async function broadcast() {
    if (!referral) return;
    if (connectivity === "offline") {
      await queueBroadcastOffline();
      return;
    }
    setBusy(true);
    setError("");
    setNote("Contacting simulated server — broadcast pending acknowledgement…");
    try {
      const grant = await api<{ pinToken: string }>("auth/pin", { body: { purpose: "step_up", pin } });
      const result = await api<{ referral: PresentedReferral }>(`referrals/${referral.id}/broadcast`, {
        body: { mode },
        pinToken: grant.pinToken,
      });
      setReferral(result.referral);
      setPin("");
      if (result.referral.status === "ESCALATED") {
        setBroadcastPendingAck(false);
        setNote("No eligible hospital had verified matching capacity. The referral was escalated to regional dispatch.");
      } else {
        setBroadcastPendingAck(true);
        setNote("Broadcast queued on server. Waiting for simulated gateway acknowledgement before marking Sent.");
      }
    } catch (caught) {
      if (caught instanceof OfflineError) {
        await queueBroadcastOffline();
      } else {
        setNote("");
        setError(problemMessage(caught, "Broadcast could not be submitted."));
      }
    } finally {
      setBusy(false);
    }
  }

  function openInTracking() {
    if (referral) sessionStorage.setItem("nafasi-open-referral", referral.id);
    router.push("/clinic");
  }

  const open = referral && (referral.status === "PREPARING" || referral.status === "ESCALATED");
  const missingVitals = referral ? referral.vitals.length === 0 : false;
  const limit = mode === "parallel" ? session?.config.parallelOfferLimit ?? 3 : 1;
  const latestVital = referral?.vitals.at(-1);

  return (
    <DeskFrame role="clinic">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/clinic" className="text-sm font-semibold text-teal hover:underline">
            ← Back to referrals
          </Link>
          {referral ? (
            <button
              type="button"
              onClick={() => setSmsOpen(true)}
              className="min-h-[40px] rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-semibold text-ink"
            >
              Compressed SMS preview
            </button>
          ) : null}
        </div>

        <header>
          <h1 className="font-display text-3xl text-teal-dark">Routing review & broadcast</h1>
          <p className="mt-1 text-sm text-ink/70">
            Hospital ranking uses category, required capabilities, distance, and the last confirmed capacity. Predictions are never used.
          </p>
        </header>

        <ConnectivityBanner connectivity={connectivity} queueCount={0} draftCount={0} />

        {loading ? (
          <div className="h-32 animate-pulse rounded-3xl border border-line bg-card/60" />
        ) : null}

        {error ? <p className="rounded-2xl bg-clay/10 px-4 py-3 text-sm font-semibold text-clay">{error}</p> : null}
        {note ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-semibold text-teal-dark">{note}</p> : null}

        {referral ? (
          <article className="space-y-3 rounded-3xl border border-line bg-card p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={referral.status} />
                <DeliveryBadge delivery={referral.delivery} />
              </div>
              <span className="font-mono text-xs text-ink/60">ref {referral.patient.hospitalNumber}</span>
            </div>
            <div>
              <h2 className="font-display text-2xl text-teal-dark">
                {referral.patient.name ?? referral.patient.hospitalNumber}
              </h2>
              <p className="text-sm text-ink/75">
                {CATEGORY_LABEL[referral.category]} · {ageLabel(referral.patient.age, referral.patient.ageUnit)} · {referral.diagnosis}
              </p>
              <p className="mt-1 text-xs font-semibold text-ink/70">{vitalLine(latestVital)}</p>
            </div>

            {/* Live delivery status tracker after broadcasting */}
            {(broadcastPendingAck || referral.status === "BROADCASTING" || referral.delivery === "failed") ? (
              <div
                className={cx(
                  "rounded-2xl border p-4 text-sm space-y-2",
                  referral.delivery === "failed"
                    ? "border-clay/35 bg-clay/10 text-clay"
                    : referral.delivery === "delivered"
                      ? "border-moss/35 bg-moss/10 text-moss"
                      : "border-amber/35 bg-amber/10 text-ink",
                )}
              >
                <p className="font-semibold">
                  {DELIVERY_LABEL[referral.delivery]} · {STATUS_LABEL[referral.status]}
                </p>
                <p className="text-xs text-ink/80">
                  {referral.delivery === "queued"
                    ? "Queued on the simulated server — not yet marked Sent until gateway acknowledges."
                    : referral.delivery === "sent"
                      ? "Gateway acknowledged — delivering alert to receiving hospital channel."
                      : referral.delivery === "delivered"
                        ? "Receiving hospital channel confirmed receipt. Waiting for bed acceptance."
                        : referral.delivery === "failed"
                          ? "Simulated gateway failed to acknowledge. Referral reverted to Preparing so you can retry or use compressed SMS fallback."
                          : "Broadcast status updated."}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={openInTracking}
                    className="min-h-[44px] rounded-full bg-teal px-4 py-2 text-xs font-semibold text-white"
                  >
                    Open referral tracking
                  </button>
                  {referral.delivery === "failed" ? (
                    <button
                      type="button"
                      onClick={() => setSmsOpen(true)}
                      className="min-h-[44px] rounded-full border border-line bg-white px-4 py-2 text-xs font-semibold text-ink"
                    >
                      Open SMS fallback
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </article>
        ) : null}

        {referral && !open && !broadcastPendingAck ? (
          <div className="rounded-2xl border border-line bg-card p-4 text-sm text-ink/75 space-y-3">
            <p>
              This referral is currently <span className="font-semibold">{STATUS_LABEL[referral.status]}</span>. Routing selection is closed.
            </p>
            <button
              type="button"
              onClick={openInTracking}
              className="min-h-[44px] rounded-full bg-teal px-4 py-2 text-xs font-semibold text-white"
            >
              View referral tracking
            </button>
          </div>
        ) : null}

        {open && connectivity === "offline" ? (
          <div className="rounded-3xl border border-clay/30 bg-clay/10 p-5 space-y-3">
            <p className="font-semibold text-clay">Device is offline — hospital ranking unavailable</p>
            <p className="text-xs text-ink/80">
              You can queue this broadcast locally on this device (it stays in Queued: not sent until connectivity returns) or generate a compressed SMS preview.
            </p>
            <div className="flex flex-wrap gap-2">
              {referral ? (
                <button
                  type="button"
                  onClick={() => void queueBroadcastOffline()}
                  className="min-h-[46px] rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white"
                >
                  Queue broadcast on this device
                </button>
              ) : null}
              <Link
                href="/clinic/queue"
                className="inline-flex min-h-[46px] items-center rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink"
              >
                Open device queue
              </Link>
            </div>
          </div>
        ) : null}

        {open && connectivity !== "offline" ? (
          <section className="space-y-4">
            {missingVitals ? (
              <div className="rounded-2xl border border-clay/35 bg-clay/10 p-4 text-sm text-clay space-y-2">
                <p className="font-semibold">Record at least one vital sign before broadcasting.</p>
                <button
                  type="button"
                  onClick={openInTracking}
                  className="min-h-[42px] rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-ink border border-line"
                >
                  Open referral to add vitals
                </button>
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={cx(
                  "min-h-[56px] rounded-2xl border px-4 py-3 text-left text-sm",
                  mode === "single" ? "border-teal bg-mist font-semibold text-teal-dark ring-1 ring-teal" : "border-line bg-card text-ink/80",
                )}
              >
                <span className="block">Nearest eligible (1 hospital)</span>
                <span className="text-xs font-normal opacity-75">Auto-reroutes if declined or timed out</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("parallel")}
                className={cx(
                  "min-h-[56px] rounded-2xl border px-4 py-3 text-left text-sm",
                  mode === "parallel" ? "border-teal bg-mist font-semibold text-teal-dark ring-1 ring-teal" : "border-line bg-card text-ink/80",
                )}
              >
                <span className="block">Parallel (up to {session?.config.parallelOfferLimit ?? 3} at once)</span>
                <span className="text-xs font-normal opacity-75">First bed lock wins; others withdrawn</span>
              </button>
            </div>

            <p className="text-xs text-ink/65">
              This broadcast would offer {limit === 1 ? "one eligible hospital" : `up to ${limit} eligible hospitals`}.{" "}
              {preview?.note ?? ""}
            </p>

            {loadingPreview ? (
              <div className="space-y-2">
                {[1, 2, 3].map((k) => (
                  <div key={k} className="h-24 animate-pulse rounded-2xl border border-line bg-card/60" />
                ))}
              </div>
            ) : (
              <ul className="space-y-2.5">
                {(preview?.ranked ?? []).map((item) => {
                  const offered = preview?.selected.includes(item.facilityId);
                  return (
                    <li
                      key={item.facilityId}
                      className={cx(
                        "rounded-2xl border px-4 py-3.5",
                        offered ? "border-teal bg-mist" : item.eligible ? "border-line bg-card" : "border-line bg-paper/70 opacity-85",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold text-ink">{item.name}</p>
                        <span
                          className={cx(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                            offered
                              ? "bg-teal text-white"
                              : item.eligible
                                ? "bg-moss/10 text-moss"
                                : "bg-paper text-ink/60",
                          )}
                        >
                          {offered ? "Will be offered" : item.eligible ? "Eligible backup" : "Not eligible"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink/75">
                        {formatKm(item.distanceKm)} · ETA {item.etaMin} min · {item.availableBeds} matching{" "}
                        {item.availableBeds === 1 ? "bed" : "beds"}
                        {item.capacityStale ? (
                          <span className="ml-2 rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">
                            Capacity stale
                          </span>
                        ) : null}
                      </p>
                      <ul className="mt-2 list-disc pl-5 text-xs text-ink/70 space-y-0.5">
                        {item.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="space-y-3 rounded-3xl border border-line bg-card p-4 shadow-card">
              <PinStepUpField
                id="routing-broadcast-pin"
                value={pin}
                onChange={setPin}
                label="Confirm broadcast with clinician PIN"
              />
              <button
                type="button"
                disabled={busy || pin.length < 4 || !preview || missingVitals}
                onClick={() => void broadcast()}
                className="min-h-[50px] w-full rounded-full bg-clay px-5 py-2.5 text-sm font-bold text-white hover:bg-clay/90 disabled:opacity-45 sm:w-auto"
              >
                {busy ? "Sending broadcast (pending ack)…" : "BROADCAST EMERGENCY"}
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {referral ? (
        <SmsFallbackModal
          open={smsOpen}
          onClose={() => setSmsOpen(false)}
          input={{
            referralId: referral.id,
            category: referral.category,
            hospitalNumber: referral.patient.hospitalNumber,
            age: referral.patient.age,
            ageUnit: referral.patient.ageUnit,
            sex: referral.patient.sex,
            diagnosis: referral.diagnosis,
            vital: latestVital
              ? {
                  systolic: latestVital.systolic,
                  diastolic: latestVital.diastolic,
                  pulse: latestVital.pulse,
                  spo2: latestVital.spo2,
                  avpu: latestVital.avpu,
                }
              : undefined,
            facilityCode: session?.facility.shortName,
            userCode: session?.user.registrationNumber,
          }}
        />
      ) : null}
    </DeskFrame>
  );
}
