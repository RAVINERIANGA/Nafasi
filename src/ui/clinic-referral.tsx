"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Avpu, Facility, TransportView } from "@/domain/types";
import {
  ageLabel,
  cx,
  formatClock,
  formatDuration,
  formatKm,
  formatWhen,
  vitalLine,
} from "@/domain/format";
import {
  AVPU_LABEL,
  CANCEL_REASONS,
  CATEGORY_LABEL,
  DELIVERY_LABEL,
  STATUS_LABEL,
  TRANSPORT_LABEL,
} from "@/domain/labels";
import { OfflineError, api } from "@/services/api";
import { enqueue, newOpId } from "@/services/offline";
import { useApp } from "@/services/provider";
import {
  DeliveryBadge,
  PinStepUpField,
  StatusBadge,
  StatusStepper,
  problemMessage,
} from "@/ui/clinic-helpers";
import { SmsFallbackModal } from "@/ui/sms-preview";
import type { PresentedReferral } from "@/ui/types";

function deliveryExplanation(referral: PresentedReferral) {
  switch (referral.delivery) {
    case "draft":
      return {
        tone: "border-line bg-paper text-ink/80",
        text: "Draft only — hospitals have not been alerted yet. Review routing or broadcast when ready.",
      };
    case "queued":
      return {
        tone: "border-amber/35 bg-amber/10 text-ink",
        text: "Broadcast pending — queued on the simulated server and awaiting gateway acknowledgement. Not yet sent.",
      };
    case "sent":
      return {
        tone: "border-sky/30 bg-sky/10 text-ink",
        text: "Sent — server/gateway acknowledged the broadcast. Waiting for hospital channel receipt.",
      };
    case "delivered":
      return {
        tone: "border-moss/30 bg-moss/10 text-ink",
        text: "Delivered — offered hospital channel received the alert.",
      };
    case "partial":
      return {
        tone: "border-amber/35 bg-amber/10 text-ink",
        text: "Partial delivery — at least one offered hospital received the alert while others are still pending.",
      };
    case "failed":
      return {
        tone: "border-clay/35 bg-clay/10 text-clay",
        text: "Gateway failure — simulated gateway did not acknowledge the broadcast. No alert was delivered. Retry or preview SMS fallback.",
      };
  }
}

