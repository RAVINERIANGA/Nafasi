"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Bed, Facility, Role } from "@/domain/types";
import { ageLabel, formatClock, formatKm, formatWhen, vitalLine } from "@/domain/format";
import { BED_KIND_LABEL, CANCEL_REASONS, CATEGORY_LABEL, DECLINE_REASONS, DELIVERY_LABEL, RELEASE_REASONS, STATUS_LABEL } from "@/domain/labels";
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

  return (
    <article className="space-y-4 rounded-3xl border border-line bg-card p-5 shadow-card">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal">
          {STATUS_LABEL[referral.status]} · {DELIVERY_LABEL[referral.delivery]}
        </p>
        <h2 className="mt-1 font-display text-3xl text-teal-dark">{referral.patient.name ?? "Unnamed patient"}</h2>
        <p className="text-sm text-ink/70">
          {CATEGORY_LABEL[referral.category]} · {ageLabel(referral.patient.age, referral.patient.ageUnit)} · {referral.patient.sex} · {referral.patient.hospitalNumber}
        </p>
        <p className="mt-2 text-sm">{referral.diagnosis}</p>
        {referral.notes ? <p className="mt-1 text-sm text-ink/70">{referral.notes}</p> : null}
      </header>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold text-ink/50">From</dt>
          <dd>{referral.originName}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink/50">Destination</dt>
          <dd>{referral.destinationName ?? "Not accepted yet"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink/50">Latest vitals</dt>
          <dd>{vitalLine(referral.vitals.at(-1))}</dd>
        </div>
      </dl>
      <p className="text-sm">
        <span className="font-semibold">Allergies. </span>
        {referral.allergies || "None known"}
        {referral.interventions.length ? ` · Given: ${referral.interventions.join(", ")}` : ""}
      </p>
      {referral.offers.length ? (
        <ul className="space-y-2">
          {referral.offers.map((item) => (
            <li key={item.id} className="rounded-2xl bg-paper px-3 py-2 text-sm">
              <span className="font-semibold">{place(item.facilityId)}</span> · {item.status} · {formatKm(item.distanceKm)} · {item.etaMin} min
              <span className="block text-xs text-ink/60">
                {item.delivery.detail} Offered {formatWhen(item.sentAt)}
                {item.declineReason ? ` · ${item.declineReason}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {referral.prep.length ? (
        <div className="flex flex-wrap gap-2">
          {referral.prep.map((item) =>
            role === "hospital" ? (
              <button
                key={item.key}
                type="button"
                disabled={Boolean(item.acknowledgedAt) || busy}
                onClick={() =>
                  void run(async () => {
                    await api(`referrals/${referral.id}/prep`, { body: { key: item.key } });
                    setNote(`${item.label} acknowledged.`);
                  })
                }
                className={`rounded-full border px-3 py-1 text-xs ${item.acknowledgedAt ? "border-moss bg-white text-moss" : "border-line bg-white"}`}
              >
                {item.acknowledgedAt ? `${item.label} · done` : item.label}
              </button>
            ) : (
              <span key={item.key} className={`rounded-full border px-3 py-1 text-xs ${item.acknowledgedAt ? "border-moss text-moss" : "border-line text-ink/60"}`}>
                {item.acknowledgedAt ? `${item.label} · done` : `${item.label} · waiting`}
              </span>
            ),
          )}
        </div>
      ) : null}
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {note ? <p className="text-sm text-moss">{note}</p> : null}
      {role === "clinic" && (referral.status === "PREPARING" || referral.status === "ESCALATED") ? (
        <div className="rounded-2xl bg-paper p-3">
          <p className="text-sm">The server ranks hospitals from category, distance, and confirmed capacity. Review that list before the referral is sent.</p>
          <Link href={`/clinic/referrals/${referral.id}/routing`} className="mt-3 inline-flex rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white">
            Review routing
          </Link>
        </div>
      ) : null}
      {role === "clinic" && referral.status === "ACCEPTED" && !referral.transportId ? (
        <button
          type="button"
          disabled={busy}
          className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() =>
            void run(async () => {
              await api("transports", { body: { referralId: referral.id } });
              setNote("Dispatch has the destination. It cannot be changed from the ambulance.");
            })
          }
        >
          Request ambulance
        </button>
      ) : null}
      {role === "hospital" && offer ? (
        <div className="space-y-3 rounded-2xl bg-paper p-3">
          <p className="text-sm">
            {offer.delivery.state === "delivered"
              ? `Accept locks a bed until ${formatClock(offer.expiresAt)}. This is not a promise the patient is stable.`
              : "The offer is still moving through the simulated gateway. Acceptance stays closed until it is marked delivered."}
          </p>
          <label className="block text-xs font-semibold text-ink/70">
            Bed
            <select value={bedId} onChange={(event) => setBedId(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
              {beds
                .filter((bed) => bed.status === "available")
                .map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.label} · {BED_KIND_LABEL[bed.kind]}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-ink/70">
            Decline reason
            <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
              {DECLINE_REASONS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <Pin value={pin} onChange={setPin} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || offer.delivery.state !== "delivered" || !bedId || pin.length < 4}
              className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() =>
                void run(async () => {
                  const pinToken = await withPin(pin);
                  await api(`referrals/${referral.id}/accept`, { body: { bedId }, pinToken });
                  setNote("Bed locked for this referral.");
                  setPin("");
                })
              }
            >
              Accept and lock bed
            </button>
            <button
              type="button"
              disabled={busy || pin.length < 4}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={() =>
                void run(async () => {
                  const pinToken = await withPin(pin);
                  await api(`referrals/${referral.id}/decline`, { body: { reason }, pinToken });
                  setNote("Offer declined. The server may reroute.");
                  setPin("");
                })
              }
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}
      {role === "hospital" && referral.destinationFacilityId === facilityId && referral.bedId && ["ACCEPTED", "TRANSPORT_ASSIGNED", "EN_ROUTE"].includes(referral.status) ? (
        <ReleaseBed referralId={referral.id} pin={pin} setPin={setPin} busy={busy} run={run} />
      ) : null}
      {role === "hospital" && referral.status === "ARRIVED" && referral.destinationFacilityId === facilityId ? (
        <div className="space-y-3 rounded-2xl bg-paper p-3">
          <p className="text-sm">Handover records the bed the patient actually reached. Door-to-bed time starts at crew arrival.</p>
          <select value={bedId || referral.bedId || ""} onChange={(event) => setBedId(event.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
            {beds.map((bed) => (
              <option key={bed.id} value={bed.id}>
                {bed.label} · {bed.status}
              </option>
            ))}
          </select>
          <Pin value={pin} onChange={setPin} />
          <button
            type="button"
            disabled={busy || pin.length < 4}
            className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() =>
              void run(async () => {
                const pinToken = await withPin(pin);
                await api(`referrals/${referral.id}/handover`, { body: { bedId: bedId || referral.bedId }, pinToken });
                setNote("Handover confirmed.");
                setPin("");
              })
            }
          >
            Confirm handover
          </button>
        </div>
      ) : null}
      {role === "clinic" && !["COMPLETED", "CANCELLED", "ARRIVED"].includes(referral.status) ? (
        <div className="space-y-3 rounded-2xl bg-paper p-3">
          <p className="text-sm">Cancel or ask the region to take over. Both need the PIN.</p>
          <select value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
            {CANCEL_REASONS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <Pin value={pin} onChange={setPin} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || pin.length < 4}
              className="rounded-full border border-line bg-white px-4 py-2 text-sm disabled:opacity-50"
              onClick={() =>
                void run(async () => {
                  const pinToken = await withPin(pin);
                  await api(`referrals/${referral.id}/cancel`, { body: { reason }, pinToken });
                  setPin("");
                })
              }
            >
              Cancel referral
            </button>
            {["PREPARING", "BROADCASTING", "AWAITING_ACCEPTANCE"].includes(referral.status) ? (
              <button
                type="button"
                disabled={busy || pin.length < 4}
                className="rounded-full border border-line bg-white px-4 py-2 text-sm disabled:opacity-50"
                onClick={() =>
                  void run(async () => {
                    const pinToken = await withPin(pin);
                    await api(`referrals/${referral.id}/escalate`, { body: { reason: "Clinic requested regional dispatch support" }, pinToken });
                    setPin("");
                  })
                }
              >
                Escalate
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <section>
        <h3 className="text-sm font-semibold">Timeline</h3>
        <ul className="mt-2 space-y-1 text-xs text-ink/70">
          {referral.timeline.slice(-8).reverse().map((event) => (
            <li key={event.id}>
              {formatClock(event.serverTime)} · {event.type.replaceAll("_", " ")} · {event.actorName}
              {event.reason ? ` · ${event.reason}` : ""}
            </li>
          ))}
          {referral.timeline.length === 0 ? <li>No audit events yet.</li> : null}
        </ul>
      </section>
    </article>
  );
}

function ReleaseBed({
  referralId,
  pin,
  setPin,
  busy,
  run,
}: {
  referralId: string;
  pin: string;
  setPin: (value: string) => void;
  busy: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
}) {
  const [reason, setReason] = useState<(typeof RELEASE_REASONS)[number]>(RELEASE_REASONS[0]);
  return (
    <div className="space-y-3 rounded-2xl bg-paper p-3">
      <p className="text-sm">Release the hold if this hospital can no longer take the patient.</p>
      <select value={reason} onChange={(event) => setReason(event.target.value as (typeof RELEASE_REASONS)[number])} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
        {RELEASE_REASONS.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
      <Pin value={pin} onChange={setPin} />
      <button
        type="button"
        disabled={busy || pin.length < 4}
        className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
        onClick={() =>
          void run(async () => {
            const pinToken = await withPin(pin);
            await api(`referrals/${referralId}/release-bed`, { body: { reason }, pinToken });
            setPin("");
          })
        }
      >
        Release bed
      </button>
    </div>
  );
}

function Pin({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-ink/70">
      PIN
      <input value={value} onChange={(event) => onChange(event.target.value)} inputMode="numeric" type="password" className="mt-1 w-40 rounded-xl border border-line bg-white px-3 py-2 text-sm" />
    </label>
  );
}
