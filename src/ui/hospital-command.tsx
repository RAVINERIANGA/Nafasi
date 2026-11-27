"use client";

import { useCallback, useEffect, useState } from "react";
import type { Facility, Role } from "@/domain/types";
import { ageLabel, formatClock } from "@/domain/format";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import { DeskFrame } from "@/ui/frame";
import { IncomingAlertCard } from "@/ui/alert-card";
import { PreArrivalBoard } from "@/ui/pre-arrival";
import { MiniCountdown } from "@/ui/countdown";
import type { PresentedReferral } from "@/ui/types";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "The simulated server could not complete that action.";
}

type View = "list" | "alert" | "pre-arrival";

/**
 * Hospital ED Command Center.
 *
 * Shows:
 * - A list of incoming referrals with urgency indicators
 * - Incoming alert card with 60-second countdown for pending offers
 * - Pre-arrival preparation board for accepted referrals
 */
export function HospitalCommand() {
  const { ready, session, connectivity } = useApp();
  const [referrals, setReferrals] = useState<PresentedReferral[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session || session.user.role !== "hospital") return;
    try {
      const rows = await api<PresentedReferral[]>("referrals");
      setReferrals(rows);
      setError("");
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!ready || !session || session.user.role !== "hospital") return;
    void load();
    if (connectivity === "offline" || !session.token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
    const refresh = () => void load();
    source.addEventListener("referral.updated", refresh);
    source.addEventListener("notification.updated", refresh);
    source.addEventListener("capacity.updated", refresh);
    return () => source.close();
  }, [ready, session, connectivity, load]);

  if (!ready || !session || session.user.role !== "hospital") {
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the simulation…</p>;
  }

  const facilityId = session.facility.id;
  const selected = referrals.find((r) => r.id === selectedId) ?? null;

  // Categorize referrals
  const pending = referrals.filter((r) =>
    r.offers.some((o) => o.facilityId === facilityId && o.status === "pending")
  );
  const accepted = referrals.filter(
    (r) =>
      r.destinationFacilityId === facilityId &&
      ["ACCEPTED", "TRANSPORT_ASSIGNED", "EN_ROUTE"].includes(r.status)
  );
  const arrivedOrDone = referrals.filter(
    (r) =>
      r.destinationFacilityId === facilityId &&
      ["ARRIVED", "COMPLETED"].includes(r.status)
  );

  function selectReferral(id: string) {
    const ref = referrals.find((r) => r.id === id);
    if (!ref) return;
    setSelectedId(id);
    const hasPending = ref.offers.some(
      (o) => o.facilityId === facilityId && o.status === "pending"
    );
    if (hasPending) {
      setView("alert");
    } else {
      setView("pre-arrival");
    }
  }

  return (
    <DeskFrame role="hospital">
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Sidebar: referral list */}
        <aside className="space-y-4">
          <h1 className="font-display text-2xl text-teal-dark">ED Command</h1>

          {/* Pending offers — highest priority */}
          {pending.length > 0 && (
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-clay">
                <span className="inline-block h-2 w-2 rounded-full bg-clay animate-pulse" />
                Incoming ({pending.length})
              </p>
              <ul className="mt-2 space-y-2">
                {pending.map((r) => {
                  const offer = r.offers.find(
                    (o) => o.facilityId === facilityId && o.status === "pending"
                  );
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => selectReferral(r.id)}
                        className={`w-full rounded-2xl border-2 px-3 py-3 text-left ${
                          selectedId === r.id
                            ? "border-clay bg-clay/5"
                            : "border-clay/30 bg-card"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold">
                            {CATEGORY_LABEL[r.category]}
                          </span>
                          {offer && <MiniCountdown expiresAt={offer.expiresAt} />}
                        </span>
                        <span className="mt-1 block text-xs text-ink/70">
                          {r.patient.name ?? r.patient.hospitalNumber} ·{" "}
                          {ageLabel(r.patient.age, r.patient.ageUnit)}
                        </span>
                        <span className="mt-1 block text-xs text-ink/60">
                          {r.diagnosis}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Accepted / en route */}
          {accepted.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-teal-dark">
                Preparing ({accepted.length})
              </p>
              <ul className="mt-2 space-y-2">
                {accepted.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => selectReferral(r.id)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left ${
                        selectedId === r.id
                          ? "border-teal bg-mist"
                          : "border-line bg-card"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {r.patient.name ?? r.patient.hospitalNumber}
                        </span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-teal-dark">
                          {STATUS_LABEL[r.status]}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-ink/70">
                        {CATEGORY_LABEL[r.category]} · {ageLabel(r.patient.age, r.patient.ageUnit)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Arrived / completed */}
          {arrivedOrDone.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
                Recent ({arrivedOrDone.length})
              </p>
              <ul className="mt-2 space-y-2">
                {arrivedOrDone.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => selectReferral(r.id)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left ${
                        selectedId === r.id
                          ? "border-teal bg-mist"
                          : "border-line bg-card"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {r.patient.name ?? r.patient.hospitalNumber}
                        </span>
                        <span className={`text-[11px] font-semibold uppercase tracking-wide ${r.status === "COMPLETED" ? "text-moss" : "text-teal-dark"}`}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-ink/60">
                        {CATEGORY_LABEL[r.category]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loading && (
            <p className="text-sm text-ink/60">Loading the simulated board…</p>
          )}
          {!loading && referrals.length === 0 && (
            <p className="text-sm text-ink/60">
              No referrals for this facility yet.
            </p>
          )}
          {error && <p className="text-sm text-clay">{error}</p>}
        </aside>

        {/* Main area */}
        <section>
          {selected && view === "alert" && (
            <IncomingAlertCard
              key={selected.id + selected.updatedAt}
              referral={selected}
              facilityId={facilityId}
              facilities={session.facilities}
              onUpdated={() => void load()}
            />
          )}
          {selected && view === "pre-arrival" && (
            <PreArrivalBoard
              key={selected.id + selected.updatedAt}
              referral={selected}
              facilityId={facilityId}
              facilities={session.facilities}
              onUpdated={() => void load()}
            />
          )}
          {!selected && (
            <div className="rounded-3xl border border-line bg-card p-8 text-center shadow-card">
              <p className="font-display text-xl text-teal-dark">Select a referral</p>
              <p className="mt-2 text-sm text-ink/60">
                Incoming emergencies appear on the left with a countdown. Accepted referrals show the pre-arrival board.
              </p>
            </div>
          )}
        </section>
      </div>
    </DeskFrame>
  );
}
