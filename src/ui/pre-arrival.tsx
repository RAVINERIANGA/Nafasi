"use client";

import { useCallback, useEffect, useState } from "react";
import type { Facility, PrepKey, TransportView } from "@/domain/types";
import { ageLabel, formatClock, formatDuration, vitalLine } from "@/domain/format";
import {
  CATEGORY_LABEL,
  CATEGORY_RESOURCES,
  RELEASE_REASONS,
  STATUS_LABEL,
  TRANSPORT_LABEL,
  BED_KIND_LABEL,
} from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import type { PresentedReferral } from "@/ui/types";
import type { Bed } from "@/domain/types";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "The simulated server could not complete that action.";
}

async function withPin(pin: string) {
  const grant = await api<{ pinToken: string }>("auth/pin", { body: { purpose: "step_up", pin } });
  return grant.pinToken;
}

/**
 * Full pre-arrival preparation board for the receiving team.
 * Shows ETA countdown, latest vitals, treatment summary,
 * interactive prep checklist, and handover confirmation.
 */
export function PreArrivalBoard({
  referral,
  facilityId,
  facilities,
  onUpdated,
}: {
  referral: PresentedReferral;
  facilityId: string;
  facilities: Facility[];
  onUpdated: () => void;
}) {
  const [transport, setTransport] = useState<TransportView | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedId, setBedId] = useState(referral.bedId ?? "");
  const [releaseReason, setReleaseReason] = useState(RELEASE_REASONS[0]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const origin = facilities.find((f) => f.id === referral.originFacilityId);
  const destination = facilities.find((f) => f.id === referral.destinationFacilityId);
  const resources = CATEGORY_RESOURCES[referral.category];
  const isEnRoute = ["TRANSPORT_ASSIGNED", "EN_ROUTE"].includes(referral.status);
  const isArrived = referral.status === "ARRIVED";
  const isCompleted = referral.status === "COMPLETED";

  // Load transport and beds
  useEffect(() => {
    if (referral.transportId) {
      api<TransportView[]>("transports")
        .then((rows) => {
          const match = rows.find((t) => t.referralId === referral.id);
          if (match) {
            setTransport(match);
            setEtaSeconds(match.etaMin * 60);
          }
        })
        .catch(() => {});
    }
    api<Bed[]>(`beds?facility_id=${encodeURIComponent(facilityId)}`)
      .then((rows) => {
        setBeds(rows);
        setBedId((c) => c || referral.bedId || rows.find((b) => b.status === "available")?.id || "");
      })
      .catch(() => {});
  }, [referral.transportId, referral.id, facilityId, referral.bedId, referral.updatedAt]);

  // ETA countdown
  useEffect(() => {
    if (etaSeconds == null || etaSeconds <= 0) return;
    const tick = setInterval(() => {
      setEtaSeconds((prev) => (prev != null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(tick);
  }, [etaSeconds]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await task();
      onUpdated();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  const etaDisplay = etaSeconds != null
    ? etaSeconds > 0
      ? `${Math.floor(etaSeconds / 60)}:${String(etaSeconds % 60).padStart(2, "0")}`
      : "Imminent"
    : "—";

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="rounded-3xl border-2 border-teal/30 bg-mist p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-teal">
              Pre-arrival · {STATUS_LABEL[referral.status]}
            </p>
            <h2 className="mt-1 font-display text-3xl text-teal-dark">
              {CATEGORY_LABEL[referral.category]}
            </h2>
            <p className="mt-1 text-sm text-ink/70">
              {referral.patient.name ?? referral.patient.hospitalNumber} ·{" "}
              {ageLabel(referral.patient.age, referral.patient.ageUnit)} · {referral.patient.sex}
            </p>
          </div>
          {/* ETA countdown */}
          {isEnRoute && (
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-dark">
                ETA
              </p>
              <p className={`font-display text-4xl ${etaSeconds != null && etaSeconds < 300 ? "text-clay" : "text-teal-dark"}`}>
                {etaDisplay}
              </p>
              {transport && (
                <p className="text-xs text-ink/60">
                  {TRANSPORT_LABEL[transport.status]}
                </p>
              )}
            </div>
          )}
          {isArrived && (
            <div className="rounded-2xl bg-moss/10 px-4 py-2 text-center">
              <p className="font-display text-2xl text-moss">Arrived</p>
              <p className="text-xs text-moss/80">
                {formatClock(referral.arrivedAt)}
              </p>
            </div>
          )}
          {isCompleted && (
            <div className="rounded-2xl bg-teal/10 px-4 py-2 text-center">
              <p className="font-display text-2xl text-teal-dark">Completed</p>
              <p className="text-xs text-ink/60">
                Door-to-bed: {formatDuration(referral.doorToBedSeconds)}
              </p>
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left column: Clinical summary */}
        <div className="space-y-4">
          {/* Vitals history */}
          <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
            <h3 className="text-sm font-semibold">Vitals timeline</h3>
            {referral.vitals.length === 0 ? (
              <p className="mt-2 text-sm text-ink/60">No vitals recorded.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {[...referral.vitals].reverse().map((v) => (
                  <li
                    key={v.id}
                    className="rounded-2xl bg-paper px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{vitalLine(v)}</span>
                      <span className="text-xs text-ink/50">
                        {formatClock(v.deviceTime)}
                      </span>
                    </div>
                    <p className="text-xs text-ink/60">
                      {v.context} · {v.recordedBy.name}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Clinical details */}
          <section className="rounded-3xl border border-line bg-card p-4 shadow-card space-y-2 text-sm">
            <h3 className="font-semibold">Clinical summary</h3>
            <p><span className="font-semibold">Diagnosis. </span>{referral.diagnosis || "Not specified"}</p>
            <p><span className="font-semibold">Allergies. </span>{referral.allergies || "None known"}</p>
            {referral.interventions.length > 0 && (
              <p><span className="font-semibold">Given. </span>{referral.interventions.join(", ")}</p>
            )}
            {referral.notes && <p className="text-ink/70">{referral.notes}</p>}
            <div className="mt-2 flex gap-3 text-xs text-ink/60">
              <span>From {origin?.shortName ?? "Clinic"}</span>
              <span>→ {destination?.shortName ?? "This hospital"}</span>
            </div>
          </section>

          {/* Bed assignment */}
          {referral.bedId && (
            <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
              <h3 className="text-sm font-semibold">Reserved bed</h3>
              <p className="mt-1 text-sm">
                {beds.find((b) => b.id === referral.bedId)?.label ?? referral.bedId}
                {beds.find((b) => b.id === referral.bedId) && (
                  <span className="text-ink/60"> · {BED_KIND_LABEL[beds.find((b) => b.id === referral.bedId)!.kind]}</span>
                )}
              </p>
            </section>
          )}
        </div>

        {/* Right column: Preparation */}
        <div className="space-y-4">
          {/* Prep checklist */}
          <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
            <h3 className="text-sm font-semibold">Preparation checklist</h3>
            <p className="mt-1 text-xs text-ink/60">
              Confirm each item as your team prepares. The referring clinic and crew can see which items are done.
            </p>
            <ul className="mt-3 space-y-2">
              {referral.prep.map((item) => (
                <li
                  key={item.key}
                  className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ${
                    item.acknowledgedAt
                      ? "border border-moss/30 bg-moss/5"
                      : "border border-line bg-paper"
                  }`}
                >
                  <div>
                    <p className={`text-sm font-semibold ${item.acknowledgedAt ? "text-moss" : ""}`}>
                      {item.label}
                      {item.required && <span className="ml-1 text-clay">*</span>}
                    </p>
                    {item.acknowledgedAt && item.acknowledgedBy && (
                      <p className="text-xs text-ink/60">
                        Done by {item.acknowledgedBy.name} at{" "}
                        {formatClock(item.acknowledgedAt)}
                      </p>
                    )}
                  </div>
                  {item.acknowledgedAt ? (
                    <span className="rounded-full bg-moss/10 px-3 py-1 text-xs font-semibold text-moss">
                      ✓ Ready
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`referrals/${referral.id}/prep`, {
                            body: { key: item.key },
                          });
                          setNote(`${item.label} acknowledged.`);
                        })
                      }
                      className="rounded-full bg-teal px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Confirm ready
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {referral.prep.length === 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {resources.map((r) => (
                  <span key={r} className="rounded-full border border-amber/40 bg-amber/5 px-3 py-1 text-xs text-amber">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Handover confirmation (when ARRIVED) */}
          {isArrived && referral.destinationFacilityId === facilityId && (
            <section className="rounded-3xl border-2 border-moss/30 bg-moss/5 p-4">
              <h3 className="text-sm font-semibold text-moss">Confirm handover</h3>
              <p className="mt-1 text-xs text-ink/60">
                Handover records the bed the patient actually reached. Door-to-bed time starts at crew arrival.
              </p>
              <label className="mt-3 block text-xs font-semibold text-ink/70">
                Actual bed
                <select
                  value={bedId || referral.bedId || ""}
                  onChange={(e) => setBedId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                >
                  {beds.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} · {b.status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-xs font-semibold text-ink/70">
                PIN
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  inputMode="numeric"
                  type="password"
                  className="mt-1 w-40 rounded-xl border border-line bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={busy || pin.length < 4}
                className="mt-3 rounded-full bg-moss px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                onClick={() =>
                  void run(async () => {
                    const pinToken = await withPin(pin);
                    await api(`referrals/${referral.id}/handover`, {
                      body: { bedId: bedId || referral.bedId },
                      pinToken,
                    });
                    setNote("Handover confirmed.");
                    setPin("");
                  })
                }
              >
                Confirm handover
              </button>
            </section>
          )}

          {/* Release bed */}
          {referral.bedId &&
            referral.destinationFacilityId === facilityId &&
            ["ACCEPTED", "TRANSPORT_ASSIGNED", "EN_ROUTE"].includes(referral.status) && (
              <section className="rounded-3xl border border-line bg-card p-4 shadow-card space-y-3">
                <h3 className="text-sm font-semibold">Release bed hold</h3>
                <p className="text-xs text-ink/60">
                  Release the reservation if this hospital can no longer take the patient.
                </p>
                <select
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value as typeof releaseReason)}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                >
                  {RELEASE_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <label className="block text-xs font-semibold text-ink/70">
                  PIN
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    inputMode="numeric"
                    type="password"
                    className="mt-1 w-40 rounded-xl border border-line bg-white px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || pin.length < 4}
                  className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  onClick={() =>
                    void run(async () => {
                      const pinToken = await withPin(pin);
                      await api(`referrals/${referral.id}/release-bed`, {
                        body: { reason: releaseReason },
                        pinToken,
                      });
                      setPin("");
                    })
                  }
                >
                  Release bed
                </button>
              </section>
            )}
        </div>
      </div>

      {/* Timeline */}
      <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
        <h3 className="text-sm font-semibold">Referral timeline</h3>
        <ul className="mt-3 space-y-1 text-xs text-ink/70">
          {referral.timeline
            .slice()
            .reverse()
            .map((ev) => (
              <li key={ev.id} className="flex gap-3">
                <span className="w-14 shrink-0 text-right text-ink/40">
                  {formatClock(ev.serverTime)}
                </span>
                <span>
                  {ev.type.replaceAll("_", " ")} · {ev.actorName}
                  {ev.reason ? ` · ${ev.reason}` : ""}
                </span>
              </li>
            ))}
          {referral.timeline.length === 0 && <li>No audit events yet.</li>}
        </ul>
      </section>

      {error && <p className="text-sm text-clay">{error}</p>}
      {note && <p className="text-sm text-moss">{note}</p>}
    </div>
  );
}
