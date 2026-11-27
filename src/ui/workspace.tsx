"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role, TransportView } from "@/domain/types";
import { ageLabel } from "@/domain/format";
import { CATEGORY_LABEL, STATUS_LABEL } from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import { DraftForm } from "@/ui/draft";
import { DeskFrame } from "@/ui/frame";
import { ReferralDesk } from "@/ui/referral";
import { TransportDesk } from "@/ui/transport";
import type { PresentedReferral } from "@/ui/types";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "The simulated server could not complete that action.";
}

export function RoleHome({ role }: { role: Role }) {
  const { ready, session, connectivity } = useApp();
  const [referrals, setReferrals] = useState<PresentedReferral[]>([]);
  const [transports, setTransports] = useState<TransportView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session || session.user.role !== role) return;
    try {
      if (role === "transport") {
        setTransports(await api<TransportView[]>("transports"));
      } else if (role !== "admin") {
        const rows = await api<PresentedReferral[]>("referrals");
        setReferrals(rows);
        setSelectedId((current) => {
          const pending = sessionStorage.getItem("nafasi-open-referral");
          if (pending && rows.some((row) => row.id === pending)) {
            sessionStorage.removeItem("nafasi-open-referral");
            return pending;
          }
          return current ?? rows.find((row) => !["COMPLETED", "CANCELLED"].includes(row.status))?.id ?? rows[0]?.id ?? null;
        });
      }
      setError("");
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setLoading(false);
    }
  }, [session, role]);

  useEffect(() => {
    if (!ready || !session || session.user.role !== role) return;
    void load();
    if (connectivity === "offline" || !session.token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
    const refresh = () => void load();
    source.addEventListener("referral.updated", refresh);
    source.addEventListener("transport.updated", refresh);
    source.addEventListener("notification.updated", refresh);
    return () => source.close();
  }, [ready, session, role, connectivity, load]);

  if (!ready || !session || session.user.role !== role) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-paper">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal border-t-transparent" />
          <p className="text-sm font-medium text-ink/70">Connecting to facility dashboard...</p>
        </div>
      </div>
    );
  }

  const selected = referrals.find((item) => item.id === selectedId) ?? null;

  return (
    <DeskFrame role={role}>
      {role === "transport" ? (
        <TransportDesk transports={transports} loading={loading} onChanged={() => void load()} />
      ) : role === "clinic" ? (
        <div className="space-y-6">
          {/* Header Stats */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-teal">Referring Facility Console</p>
              <h1 className="font-display text-3xl font-bold text-teal-dark mt-1">
                {session.facility.name}
              </h1>
              <p className="text-xs text-ink/65">
                Active clinician: <strong>{session.user.name}</strong> · Lic: {session.user.registrationNumber}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrafting(true)}
              className="flex items-center gap-2 rounded-2xl bg-clay px-5 py-3 text-sm font-bold text-white shadow-md hover:bg-clay/90 transition active:scale-[0.98]"
            >
              <span className="text-base leading-none">+</span>
              <span>New Emergency Referral</span>
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
            {/* Sidebar list */}
            <aside className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-ink/60">
                  Facility Referrals ({referrals.length})
                </h3>
              </div>

              {loading && <p className="text-sm text-ink/60">Syncing facility registry...</p>}
              {!loading && referrals.length === 0 && (
                <div className="rounded-2xl border border-line bg-card p-6 text-center text-xs text-ink/60">
                  No emergency referrals logged today. Click "+ New Emergency Referral" to initiate dispatch.
                </div>
              )}
              {error && <p className="text-xs text-clay font-medium">{error}</p>}

              <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {referrals.map((r) => {
                  const isSelected = selectedId === r.id && !drafting;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDrafting(false);
                          setSelectedId(r.id);
                        }}
                        className={`w-full rounded-2xl border p-3.5 text-left transition-all ${
                          isSelected
                            ? "border-teal bg-mist/90 shadow-sm ring-1 ring-teal"
                            : "border-line bg-card hover:border-teal/40"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-ink truncate max-w-[170px]">
                            {r.patient.name ?? r.patient.hospitalNumber}
                          </span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-dark border border-line">
                            {STATUS_LABEL[r.status]}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink/70">
                          {CATEGORY_LABEL[r.category]} · {ageLabel(r.patient.age, r.patient.ageUnit)}
                        </p>
                        <p className="mt-1 text-xs text-ink/50 truncate">{r.diagnosis}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Main Area */}
            <section>
              {drafting ? (
                <DraftForm
                  onCancel={() => setDrafting(false)}
                  onCreated={(newRef) => {
                    setDrafting(false);
                    setSelectedId(newRef.id);
                    void load();
                  }}
                />
              ) : selected ? (
                <ReferralDesk
                  key={selected.id + selected.updatedAt}
                  referral={selected}
                  facilities={session.facilities}
                  facilityId={session.facility.id}
                  role={role}
                  onUpdated={() => void load()}
                />
              ) : (
                <div className="rounded-3xl border border-line bg-card p-12 text-center shadow-card">
                  <p className="font-display text-xl text-teal-dark">Select a Referral to Track</p>
                  <p className="mt-1 text-xs text-ink/60">
                    View real-time routing offers, hospital acceptance, locked bed numbers, and ambulance GPS updates.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      ) : null}
    </DeskFrame>
  );
}
