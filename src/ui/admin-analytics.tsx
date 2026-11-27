"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEvent, AuditType, Facility } from "@/domain/types";
import { formatClock, formatDuration, formatWhen } from "@/domain/format";
import { STATUS_LABEL } from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import { DeskFrame } from "@/ui/frame";
import type { PresentedReferral } from "@/ui/types";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "Could not load analytics.";
}

type Stats = {
  referrals: number;
  completed: number;
  escalated: number;
  rerouted: number;
  cancelled: number;
  avgAcceptanceSeconds: number | null;
  avgDoorToBedSeconds: number | null;
  medianAcceptanceSeconds: number | null;
  medianDoorToBedSeconds: number | null;
  bouncesPrevented: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  LOGIN: "Login",
  LOGOUT: "Logout",
  PIN_STEP_UP: "PIN step-up",
  REFERRAL_CREATED: "Referral created",
  REFERRAL_UPDATED: "Referral updated",
  BROADCAST_QUEUED: "Broadcast queued",
  BROADCAST_SENT: "Broadcast sent",
  BROADCAST_DELIVERED: "Broadcast delivered",
  BROADCAST_FAILED: "Broadcast failed",
  DETAIL_VIEWED: "Detail viewed",
  OFFER_ACCEPTED: "Offer accepted",
  OFFER_DECLINED: "Offer declined",
  OFFER_EXPIRED: "Offer expired",
  OFFER_WITHDRAWN: "Offer withdrawn",
  BED_LOCKED: "Bed locked",
  BED_RELEASE_WARNING: "Bed release warning",
  BED_RELEASED: "Bed released",
  TRANSPORT_CREATED: "Transport created",
  TRANSPORT_STATUS: "Transport status",
  PREP_ACK: "Prep acknowledged",
  VITALS_RECORDED: "Vitals recorded",
  ARRIVAL_CONFIRMED: "Arrival confirmed",
  HANDOVER_CONFIRMED: "Handover confirmed",
  CANCELLED: "Cancelled",
  ESCALATED: "Escalated",
  REROUTED: "Rerouted",
  CAPACITY_UPDATED: "Capacity updated",
  USER_CREATED: "User created",
  FACILITY_UPDATED: "Facility updated",
};

/**
 * Enhanced admin analytics dashboard with:
 * - Key performance metrics (acceptance time, door-to-bed, bounce prevention)
 * - Status and category breakdowns
 * - Full audit trail with filtering
 */
