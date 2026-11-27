"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BroadcastMode, RankedFacility } from "@/domain/types";
import { ageLabel, formatKm, vitalLine } from "@/domain/format";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import { DeskFrame } from "@/ui/frame";
import type { PresentedReferral } from "@/ui/types";

type Preview = {
  mode: BroadcastMode;
  ranked: RankedFacility[];
  selected: string[];
  note: string;
};

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "The simulated server could not rank hospitals.";
}

export function RoutingReview({ referralId }: { referralId: string }) {
  const router = useRouter();
  const { connectivity, session } = useApp();
  const [referral, setReferral] = useState<PresentedReferral | null>(null);
  const [mode, setMode] = useState<BroadcastMode>("single");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session || session.user.role !== "clinic") return;
    api<PresentedReferral>(`referrals/${referralId}`)
      .then((row) => {
        setReferral(row);
        setMode(session.config.defaultBroadcastMode);
      })
      .catch((caught) => setError(problem(caught)));
  }, [session, referralId]);

  useEffect(() => {
    if (!referral || connectivity === "offline") return;
    if (referral.status !== "PREPARING" && referral.status !== "ESCALATED") return;
    api<Preview>(`referrals/${referral.id}/routing?mode=${mode}`)
      .then(setPreview)
      .catch((caught) => setError(problem(caught)));
  }, [referral, mode, connectivity]);

  async function broadcast() {
    if (!referral) return;
    setBusy(true);
    setError("");
    try {
      const grant = await api<{ pinToken: string }>("auth/pin", { body: { purpose: "step_up", pin } });
      const result = await api<{ referral: PresentedReferral }>(`referrals/${referral.id}/broadcast`, {
        body: { mode },
        pinToken: grant.pinToken,
      });
      sessionStorage.setItem("nafasi-open-referral", result.referral.id);
      setNote(result.referral.status === "ESCALATED" ? "No eligible hospital. The referral was escalated." : "Broadcast handed to the simulated gateway.");
      router.push("/clinic");
    } catch (caught) {
      setError(problem(caught));
      setBusy(false);
    }
  }

  const open = referral && (referral.status === "PREPARING" || referral.status === "ESCALATED");
  const limit = mode === "parallel" ? session?.config.parallelOfferLimit ?? 3 : 1;

  return (
    <DeskFrame role="clinic">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/clinic" className="text-sm text-teal">
          Back to referrals
        </Link>
        <header>
          <h1 className="font-display text-3xl text-teal-dark">Routing review</h1>
          <p className="mt-1 text-sm text-ink/70">Ranking uses category, capabilities, distance, and the last confirmed capacity. It is not a clinical protocol.</p>
        </header>
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        {note ? <p className="text-sm text-moss">{note}</p> : null}
        {referral ? (
          <article className="rounded-3xl border border-line bg-card p-5 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal">{STATUS_LABEL[referral.status]}</p>
            <h2 className="mt-1 font-display text-2xl">{referral.patient.name ?? referral.patient.hospitalNumber}</h2>
            <p className="text-sm text-ink/70">
              {CATEGORY_LABEL[referral.category]} · {ageLabel(referral.patient.age, referral.patient.ageUnit)} · {referral.diagnosis}
            </p>
            <p className="mt-1 text-sm text-ink/60">{vitalLine(referral.vitals.at(-1))}</p>
          </article>
        ) : null}
        {referral && !open ? (
          <p className="text-sm text-ink/70">This referral is already {STATUS_LABEL[referral.status].toLowerCase()}. Routing is closed.</p>
        ) : null}
        {open && connectivity === "offline" ? <p className="text-sm text-ink/70">The ranking needs the simulated link. This device is offline, so nothing has been sent.</p> : null}
        {open && connectivity !== "offline" ? (
          <section className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <label>
                <input type="radio" checked={mode === "single"} onChange={() => setMode("single")} /> Nearest eligible
              </label>
              <label>
                <input type="radio" checked={mode === "parallel"} onChange={() => setMode("parallel")} /> Up to {session?.config.parallelOfferLimit ?? 3} at once
              </label>
            </div>
            <p className="text-xs text-ink/60">This broadcast would offer {limit === 1 ? "one hospital" : `up to ${limit} hospitals`}.</p>
            {preview?.note ? <p className="text-sm text-ink/70">{preview.note}</p> : null}
            <ul className="space-y-2">
              {(preview?.ranked ?? []).map((item) => {
                const offered = preview?.selected.includes(item.facilityId);
                return (
                  <li key={item.facilityId} className={`rounded-2xl border px-4 py-3 ${offered ? "border-teal bg-mist" : "border-line bg-card"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-xs font-semibold uppercase tracking-wide text-teal-dark">{offered ? "Would be offered" : item.eligible ? "Eligible" : "Not eligible"}</p>
                    </div>
                    <p className="mt-1 text-sm text-ink/70">
                      {formatKm(item.distanceKm)} · {item.etaMin} min · {item.availableBeds} matching {item.availableBeds === 1 ? "bed" : "beds"}
                      {item.capacityStale ? " · capacity stale" : ""}
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-xs text-ink/70">
                      {item.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <label className="block text-xs font-semibold text-ink/70">
              PIN
              <input value={pin} onChange={(event) => setPin(event.target.value)} type="password" inputMode="numeric" className="mt-1 w-40 rounded-xl border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <button type="button" disabled={busy || pin.length < 4 || !preview} onClick={() => void broadcast()} className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Broadcast
            </button>
          </section>
        ) : null}
      </div>
    </DeskFrame>
  );
}
