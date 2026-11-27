"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Bed, Facility, Role } from "@/domain/types";
import { ageLabel, formatClock, formatKm, formatWhen, vitalLine } from "@/domain/format";
import {
  BED_KIND_LABEL,
  CANCEL_REASONS,
  CATEGORY_LABEL,
  DECLINE_REASONS,
  DELIVERY_LABEL,
  RELEASE_REASONS,
  STATUS_LABEL,
} from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import type { PresentedReferral } from "@/ui/types";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "The simulated server could not complete that action.";
}

async function withPin(pin: string) {
  const grant = await api<{ pinToken: string }>("auth/pin", { body: { purpose: "step_up", pin } });
  return grant.pinToken;
}

export function ReferralDesk({
  referral,
  facilities,
  facilityId,
  role,
  onUpdated,
}: {
  referral: PresentedReferral;
  facilities: Facility[];
  facilityId: string;
  role: Role;
  onUpdated: () => void;
}) {
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState<string>(role === "hospital" ? DECLINE_REASONS[0] : CANCEL_REASONS[0]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedId, setBedId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  // New vitals logging states
  const [showAddVitals, setShowAddVitals] = useState(false);
  const [vSystolic, setVSystolic] = useState("");
  const [vDiastolic, setVDiastolic] = useState("");
  const [vPulse, setVPulse] = useState("");
  const [vSpo2, setVSpo2] = useState("");
  const [vAvpu, setVAvpu] = useState("A");

  const offer = referral.offers.find((item) => item.facilityId === facilityId && item.status === "pending");
  const place = (id?: string) => facilities.find((item) => item.id === id)?.shortName ?? "Hospital";

  useEffect(() => {
    if (role !== "hospital") return;
    api<Bed[]>(`beds?facility_id=${encodeURIComponent(facilityId)}`)
      .then((rows) => {
        setBeds(rows);
        setBedId((current) => current || rows.find((bed) => bed.status === "available")?.id || "");
      })
      .catch((caught) => setError(problem(caught)));
  }, [role, facilityId, referral.updatedAt]);

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

  async function logNewVitals(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api(`referrals/${referral.id}/vitals`, {
        body: {
          systolic: vSystolic ? Number(vSystolic) : undefined,
          diastolic: vDiastolic ? Number(vDiastolic) : undefined,
          pulse: vPulse ? Number(vPulse) : undefined,
          spo2: vSpo2 ? Number(vSpo2) : undefined,
          avpu: vAvpu,
          context: role === "transport" ? "en_route" : "pre_transfer",
        },
      });
      setShowAddVitals(false);
      setVSystolic("");
      setVDiastolic("");
      setVPulse("");
      setVSpo2("");
      setNote("New patient vitals broadcast to receiving hospital.");
    });
  }

  return (
    <article className="space-y-6 rounded-3xl border border-line bg-card p-6 shadow-card">
      {/* Referral Top Banner */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-teal-dark border border-teal/20">
              {STATUS_LABEL[referral.status]}
            </span>
            <span className="text-xs text-ink/60 font-medium">
              · Outbox: {DELIVERY_LABEL[referral.delivery]}
            </span>
          </div>
          <h2 className="mt-1.5 font-display text-3xl font-bold text-teal-dark">
            {referral.patient.name ?? "Unnamed patient"}
          </h2>
          <p className="text-xs text-ink/70 mt-0.5">
            <strong>{CATEGORY_LABEL[referral.category]}</strong> · {ageLabel(referral.patient.age, referral.patient.ageUnit)} · {referral.patient.sex} · Ref: <span className="font-mono">{referral.patient.hospitalNumber}</span>
          </p>
        </div>

        {/* Quick actions by role */}
        <div className="flex items-center gap-2">
          {["PREPARING", "AWAITING_ACCEPTANCE", "ACCEPTED", "EN_ROUTE"].includes(referral.status) && (
            <button
              type="button"
              onClick={() => setShowAddVitals(!showAddVitals)}
              className="rounded-full border border-teal bg-mist px-3.5 py-1.5 text-xs font-bold text-teal-dark hover:bg-teal hover:text-white transition shadow-sm"
            >
              + Log Vitals
            </button>
          )}
        </div>
      </header>

      {/* Inline Vitals Logger Modal */}
      {showAddVitals && (
        <form onSubmit={logNewVitals} className="rounded-2xl border border-teal/30 bg-mist/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-teal-dark">Add New Patient Vitals</h4>
            <button type="button" onClick={() => setShowAddVitals(false)} className="text-xs text-ink/60 hover:text-ink">✕</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <label className="text-xs font-bold text-ink/75">
              Systolic BP
              <input value={vSystolic} onChange={(e) => setVSystolic(e.target.value)} placeholder="120" className="mt-1 w-full rounded-xl border border-line bg-white p-2 text-sm" />
            </label>
            <label className="text-xs font-bold text-ink/75">
              Diastolic BP
              <input value={vDiastolic} onChange={(e) => setVDiastolic(e.target.value)} placeholder="80" className="mt-1 w-full rounded-xl border border-line bg-white p-2 text-sm" />
            </label>
            <label className="text-xs font-bold text-ink/75">
              Pulse (bpm)
              <input value={vPulse} onChange={(e) => setVPulse(e.target.value)} placeholder="90" className="mt-1 w-full rounded-xl border border-line bg-white p-2 text-sm" />
            </label>
            <label className="text-xs font-bold text-ink/75">
              SpO₂ (%)
              <input value={vSpo2} onChange={(e) => setVSpo2(e.target.value)} placeholder="98" className="mt-1 w-full rounded-xl border border-line bg-white p-2 text-sm" />
            </label>
            <label className="text-xs font-bold text-ink/75 col-span-2 sm:col-span-1">
              AVPU
              <select value={vAvpu} onChange={(e) => setVAvpu(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white p-2 text-sm">
                <option value="A">Alert (A)</option>
                <option value="V">Voice (V)</option>
                <option value="P">Pain (P)</option>
                <option value="U">Unresponsive (U)</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy} className="rounded-xl bg-teal px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-dark">
            Broadcast Vitals Update
          </button>
        </form>
      )}

      {/* Details Grid */}
      <dl className="grid gap-3 rounded-2xl bg-paper/60 p-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="font-bold text-ink/50 uppercase tracking-wide">Origin Facility</dt>
          <dd className="font-semibold text-sm text-ink mt-0.5">{referral.originName}</dd>
        </div>
        <div>
          <dt className="font-bold text-ink/50 uppercase tracking-wide">Destination Facility</dt>
          <dd className="font-semibold text-sm text-teal-dark mt-0.5">
            {referral.destinationName ?? "Awaiting hospital lock"}
          </dd>
        </div>
        <div>
          <dt className="font-bold text-ink/50 uppercase tracking-wide">Latest Vitals</dt>
          <dd className="font-semibold text-sm text-ink mt-0.5">{vitalLine(referral.vitals.at(-1))}</dd>
        </div>
      </dl>

      {/* Diagnosis & Notes */}
      <div className="space-y-1.5 text-xs text-ink/80">
        <p>
          <strong className="text-ink">Suspected Presentation:</strong> {referral.diagnosis}
        </p>
        {referral.notes && (
          <p>
            <strong className="text-ink">Clinical Notes:</strong> {referral.notes}
          </p>
        )}
        <p>
          <strong className="text-ink">Allergies:</strong> {referral.allergies || "None known"}
          {referral.interventions.length ? ` · Treatments: ${referral.interventions.join(", ")}` : ""}
        </p>
      </div>

      {/* Live Routing Review for Clinic */}
      {role === "clinic" && (referral.status === "PREPARING" || referral.status === "ESCALATED") && (
        <div className="rounded-2xl border border-teal/20 bg-mist p-4 space-y-2">
          <p className="text-xs font-semibold text-teal-dark">
            The automated routing engine will calculate nearest capable facilities based on distance and verified bed capacity.
          </p>
          <Link
            href={`/clinic/referrals/${referral.id}/routing`}
            className="inline-flex rounded-xl bg-teal px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-dark transition"
          >
            Review Hospital Routing &amp; Broadcast →
          </Link>
        </div>
      )}

      {/* Transport Request for Clinic */}
      {role === "clinic" && referral.status === "ACCEPTED" && !referral.transportId && (
        <div className="rounded-2xl border border-moss/30 bg-moss/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-moss">
            Hospital accepted! Bed reservation locked at <strong>{referral.destinationName}</strong>.
          </p>
          <button
            type="button"
            disabled={busy}
            className="rounded-xl bg-moss px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-moss/90 transition disabled:opacity-50"
            onClick={() =>
              void run(async () => {
                await api("transports", { body: { referralId: referral.id } });
                setNote("Ambulance dispatch notified with immutable destination.");
              })
            }
          >
            Request Ambulance Dispatch →
          </button>
        </div>
      )}

      {/* Cancellation or Escalation for Clinic */}
      {role === "clinic" && !["COMPLETED", "CANCELLED", "ARRIVED"].includes(referral.status) && (
        <div className="space-y-3 rounded-2xl border border-line bg-paper/60 p-4">
          <p className="text-xs font-bold text-ink/75 uppercase tracking-wide">Manage Referral Status</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink/70">
              Cancellation Reason
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-white p-2 text-xs"
              >
                {CANCEL_REASONS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <Pin value={pin} onChange={setPin} />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy || pin.length < 4}
              className="rounded-xl border border-clay/30 bg-white px-4 py-2 text-xs font-bold text-clay hover:bg-clay/5 disabled:opacity-50"
              onClick={() =>
                void run(async () => {
                  const pinToken = await withPin(pin);
                  await api(`referrals/${referral.id}/cancel`, { body: { reason }, pinToken });
                  setPin("");
                  setNote("Referral cancelled and bed holds released.");
                })
              }
            >
              Cancel Referral
            </button>
            {["PREPARING", "BROADCASTING", "AWAITING_ACCEPTANCE"].includes(referral.status) && (
              <button
                type="button"
                disabled={busy || pin.length < 4}
                className="rounded-xl border border-amber/40 bg-white px-4 py-2 text-xs font-bold text-amber hover:bg-amber/5 disabled:opacity-50"
                onClick={() =>
                  void run(async () => {
                    const pinToken = await withPin(pin);
                    await api(`referrals/${referral.id}/escalate`, {
                      body: { reason: "Clinic requested regional dispatch escalation" },
                      pinToken,
                    });
                    setPin("");
                    setNote("Referral escalated to regional dispatch command.");
                  })
                }
              >
                Escalate to Region
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs font-medium text-clay">⚠️ {error}</p>}
      {note && <p className="text-xs font-medium text-moss">✓ {note}</p>}

      {/* Timeline Section */}
      <section className="border-t border-line pt-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink/50">Audit Timeline (Append-Only)</h3>
        <ul className="mt-2 space-y-1.5 text-xs text-ink/70">
          {referral.timeline.slice(-6).reverse().map((event) => (
            <li key={event.id} className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-ink/40">{formatClock(event.serverTime)}</span>
              <span className="font-semibold text-teal-dark">{event.type.replaceAll("_", " ")}</span>
              <span className="text-ink/60">by {event.actorName}</span>
              {event.reason && <span className="italic text-ink/50">({event.reason})</span>}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function Pin({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-semibold text-ink/70">
      Authorizing PIN
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        type="password"
        placeholder="••••"
        className="mt-1 w-full rounded-xl border border-line bg-white p-2 text-xs font-mono font-bold tracking-widest text-center"
      />
    </label>
  );
}
