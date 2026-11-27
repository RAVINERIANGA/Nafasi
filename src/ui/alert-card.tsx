"use client";

import { useEffect, useState } from "react";
import type { Bed, Facility } from "@/domain/types";
import { ageLabel, formatClock, formatKm, vitalLine } from "@/domain/format";
import {
  BED_KIND_LABEL,
  CATEGORY_LABEL,
  CATEGORY_RESOURCES,
  DECLINE_REASONS,
} from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import type { PresentedReferral } from "@/ui/types";
import { AcceptanceCountdown } from "@/ui/countdown";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError)
    return error.message;
  return "The simulated server could not complete that action.";
}

async function withPin(pin: string) {
  const grant = await api<{ pinToken: string }>("auth/pin", {
    body: { purpose: "step_up", pin },
  });
  return grant.pinToken;
}

/**
 * High-priority incoming alert card shown to hospital ED staff.
 * Displays patient details, vitals, 60-second countdown, and
 * accept/decline actions with bed selection and PIN confirmation.
 */
export function IncomingAlertCard({
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
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState<string>(DECLINE_REASONS[0]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedId, setBedId] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  const offer = referral.offers.find(
    (o) => o.facilityId === facilityId && o.status === "pending"
  );
  const origin = facilities.find((f) => f.id === referral.originFacilityId);
  const latestVital = referral.vitals.at(-1);
  const resources = CATEGORY_RESOURCES[referral.category];

  useEffect(() => {
    api<Bed[]>(`beds?facility_id=${encodeURIComponent(facilityId)}`)
      .then((rows) => {
        setBeds(rows);
        setBedId(
          (c) => c || rows.find((b) => b.status === "available")?.id || ""
        );
      })
      .catch((e) => setError(problem(e)));
  }, [facilityId, referral.updatedAt]);

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

  const isDelivered = offer?.delivery.state === "delivered";
  const canAct = isDelivered && !expired;

  return (
    <article
      className={`space-y-4 rounded-3xl border-2 p-5 shadow-card ${
        expired
          ? "border-line bg-card opacity-70"
          : "border-clay/40 bg-card animate-[pulse-ring_2s_ease-in-out_infinite]"
      }`}
    >
      {/* Category banner */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-3 w-3 rounded-full bg-clay animate-pulse" />
            <p className="text-xs font-bold uppercase tracking-widest text-clay">
              Incoming emergency
            </p>
          </div>
          <h2 className="mt-1 font-display text-3xl text-teal-dark">
            {CATEGORY_LABEL[referral.category]}
          </h2>
        </div>
        {offer && (
          <AcceptanceCountdown
            expiresAt={offer.expiresAt}
            onExpired={() => setExpired(true)}
          />
        )}
      </div>

      {/* Patient identifiers */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Patient" value={referral.patient.name ?? referral.patient.hospitalNumber} />
        <Stat
          label="Demographics"
          value={`${ageLabel(referral.patient.age, referral.patient.ageUnit)} · ${referral.patient.sex}`}
        />
        <Stat label="From" value={origin?.shortName ?? "Clinic"} />
      </div>

      {/* Vitals block */}
      <div className="rounded-2xl bg-mist px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-dark">
          Latest vitals
        </p>
        {latestVital ? (
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-5">
            <VitalPill
              label="BP"
              value={
                latestVital.systolic && latestVital.diastolic
                  ? `${latestVital.systolic}/${latestVital.diastolic}`
                  : undefined
              }
            />
            <VitalPill label="Pulse" value={latestVital.pulse?.toString()} />
            <VitalPill
              label="SpO₂"
              value={latestVital.spo2 ? `${latestVital.spo2}%` : undefined}
              warn={latestVital.spo2 !== undefined && latestVital.spo2 < 92}
            />
            <VitalPill label="AVPU" value={latestVital.avpu} warn={latestVital.avpu === "P" || latestVital.avpu === "U"} />
            <VitalPill label="Taken" value={formatClock(latestVital.deviceTime)} />
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink/60">No vitals recorded yet.</p>
        )}
        <p className="mt-2 text-xs text-ink/60">
          Recorded by {latestVital?.recordedBy.name ?? "clinic"} ·{" "}
          {latestVital?.context ?? "pre_transfer"}
        </p>
      </div>

      {/* Clinical details */}
      <div className="space-y-2 text-sm">
        <p>
          <span className="font-semibold">Diagnosis. </span>
          {referral.diagnosis || "Not specified"}
        </p>
        <p>
          <span className="font-semibold">Allergies. </span>
          {referral.allergies || "None known"}
        </p>
        {referral.interventions.length > 0 && (
          <p>
            <span className="font-semibold">Given. </span>
            {referral.interventions.join(", ")}
          </p>
        )}
        {referral.notes && (
          <p className="text-ink/70">
            <span className="font-semibold">Notes. </span>
            {referral.notes}
          </p>
        )}
      </div>

      {/* Required resources */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-semibold text-ink/50">Prepare:</span>
        {resources.map((r) => (
          <span
            key={r}
            className="rounded-full border border-amber/40 bg-amber/5 px-3 py-1 text-xs font-semibold text-amber"
          >
            {r}
          </span>
        ))}
      </div>

      {/* Distance & ETA */}
      {offer && (
        <div className="flex gap-4 text-sm text-ink/70">
          <span>{formatKm(offer.distanceKm)} away</span>
          <span>ETA {offer.etaMin} min</span>
          <span>
            Offered {formatClock(offer.sentAt)}
          </span>
        </div>
      )}

      {/* Accept / Decline actions */}
      {offer && (
        <div className="space-y-3 rounded-2xl border border-line bg-paper p-4">
          {!isDelivered && (
            <p className="text-sm text-amber">
              The alert is still moving through the simulated gateway. Actions unlock once it is marked delivered.
            </p>
          )}
          {expired && (
            <p className="text-sm text-clay">
              The 60-second window has closed. The server will reroute this referral.
            </p>
          )}
          {canAct && (
            <>
              <label className="block text-xs font-semibold text-ink/70">
                Assign bed or bay
                <select
                  value={bedId}
                  onChange={(e) => setBedId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                >
                  {beds
                    .filter((b) => b.status === "available")
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label} · {BED_KIND_LABEL[b.kind]}
                      </option>
                    ))}
                  {beds.filter((b) => b.status === "available").length === 0 && (
                    <option value="">No beds available</option>
                  )}
                </select>
              </label>
              <label className="block text-xs font-semibold text-ink/70">
                Decline reason (if declining)
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                >
                  {DECLINE_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
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
              <p className="text-xs text-ink/50">
                Accepting locks the bed until the patient arrives or the reservation is released. This is not a promise of clinical suitability and does not replace triage on arrival.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !bedId || pin.length < 4}
                  className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white shadow-md disabled:opacity-50"
                  onClick={() =>
                    void run(async () => {
                      const pinToken = await withPin(pin);
                      await api(`referrals/${referral.id}/accept`, {
                        body: { bedId },
                        pinToken,
                      });
                      setNote("Bed locked for this referral.");
                      setPin("");
                    })
                  }
                >
                  Accept &amp; lock bed
                </button>
                <button
                  type="button"
                  disabled={busy || pin.length < 4}
                  className="rounded-full border border-clay/30 bg-white px-5 py-2.5 text-sm font-semibold text-clay disabled:opacity-50"
                  onClick={() =>
                    void run(async () => {
                      const pinToken = await withPin(pin);
                      await api(`referrals/${referral.id}/decline`, {
                        body: { reason },
                        pinToken,
                      });
                      setNote("Offer declined. The server may reroute.");
                      setPin("");
                    })
                  }
                >
                  Decline
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-clay">{error}</p>}
      {note && <p className="text-sm text-moss">{note}</p>}
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink/50">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function VitalPill({
  label,
  value,
  warn,
}: {
  label: string;
  value?: string;
  warn?: boolean;
}) {
  if (!value) return null;
  return (
    <span
      className={`rounded-full px-3 py-1 text-center text-xs font-semibold ${
        warn ? "bg-clay/10 text-clay" : "bg-white text-ink"
      }`}
    >
      {label} {value}
    </span>
  );
}