export function AdminAnalytics() {
  const { ready, session } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [allEvents, setAllEvents] = useState<AuditEvent[]>([]);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [referralFilter, setReferralFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextStats, nextEvents] = await Promise.all([
        api<Stats>("analytics"),
        api<AuditEvent[]>("audit"),
      ]);
      setStats(nextStats);
      setAllEvents(nextEvents);
      setEvents(nextEvents);
      setError("");
    } catch (caught) {
      setError(problem(caught));
    }
  }, []);

  useEffect(() => {
    if (!ready || !session || session.user.role !== "admin") return;
    void load();
  }, [ready, session, load]);

  useEffect(() => {
    let filtered = allEvents;
    if (eventFilter !== "all") {
      filtered = filtered.filter((e) => e.type === eventFilter);
    }
    if (referralFilter.trim()) {
      const q = referralFilter.trim().toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.referralId?.toLowerCase().includes(q) ||
          e.actorName.toLowerCase().includes(q) ||
          e.facilityName.toLowerCase().includes(q)
      );
    }
    setEvents(filtered);
  }, [eventFilter, referralFilter, allEvents]);

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

  if (!ready || !session || session.user.role !== "admin") {
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the simulation…</p>;
  }

  const byStatus = (stats?.byStatus ?? {}) as Record<string, number>;
  const byCategory = (stats?.byCategory ?? {}) as Record<string, number>;

  // Unique event types for filter
  const eventTypes = Array.from(new Set(allEvents.map((e) => e.type))).sort();

  return (
    <DeskFrame role="admin">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-teal-dark">Regional analytics</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink/70">
              Performance metrics and the full audit trail for the fictional Kaskazi Coast network. This is not a compliance report.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void reset()}
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Restore demo data
          </button>
        </div>

        {error && <p className="text-sm text-clay">{error}</p>}

        {/* Key metrics */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Total referrals" value={stats?.referrals} />
          <MetricCard label="Completed" value={stats?.completed} accent="moss" />
          <MetricCard label="Escalated" value={stats?.escalated} accent="amber" />
          <MetricCard label="Rerouted" value={stats?.rerouted} accent="sky" />
        </div>

        {/* Timing metrics */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Avg acceptance time"
            value={formatDuration(stats?.avgAcceptanceSeconds)}
            small
          />
          <MetricCard
            label="Median acceptance time"
            value={formatDuration(stats?.medianAcceptanceSeconds)}
            small
          />
          <MetricCard
            label="Avg door-to-bed"
            value={formatDuration(stats?.avgDoorToBedSeconds)}
            small
          />
          <MetricCard
            label="Median door-to-bed"
            value={formatDuration(stats?.medianDoorToBedSeconds)}
            small
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* By status */}
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

          {/* By category */}
          <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
            <h2 className="font-semibold">By category</h2>
            <ul className="mt-3 space-y-1 text-sm">
              {Object.entries(byCategory).map(([cat, count]) => (
                <li key={cat} className="flex justify-between gap-3">
                  <span className="capitalize">{cat}</span>
                  <span className="font-semibold">{count as number}</span>
                </li>
              ))}
            </ul>
          </article>

          {/* Facilities */}
          <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
            <h2 className="font-semibold">Facilities</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {session.facilities.map((f) => (
                <li key={f.id} className="flex justify-between gap-3">
                  <span>
                    {f.name}
                    <span className="block text-xs text-ink/50">
                      {f.type} · {f.region}
                    </span>
                  </span>
                  <span className="text-xs text-ink/60">
                    {f.participating ? "Participating" : "Paused"}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        </div>

        {/* Audit trail with filters */}
        <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Audit trail</h2>
            <div className="flex flex-wrap gap-2">
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm"
              >
                <option value="all">All event types</option>
                {eventTypes.map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
              <input
                value={referralFilter}
                onChange={(e) => setReferralFilter(e.target.value)}
                placeholder="Search by ID, name or facility…"
                className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-ink/50">
            Showing {events.length} of {allEvents.length} events.
          </p>
          <div className="mt-3 max-h-[32rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs text-ink/50">
                <tr>
                  <th className="py-1 pr-3">Time</th>
                  <th className="py-1 pr-3">Event</th>
                  <th className="py-1 pr-3">Actor</th>
                  <th className="py-1 pr-3">Facility</th>
                  <th className="py-1 pr-3">Referral</th>
                  <th className="py-1">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.slice(0, 100).map((ev) => (
                  <tr key={ev.id}>
                    <td className="whitespace-nowrap py-2 pr-3 text-xs text-ink/60">
                      {formatClock(ev.serverTime)}
                    </td>
                    <td className="py-2 pr-3 font-semibold">
                      {EVENT_TYPE_LABELS[ev.type] ?? ev.type}
                    </td>
                    <td className="py-2 pr-3">
                      {ev.actorName}
                      <span className="block text-xs text-ink/50">{ev.actorRole}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs">{ev.facilityName}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink/60">
                      {ev.referralId?.slice(0, 12) ?? "—"}
                    </td>
                    <td className="py-2 text-xs text-ink/60">
                      {ev.reason ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {events.length > 100 && (
              <p className="mt-2 text-xs text-ink/50">
                Showing the first 100 events. Use filters to narrow the view.
              </p>
            )}
          </div>
        </article>
      </div>
    </DeskFrame>
  );
}

function MetricCard({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value?: number | string | null;
  accent?: string;
  small?: boolean;
}) {
  const colorMap: Record<string, string> = {
    moss: "text-moss",
    amber: "text-amber",
    sky: "text-sky",
    clay: "text-clay",
  };
  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{label}</p>
      <p
        className={`mt-1 ${small ? "text-lg font-semibold" : "font-display text-3xl"} ${
          accent ? colorMap[accent] ?? "" : ""
        }`}
      >
        {value != null ? String(value) : "—"}
      </p>
    </div>
  );
}
