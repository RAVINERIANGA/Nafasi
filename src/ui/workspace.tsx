"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEvent, Facility, Role, TransportView } from "@/domain/types";
import { ageLabel, formatClock } from "@/domain/format";
import { CATEGORY_LABEL, STATUS_LABEL, TRANSPORT_LABEL } from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import { DraftForm } from "@/ui/draft";
import { DeskFrame } from "@/ui/frame";
import { ReferralDesk } from "@/ui/referral";
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
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the simulation…</p>;
  }

  const selected = referrals.find((item) => item.id === selectedId) ?? null;

  return (
    <DeskFrame role={role}>
      {role === "admin" ? <AdminDesk facilities={session.facilities} /> : null}
      {role === "transport" ? <TransportDesk transports={transports} loading={loading} onChanged={() => void load()} /> : null}
      {role === "clinic" || role === "hospital" ? (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="flex items-center justify-between">
                <h1 className="font-display text-2xl text-teal-dark">{role === "clinic" ? "Referrals" : "Incoming"}</h1>
                {role === "clinic" ? (
                  <button type="button" className="rounded-full bg-teal px-3 py-1.5 text-sm font-semibold text-white" onClick={() => setDrafting(true)}>
                    New
                  </button>
                ) : null}
              </div>
              {loading ? <p className="text-sm text-ink/60">Loading the simulated board…</p> : null}
              {!loading && referrals.length === 0 ? <p className="text-sm text-ink/60">No referrals for this facility yet.</p> : null}
              {error ? <p className="text-sm text-clay">{error}</p> : null}
              <ul className="space-y-2">
                {referrals.map((referral) => (
                  <li key={referral.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDrafting(false);
                        setSelectedId(referral.id);
                      }}
                      className={`w-full rounded-2xl border px-3 py-3 text-left ${selectedId === referral.id && !drafting ? "border-teal bg-mist" : "border-line bg-card"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{referral.patient.name ?? referral.patient.hospitalNumber}</span>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-teal-dark">{STATUS_LABEL[referral.status]}</span>
                      </span>
                      <span className="mt-1 block text-xs text-ink/70">
                        {CATEGORY_LABEL[referral.category]} · {ageLabel(referral.patient.age, referral.patient.ageUnit)}
                      </span>
                      <span className="mt-1 block text-xs text-ink/60">{referral.diagnosis}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section>
              {drafting ? (
                <DraftForm
                  onCancel={() => setDrafting(false)}
                  onCreated={(referral) => {
                    setDrafting(false);
                    setSelectedId(referral.id);
                    void load();
                  }}
                />
              ) : selected ? (
                <ReferralDesk referral={selected} facilities={session.facilities} facilityId={session.facility.id} role={role} onUpdated={() => void load()} />
              ) : (
                <p className="text-sm text-ink/60">Select a referral to see the clinical record and the next action.</p>
              )}
            </section>
        </div>
      ) : null}
    </DeskFrame>
  );
}

function TransportDesk({ transports, loading, onChanged }: { transports: TransportView[]; loading: boolean; onChanged: () => void }) {
  const order = ["requested", "accepted", "at_clinic", "onboard", "en_route", "arrived"] as const;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function advance(item: TransportView) {
    const next = order[order.indexOf(item.status) + 1];
    if (!next) return;
    setBusy(item.id);
    setError("");
    try {
      await api(`transports/${item.id}/status`, { method: "PATCH", body: { status: next } });
      onChanged();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="space-y-3">
      <h1 className="font-display text-3xl text-teal-dark">Transport</h1>
      <p className="max-w-2xl text-sm text-ink/70">Crew see age, sex, vitals, allergies, and the two facilities. The patient name stays with the clinic and hospital.</p>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {loading ? <p className="text-sm text-ink/60">Loading assignments…</p> : null}
      {!loading && transports.length === 0 ? <p className="text-sm text-ink/60">No ambulance assignment is waiting for this account.</p> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {transports.map((item) => {
          const next = order[order.indexOf(item.status) + 1];
          return (
            <li key={item.id} className="rounded-3xl border border-line bg-card p-4 shadow-card">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal">{TRANSPORT_LABEL[item.status]}</p>
              <h2 className="mt-1 font-display text-2xl">{CATEGORY_LABEL[item.summary.category]}</h2>
              <p className="text-sm text-ink/70">
                {ageLabel(item.summary.age, item.summary.ageUnit)} · {item.summary.sex}
              </p>
              <p className="mt-2 text-sm">{item.summary.diagnosis}</p>
              <p className="mt-2 text-sm text-ink/70">
                {item.summary.originName} → {item.summary.destinationName}
              </p>
              <p className="mt-1 text-xs text-ink/60">
                {item.summary.spo2 ? `SpO₂ ${item.summary.spo2}%` : "No oxygen reading"} · Allergies: {item.summary.allergies}
              </p>
              <p className="mt-1 text-xs text-ink/50">
                ETA {item.etaMin} min · updated {formatClock(item.updatedAt)}
              </p>
              {next ? (
                <button type="button" disabled={busy === item.id} onClick={() => void advance(item)} className="mt-4 rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  Mark {TRANSPORT_LABEL[next].toLowerCase()}
                </button>
              ) : (
                <p className="mt-4 text-sm text-moss">Arrival is already recorded.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AdminDesk({ facilities }: { facilities: Facility[] }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextStats, nextEvents] = await Promise.all([api<Record<string, unknown>>("analytics"), api<AuditEvent[]>("audit")]);
      setStats(nextStats);
      setEvents(nextEvents.slice(0, 12));
      setError("");
    } catch (caught) {
      setError(problem(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reset() {
    setBusy(true);
    try {
      await api("demo/reset", { method: "POST", body: {} });
      await load();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  const byStatus = (stats?.byStatus ?? {}) as Record<string, number>;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-teal-dark">Regional view</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink/70">Counts and the audit trail for the fictional Kaskazi Coast network. This is not a compliance report.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void reset()} className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Restore demo data
        </button>
      </div>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Referrals", stats?.referrals],
            ["Completed", stats?.completed],
            ["Escalated", stats?.escalated],
            ["Rerouted", stats?.rerouted],
          ] as [string, unknown][]
        ).map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-card p-4 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{label}</p>
            <p className="mt-1 font-display text-3xl">{String(value ?? "—")}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
          <h2 className="font-semibold">By status</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {Object.entries(byStatus).map(([status, count]) => (
              <li key={status} className="flex justify-between gap-3">
                <span>{STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}</span>
                <span className="font-semibold">{count}</span>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
          <h2 className="font-semibold">Facilities</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {facilities.map((facility) => (
              <li key={facility.id} className="flex justify-between gap-3">
                <span>
                  {facility.name}
                  <span className="block text-xs text-ink/50">
                    {facility.type} · {facility.region}
                  </span>
                </span>
                <span className="text-xs text-ink/60">{facility.participating ? "Participating" : "Paused"}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
      <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
        <h2 className="font-semibold">Latest audit</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {events.map((event) => (
            <li key={event.id} className="py-2">
              <span className="font-semibold">{event.type.replaceAll("_", " ")}</span>
              <span className="text-ink/70"> · {event.actorName}</span>
              <span className="block text-xs text-ink/50">
                {formatClock(event.serverTime)}
                {event.reason ? ` · ${event.reason}` : ""}
                {event.referralId ? ` · ${event.referralId}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