export function ClinicReferralTracker({
  referral,
  transport,
  facilities,
  onUpdated,
  onEditDraft,
}: {
  referral: PresentedReferral;
  transport?: TransportView | null;
  facilities: Facility[];
  onUpdated: () => void;
  onEditDraft?: (referral: PresentedReferral) => void;
}) {
  const { session, connectivity } = useApp();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [pin, setPin] = useState("");
  const [cancelChoice, setCancelChoice] = useState<string>(CANCEL_REASONS[0]);
  const [customCancelReason, setCustomCancelReason] = useState("");
  const [escalateReason, setEscalateReason] = useState("Clinic requested regional dispatch support");

  const [vitalOpen, setVitalOpen] = useState(false);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [spo2, setSpo2] = useState("");
  const [avpu, setAvpu] = useState<Avpu | "">("");
  const [vitalNote, setVitalNote] = useState("");

  const [smsOpen, setSmsOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const hasCountdown = referral.offers.some((o) => o.status === "pending");
    if (!hasCountdown) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [referral.offers]);

  const placeName = (id?: string) => facilities.find((f) => f.id === id)?.shortName ?? "Hospital";
  const latestVital = referral.vitals.at(-1);
  const deliveryBanner = deliveryExplanation(referral);

  const lockedBedLabel = (() => {
    const lockEvent = [...referral.timeline]
      .reverse()
      .find((e) => (e.type === "BED_LOCKED" || e.type === "HANDOVER_CONFIRMED") && e.meta?.bed);
    return lockEvent?.meta?.bed ? String(lockEvent.meta.bed) : null;
  })();

  const hasBedWarning = referral.timeline.some((e) => e.type === "BED_RELEASE_WARNING");
  const isClosed = ["COMPLETED", "CANCELLED"].includes(referral.status);
  const canBroadcast = referral.status === "PREPARING" || referral.status === "ESCALATED";
  const canCancel = !["COMPLETED", "CANCELLED", "ARRIVED"].includes(referral.status);
  const canEscalate = ["PREPARING", "BROADCASTING", "AWAITING_ACCEPTANCE"].includes(referral.status);

  async function withPin() {
    const grant = await api<{ pinToken: string }>("auth/pin", {
      body: { purpose: "step_up", pin },
    });
    return grant.pinToken;
  }

  async function requestAmbulance() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await api("transports", { body: { referralId: referral.id } });
      setNote("Ambulance requested. Destination is fixed and cannot be changed by transport.");
      onUpdated();
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitNewVital(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNote("");

    const body = {
      systolic: systolic ? Number(systolic) : undefined,
      diastolic: diastolic ? Number(diastolic) : undefined,
      pulse: pulse ? Number(pulse) : undefined,
      spo2: spo2 ? Number(spo2) : undefined,
      avpu: avpu || undefined,
      note: vitalNote.trim() || undefined,
    };

    if (!body.systolic && !body.diastolic && !body.pulse && !body.spo2 && !body.avpu) {
      setError("Enter at least one vital sign measurement.");
      return;
    }

    if (connectivity === "offline") {
      if (!session) return;
      await enqueue({
        opId: newOpId(),
        kind: "vitals",
        referralId: referral.id,
        body,
        enqueuedAt: new Date().toISOString(),
        attempts: 0,
        nextAttemptAt: Date.now(),
        facilityId: session.facility.id,
        userId: session.user.id,
        summary: {
          category: referral.category,
          hospitalNumber: referral.patient.hospitalNumber,
          patientName: referral.patient.name,
          diagnosis: referral.diagnosis,
        },
        lastError: "Queued vital reading on this device. Not sent.",
      });
      setSystolic("");
      setDiastolic("");
      setPulse("");
      setSpo2("");
      setAvpu("");
      setVitalNote("");
      setVitalOpen(false);
      setNote("Device is offline — vital reading queued in On this device (not sent yet).");
      return;
    }

    setBusy(true);
    try {
      await api<PresentedReferral>(`referrals/${referral.id}/vitals`, { body });
      setSystolic("");
      setDiastolic("");
      setPulse("");
      setSpo2("");
      setAvpu("");
      setVitalNote("");
      setVitalOpen(false);
      setNote("Vital reading recorded with server timestamp.");
      onUpdated();
    } catch (caught) {
      if (caught instanceof OfflineError && session) {
        await enqueue({
          opId: newOpId(),
          kind: "vitals",
          referralId: referral.id,
          body,
          enqueuedAt: new Date().toISOString(),
          attempts: 0,
          nextAttemptAt: Date.now(),
          facilityId: session.facility.id,
          userId: session.user.id,
          summary: {
            category: referral.category,
            hospitalNumber: referral.patient.hospitalNumber,
            patientName: referral.patient.name,
            diagnosis: referral.diagnosis,
          },
          lastError: "Connection lost. Vital reading queued on this device.",
        });
        setVitalOpen(false);
        setNote("Connection lost — vital reading queued locally (not sent yet).");
      } else {
        setError(problemMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelReferralAction() {
    setError("");
    setNote("");
    const effectiveReason = cancelChoice === "__custom__" ? customCancelReason.trim() : cancelChoice;
    if (effectiveReason.length < 3) {
      setError("Enter a cancellation reason (at least 3 characters).");
      return;
    }

    if (connectivity === "offline") {
      if (!session) return;
      await enqueue({
        opId: newOpId(),
        kind: "cancel",
        referralId: referral.id,
        body: { reason: effectiveReason },
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
        },
        lastError: "Cancellation queued locally. Enter PIN in On this device when back online.",
      });
      setActionsOpen(false);
      setNote("Offline — cancellation queued locally (not sent yet).");
      return;
    }

    if (pin.length < 4) {
      setError("Enter your 4+ digit PIN to confirm cancellation.");
      return;
    }

    setBusy(true);
    try {
      const pinToken = await withPin();
      await api(`referrals/${referral.id}/cancel`, { body: { reason: effectiveReason }, pinToken });
      setPin("");
      setActionsOpen(false);
      setNote("Referral cancelled.");
      onUpdated();
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function escalateReferralAction() {
    setError("");
    setNote("");
    if (pin.length < 4) {
      setError("Enter your 4+ digit PIN to escalate to regional dispatch.");
      return;
    }
    setBusy(true);
    try {
      const pinToken = await withPin();
      await api(`referrals/${referral.id}/escalate`, {
        body: { reason: escalateReason.trim() || "Clinic requested regional dispatch support" },
        pinToken,
      });
      setPin("");
      setActionsOpen(false);
      setNote("Referral escalated to regional dispatch.");
      onUpdated();
    } catch (caught) {
      setError(problemMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-4 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-6">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={referral.status} />
            <DeliveryBadge delivery={referral.delivery} />
          </div>
          <span className="font-mono text-xs text-ink/60">ref {referral.patient.hospitalNumber}</span>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl text-teal-dark sm:text-3xl">
            {referral.patient.name ?? "Unnamed patient"}
          </h2>
          <span className="text-xs font-semibold text-teal">
            {CATEGORY_LABEL[referral.category]}
          </span>
        </div>

        <p className="text-sm text-ink/75">
          {ageLabel(referral.patient.age, referral.patient.ageUnit)} · {referral.patient.sex} · Updated {formatWhen(referral.updatedAt)}
        </p>
        <p className="text-sm font-medium text-ink">{referral.diagnosis}</p>
        {referral.notes ? <p className="text-sm text-ink/70">{referral.notes}</p> : null}
      </header>

      {/* Delivery & fault callout */}
      <div className={cx("rounded-2xl border px-3.5 py-2.5 text-xs", deliveryBanner.tone)}>
        <span className="font-semibold">{DELIVERY_LABEL[referral.delivery]}: </span>
        {deliveryBanner.text}
      </div>

      {/* Escalation / cancel / bed warnings */}
      {referral.status === "ESCALATED" && referral.escalationReason ? (
        <div className="rounded-2xl border border-clay/35 bg-clay/10 px-3.5 py-2.5 text-xs text-clay">
          <span className="font-semibold">Escalated: </span>
          {referral.escalationReason}
        </div>
      ) : null}

      {referral.status === "CANCELLED" && referral.cancelReason ? (
        <div className="rounded-2xl border border-line bg-paper px-3.5 py-2.5 text-xs text-ink/80">
          <span className="font-semibold">Cancelled: </span>
          {referral.cancelReason}
        </div>
      ) : null}

      {(hasBedWarning || referral.bedReleaseReason) && referral.status !== "COMPLETED" && referral.status !== "CANCELLED" ? (
        <div className="rounded-2xl border border-amber/35 bg-amber/10 px-3.5 py-2.5 text-xs text-ink">
          <span className="font-semibold">Bed reservation notice: </span>
          {referral.bedReleaseReason ?? "Safety timeout warning issued — confirm ambulance arrival before the hold expires."}
        </div>
      ) : null}

      {/* Canonical status stepper */}
      <StatusStepper status={referral.status} />

      {/* Key summary cards */}
      <dl className="grid gap-3 rounded-2xl border border-line bg-paper/70 p-3.5 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold text-ink/55">Origin clinic</dt>
          <dd className="mt-0.5 font-medium">{referral.originName}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink/55">Destination & bed</dt>
          <dd className="mt-0.5 font-medium">
            {referral.destinationName ?? "Not accepted yet"}
            {lockedBedLabel ? <span className="block text-xs text-moss">Bed {lockedBedLabel}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink/55">Latest vitals</dt>
          <dd className="mt-0.5 font-medium">
            {vitalLine(latestVital)}
            {latestVital ? (
              <span className="block text-xs text-ink/60">{formatClock(latestVital.serverTime || latestVital.deviceTime)}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <p className="text-xs text-ink/80">
        <span className="font-semibold">Allergies: </span>
        {referral.allergies || "None known"}
        {referral.interventions.length ? ` · Given: ${referral.interventions.join(", ")}` : ""}
      </p>

      {/* Primary next-step actions */}
      <div className="flex flex-wrap gap-2">
        {canBroadcast ? (
          <>
            <Link
              href={`/clinic/referrals/${referral.id}/routing`}
              className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark"
            >
              {referral.delivery === "failed" ? "Retry routing & broadcast" : "Review routing & broadcast"}
            </Link>
            {referral.status === "PREPARING" && onEditDraft ? (
              <button
                type="button"
                onClick={() => onEditDraft(referral)}
                className="min-h-[48px] rounded-full border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink"
              >
                Edit patient & vitals
              </button>
            ) : null}
          </>
        ) : null}

        {referral.status === "ACCEPTED" && !referral.transportId ? (
          <button
            type="button"
            disabled={busy || connectivity === "offline"}
            onClick={() => void requestAmbulance()}
            className="min-h-[48px] rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-dark disabled:opacity-50"
          >
            {busy ? "Requesting…" : "Request ambulance"}
          </button>
        ) : null}

        {!isClosed ? (
          <button
            type="button"
            onClick={() => setVitalOpen((v) => !v)}
            className="min-h-[48px] rounded-full border border-teal/40 bg-mist px-4 py-2.5 text-sm font-semibold text-teal-dark"
          >
            {vitalOpen ? "Hide vital entry" : "+ Record vital reading"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setSmsOpen(true)}
          className="min-h-[48px] rounded-full border border-line bg-white px-4 py-2.5 text-xs font-semibold text-ink/80"
        >
          Compressed SMS preview
        </button>
      </div>

      {/* Transport card */}
      {transport ? (
        <section className="rounded-2xl border border-teal/30 bg-mist/60 p-3.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-dark">Ambulance status</p>
            <span className="rounded-full bg-teal px-2.5 py-0.5 text-xs font-semibold text-white">
              {TRANSPORT_LABEL[transport.status]}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-ink">
            {transport.summary.originName} → {transport.summary.destinationName}
          </p>
          <p className="mt-0.5 text-xs text-ink/70">
            ETA ~{transport.etaMin} min · Updated {formatClock(transport.updatedAt)}
            {transport.note ? ` · "${transport.note}"` : ""}
          </p>
        </section>
      ) : null}

      {/* Add vital reading inline form */}
      {vitalOpen && !isClosed ? (
        <form onSubmit={submitNewVital} className="space-y-3 rounded-2xl border border-teal/30 bg-paper p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-dark">
            New vital observation ({connectivity === "offline" ? "queues offline" : "sends to server"})
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <label className="text-xs font-semibold text-ink/75">
              Systolic BP
              <input
                value={systolic}
                onChange={(e) => setSystolic(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                inputMode="numeric"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-ink/75">
              Diastolic BP
              <input
                value={diastolic}
                onChange={(e) => setDiastolic(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                inputMode="numeric"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-ink/75">
              Pulse
              <input
                value={pulse}
                onChange={(e) => setPulse(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                inputMode="numeric"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-ink/75">
              SpO₂ %
              <input
                value={spo2}
                onChange={(e) => setSpo2(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                inputMode="numeric"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(["A", "V", "P", "U"] as Avpu[]).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setAvpu((c) => (c === code ? "" : code))}
                className={cx(
                  "min-h-[44px] rounded-xl border px-2 py-1 text-center text-xs font-semibold",
                  avpu === code ? "border-teal bg-teal text-white" : "border-line bg-white text-ink",
                )}
              >
                {code} · {AVPU_LABEL[code]}
              </button>
            ))}
          </div>
          <input
            value={vitalNote}
            onChange={(e) => setVitalNote(e.target.value)}
            placeholder="Optional observation note…"
            className="min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-[44px] rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : connectivity === "offline" ? "Queue vital reading" : "Save vital reading"}
          </button>
        </form>
      ) : null}

      {error ? <p className="rounded-xl bg-clay/10 px-3.5 py-2.5 text-sm font-semibold text-clay">{error}</p> : null}
      {note ? <p className="rounded-xl bg-mist px-3.5 py-2.5 text-sm font-semibold text-teal-dark">{note}</p> : null}

      {/* Hospital prep */}
      {referral.prep.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/60">Receiving hospital preparation</h3>
          <div className="flex flex-wrap gap-2">
            {referral.prep.map((item) => (
              <span
                key={item.key}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  item.acknowledgedAt ? "border-moss/40 bg-moss/10 text-moss" : "border-line bg-white text-ink/65",
                )}
              >
                {item.label} · {item.acknowledgedAt ? `ready (${formatClock(item.acknowledgedAt)})` : "waiting"}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {/* Offers */}
      {referral.offers.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/60">Hospital offers</h3>
          <ul className="space-y-2">
            {referral.offers.map((offer) => {
              const secLeft =
                offer.status === "pending"
                  ? Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - nowMs) / 1000))
                  : null;
              return (
                <li key={offer.id} className="rounded-2xl border border-line bg-paper/70 px-3.5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{placeName(offer.facilityId)}</span>
                    <span className="text-xs font-semibold uppercase text-teal-dark">
                      {offer.status}
                      {secLeft !== null ? ` · ${formatDuration(secLeft)} left` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink/70">
                    {formatKm(offer.distanceKm)} · ETA {offer.etaMin} min ·{" "}
                    {offer.delivery.channel === "simulated_sms" ? "Simulated SMS" : "Realtime"} ({offer.delivery.state})
                  </p>
                  <p className="mt-0.5 text-xs text-ink/60">
                    {offer.delivery.detail} Offered {formatWhen(offer.sentAt)}
                    {offer.declineReason ? ` · Reason: ${offer.declineReason}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Vitals history */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Vitals history ({referral.vitals.length})
        </h3>
        {referral.vitals.length === 0 ? (
          <p className="text-xs text-ink/60">No vitals recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {[...referral.vitals].reverse().map((v) => (
              <li key={v.id} className="rounded-2xl border border-line bg-white px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{vitalLine(v)}</span>
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-ink/70">
                    {v.context.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-1 text-ink/65">
                  Device {formatClock(v.deviceTime)} · Server {formatClock(v.serverTime)} · {v.recordedBy.name} ({v.recordedBy.registrationNumber})
                  {v.note ? ` · ${v.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cancel / Escalate controls */}
      {canCancel || canEscalate ? (
        <section className="rounded-2xl border border-line bg-paper/70 p-3.5">
          <button
            type="button"
            onClick={() => setActionsOpen((open) => !open)}
            className="flex min-h-[40px] w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-ink/75"
          >
            <span>Cancel or escalate referral</span>
            <span>{actionsOpen ? "Hide" : "Open"}</span>
          </button>

          {actionsOpen ? (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              {canCancel ? (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-ink/75">
                    Cancellation reason
                    <select
                      value={cancelChoice}
                      onChange={(e) => setCancelChoice(e.target.value)}
                      className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                    >
                      {CANCEL_REASONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                      <option value="__custom__">Other reason…</option>
                    </select>
                  </label>
                  {cancelChoice === "__custom__" ? (
                    <input
                      value={customCancelReason}
                      onChange={(e) => setCustomCancelReason(e.target.value)}
                      placeholder="Enter specific reason…"
                      className="min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                    />
                  ) : null}
                </div>
              ) : null}

              {canEscalate && connectivity !== "offline" ? (
                <label className="block text-xs font-semibold text-ink/75">
                  Escalation note
                  <input
                    value={escalateReason}
                    onChange={(e) => setEscalateReason(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  />
                </label>
              ) : null}

              {connectivity !== "offline" ? (
                <PinStepUpField
                  id={`track-pin-${referral.id}`}
                  value={pin}
                  onChange={setPin}
                  label="Confirm with clinician PIN"
                />
              ) : (
                <p className="text-xs text-amber">
                  Device is offline. Cancellation queues locally and asks for your PIN when you send it in On this device.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {canCancel ? (
                  <button
                    type="button"
                    disabled={busy || (connectivity !== "offline" && pin.length < 4)}
                    onClick={() => void cancelReferralAction()}
                    className="min-h-[44px] rounded-full border border-clay/40 bg-white px-4 py-2 text-sm font-semibold text-clay disabled:opacity-45"
                  >
                    {connectivity === "offline" ? "Queue cancellation" : "Cancel referral"}
                  </button>
                ) : null}
                {canEscalate && connectivity !== "offline" ? (
                  <button
                    type="button"
                    disabled={busy || pin.length < 4}
                    onClick={() => void escalateReferralAction()}
                    className="min-h-[44px] rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-45"
                  >
                    Escalate to dispatch
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Audit timeline */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Timeline ({referral.timeline.length})
        </h3>
        {referral.timeline.length === 0 ? (
          <p className="text-xs text-ink/60">No audit events yet.</p>
        ) : (
          <ul className="space-y-1.5 text-xs text-ink/75">
            {[...referral.timeline].reverse().map((event) => (
              <li key={event.id} className="rounded-xl bg-paper/50 px-3 py-1.5">
                <span className="font-semibold text-ink">{formatClock(event.serverTime)}</span> ·{" "}
                <span className="font-medium">{event.type.replaceAll("_", " ")}</span> · {event.actorName}
                {event.reason ? ` · ${event.reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

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
    </article>
  );
}
