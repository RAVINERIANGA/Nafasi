"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Avpu, TransportStatus, TransportView } from "@/domain/types";
import {
  ageLabel,
  cx,
  distanceKm,
  formatClock,
  formatKm,
  vitalLine,
} from "@/domain/format";
import {
  AVPU_LABEL,
  CATEGORY_LABEL,
  STATUS_LABEL,
  TRANSPORT_LABEL,
} from "@/domain/labels";
import { OfflineError, api } from "@/services/api";
import {
  readTransportPending,
  saveTransportPending,
  type TransportPendingUpdate,
} from "@/services/offline";
import { useApp } from "@/services/provider";
import { ConnectivityBanner, problemMessage } from "@/ui/clinic-helpers";
import { DeskFrame } from "@/ui/frame";
import type { PresentedReferral } from "@/ui/types";

const TRANSPORT_ORDER: TransportStatus[] = [
  "requested",
  "accepted",
  "at_clinic",
  "onboard",
  "en_route",
  "arrived",
];

const NEXT_ACTION_LABEL: Partial<Record<TransportStatus, string>> = {
  requested: "Accept assignment",
  accepted: "Arrived at clinic",
  at_clinic: "Patient onboard",
  onboard: "En route",
  en_route: "Arrived at hospital",
};

const QUICK_NOTES = [
  "Proceeding to clinic",
  "Patient loaded & stable",
  "On main road",
  "Traffic delay (+10 min)",
  "Approaching ED bay",
];

export function TransportWorkspace() {
  const { ready, session, connectivity } = useApp();
  const [transports, setTransports] = useState<TransportView[]>([]);
  const [detailsByReferral, setDetailsByReferral] = useState<Record<string, PresentedReferral>>({});
  const [pendingUpdates, setPendingUpdates] = useState<TransportPendingUpdate[]>([]);
  const [tab, setTab] = useState<"active" | "arrived">("active");

  const [expandedVitalId, setExpandedVitalId] = useState<string | null>(null);
  const [statusNotes, setStatusNotes] = useState<Record<string, string>>({});

  // Vital input state for active vital drawer
  const [spo2, setSpo2] = useState("");
  const [pulse, setPulse] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [avpu, setAvpu] = useState<Avpu | "">("");
  const [vitalNote, setVitalNote] = useState("");

  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const loadPending = useCallback(() => {
    if (!session) return;
    setPendingUpdates(readTransportPending(session.user.id));
  }, [session]);

  const loadTransports = useCallback(async () => {
    if (!session || session.user.role !== "transport") return;
    if (connectivity === "offline") {
      setLoading(false);
      return;
    }
    try {
      const list = await api<TransportView[]>("transports");
      setTransports(list);
      setError("");

      // Fetch redacted clinical/vitals/prep context for active assignments
      const activeIds = list
        .filter((item) => item.status !== "arrived")
        .map((item) => item.referralId);
      const results = await Promise.all(
        activeIds.map(async (refId) => {
          try {
            const detail = await api<PresentedReferral>(`referrals/${refId}`);
            return [refId, detail] as const;
          } catch {
            return null;
          }
        }),
      );
      setDetailsByReferral((curr) => {
        const next = { ...curr };
        for (const entry of results) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    } catch (caught) {
      if (!(caught instanceof OfflineError)) {
        setError(problemMessage(caught, "Could not load transport assignments."));
      }
    } finally {
      setLoading(false);
    }
  }, [session, connectivity]);

  useEffect(() => {
    if (!ready || !session || session.user.role !== "transport") return;
    loadPending();
    void loadTransports();
  }, [ready, session, loadPending, loadTransports]);

  useEffect(() => {
    if (!ready || !session || session.user.role !== "transport") return;
    if (connectivity === "offline" || !session.token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
    const refresh = () => void loadTransports();
    source.addEventListener("transport.updated", refresh);
    source.addEventListener("referral.updated", refresh);
    return () => source.close();
  }, [ready, session, connectivity, loadTransports]);

  function openVitalsDrawer(item: TransportView) {
    if (expandedVitalId === item.id) {
      setExpandedVitalId(null);
      return;
    }
    const detail = detailsByReferral[item.referralId];
    const latest = detail?.vitals.at(-1);
    const sVal = latest?.spo2 ?? item.summary.spo2;
    const pVal = latest?.pulse ?? item.summary.pulse;
    const sysVal = latest?.systolic ?? item.summary.systolic;
    const diaVal = latest?.diastolic ?? item.summary.diastolic;
    setSpo2(sVal !== undefined ? String(sVal) : "");
    setPulse(pVal !== undefined ? String(pVal) : "");
    setSystolic(sysVal !== undefined ? String(sysVal) : "");
    setDiastolic(diaVal !== undefined ? String(diaVal) : "");
    setAvpu((latest?.avpu ?? item.summary.avpu ?? "") as Avpu | "");
    setVitalNote("");
    setExpandedVitalId(item.id);
  }

  function queueTransportOffline(update: TransportPendingUpdate) {
    if (!session) return;
    const next = [...readTransportPending(session.user.id), update];
    saveTransportPending(session.user.id, next);
    setPendingUpdates(next);
  }

  async function advanceStatus(item: TransportView) {
    const next = TRANSPORT_ORDER[TRANSPORT_ORDER.indexOf(item.status) + 1];
    if (!next) return;
    const customNote = statusNotes[item.id]?.trim() || undefined;
    setError("");
    setNote("");

    if (connectivity === "offline") {
      queueTransportOffline({
        id: `tp_${crypto.randomUUID().slice(0, 8)}`,
        kind: "status",
        transportId: item.id,
        referralId: item.referralId,
        status: next,
        note: customNote,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastError: "Queued while offline — NOT sent to hospital yet.",
      });
      setNote(`Device offline — "${TRANSPORT_LABEL[next]}" queued locally (NOT sent).`);
      return;
    }

    setBusyKey(item.id);
    try {
      await api(`transports/${item.id}/status`, {
        method: "PATCH",
        body: { status: next, note: customNote },
      });
      setStatusNotes((curr) => ({ ...curr, [item.id]: "" }));
      setNote(`Updated to ${TRANSPORT_LABEL[next]}.`);
      await loadTransports();
    } catch (caught) {
      if (caught instanceof OfflineError) {
        queueTransportOffline({
          id: `tp_${crypto.randomUUID().slice(0, 8)}`,
          kind: "status",
          transportId: item.id,
          referralId: item.referralId,
          status: next,
          note: customNote,
          createdAt: new Date().toISOString(),
          attempts: 0,
          lastError: "Connection lost — update saved locally, NOT sent yet.",
        });
        setNote(`Connection lost — "${TRANSPORT_LABEL[next]}" saved locally (NOT sent).`);
      } else {
        setError(problemMessage(caught, "Could not update transport status."));
      }
    } finally {
      setBusyKey("");
    }
  }

  async function submitEnRouteVitals(item: TransportView) {
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
      setError("Enter at least one vital reading.");
      return;
    }

    if (connectivity === "offline") {
      queueTransportOffline({
        id: `tp_${crypto.randomUUID().slice(0, 8)}`,
        kind: "vitals",
        transportId: item.id,
        referralId: item.referralId,
        body,
        createdAt: new Date().toISOString(),
        attempts: 0,
        lastError: "En-route vitals queued locally — NOT sent to hospital yet.",
      });
      setExpandedVitalId(null);
      setNote("Device offline — en-route vitals queued locally (NOT sent).");
      return;
    }

    setBusyKey(`vital_${item.id}`);
    try {
      const updated = await api<PresentedReferral>(`referrals/${item.referralId}/vitals`, { body });
      setDetailsByReferral((curr) => ({ ...curr, [item.referralId]: updated }));
      setExpandedVitalId(null);
      setVitalNote("");
      setNote("En-route vitals sent to receiving hospital.");
      await loadTransports();
    } catch (caught) {
      if (caught instanceof OfflineError) {
        queueTransportOffline({
          id: `tp_${crypto.randomUUID().slice(0, 8)}`,
          kind: "vitals",
          transportId: item.id,
          referralId: item.referralId,
          body,
          createdAt: new Date().toISOString(),
          attempts: 0,
          lastError: "Connection lost — vitals saved locally, NOT sent yet.",
        });
        setExpandedVitalId(null);
        setNote("Connection lost — en-route vitals queued locally (NOT sent).");
      } else {
        setError(problemMessage(caught, "Could not save en-route vitals."));
      }
    } finally {
      setBusyKey("");
    }
  }

  async function retryPending() {
    if (!session || connectivity === "offline") return;
    setBusyKey("retry_pending");
    setError("");
    setNote("");
    const current = readTransportPending(session.user.id);
    const remaining: TransportPendingUpdate[] = [];
    let sentCount = 0;

    for (const item of current) {
      try {
        if (item.kind === "status") {
          await api(`transports/${item.transportId}/status`, {
            method: "PATCH",
            body: { status: item.status, note: item.note },
          });
        } else {
          await api(`referrals/${item.referralId}/vitals`, { body: item.body });
        }
        sentCount += 1;
      } catch (caught) {
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastError: problemMessage(caught, "Retry failed."),
        });
      }
    }

    saveTransportPending(session.user.id, remaining);
    setPendingUpdates(remaining);
    if (sentCount > 0) {
      setNote(`Sent ${sentCount} pending crew ${sentCount === 1 ? "update" : "updates"} to server.`);
      await loadTransports();
    }
    if (remaining.length > 0) {
      setError(`${remaining.length} crew update${remaining.length === 1 ? "" : "s"} could not be sent yet.`);
    }
    setBusyKey("");
  }

  function stepNumber(current: string, delta: number, min: number, max: number, baseline: number) {
    const num = current.trim() === "" ? baseline : Number(current);
    const next = Math.max(min, Math.min(max, Math.round((Number.isFinite(num) ? num : baseline) + delta)));
    return String(next);
  }

  const activeList = useMemo(() => transports.filter((t) => t.status !== "arrived"), [transports]);
  const arrivedList = useMemo(() => transports.filter((t) => t.status === "arrived"), [transports]);
  const visibleList = tab === "active" ? activeList : arrivedList;

  if (!ready || !session || session.user.role !== "transport") {
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the transport desk…</p>;
  }

  const isDispatcher = session.user.subrole === "dispatcher";

  return (
    <DeskFrame role="transport">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal">
              {isDispatcher ? "Dispatch console" : "Ambulance crew view"}
            </p>
            <h1 className="font-display text-3xl text-teal-dark">Transport assignments</h1>
            <p className="mt-1 text-xs text-ink/70">
              Privacy lock: patient name and clinic hospital number remain hidden from transport. Destination hospital is fixed on bed lock.
            </p>
          </div>
          <div className="flex gap-1 rounded-full border border-line bg-white p-1 text-xs">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={cx(
                "min-h-[38px] rounded-full px-4 font-semibold",
                tab === "active" ? "bg-teal text-white" : "text-ink/70",
              )}
            >
              Active ({activeList.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("arrived")}
              className={cx(
                "min-h-[38px] rounded-full px-4 font-semibold",
                tab === "arrived" ? "bg-teal text-white" : "text-ink/70",
              )}
            >
              Arrived ({arrivedList.length})
            </button>
          </div>
        </header>

        <ConnectivityBanner connectivity={connectivity} queueCount={pendingUpdates.length} draftCount={0} showQueueLink={false} />

        {pendingUpdates.length > 0 ? (
          <div className="rounded-2xl border border-amber/35 bg-amber/10 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {pendingUpdates.length} pending crew {pendingUpdates.length === 1 ? "update" : "updates"} saved locally (not sent)
                </p>
                <p className="text-xs text-ink/75">
                  {connectivity === "offline"
                    ? "Waiting for connectivity to return before sending to hospital."
                    : "Link is back — tap Retry now to send queued status or vital updates."}
                </p>
              </div>
              <button
                type="button"
                disabled={connectivity === "offline" || busyKey === "retry_pending"}
                onClick={() => void retryPending()}
                className="min-h-[46px] rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-45"
              >
                {busyKey === "retry_pending" ? "Sending…" : "Retry pending updates"}
              </button>
            </div>
            <ul className="space-y-1 text-xs text-ink/80">
              {pendingUpdates.map((p) => (
                <li key={p.id}>
                  • {p.kind === "status" ? `Status → ${TRANSPORT_LABEL[p.status]}` : "En-route vitals"} ({formatClock(p.createdAt)})
                  {p.lastError ? ` — ${p.lastError}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? <p className="rounded-2xl bg-clay/10 px-4 py-3 text-sm font-semibold text-clay">{error}</p> : null}
        {note ? <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-semibold text-teal-dark">{note}</p> : null}

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((k) => (
              <div key={k} className="h-56 animate-pulse rounded-3xl border border-line bg-card/60" />
            ))}
          </div>
        ) : null}

        {!loading && visibleList.length === 0 ? (
          <div className="rounded-3xl border border-line bg-card p-6 text-sm text-ink/70 shadow-card">
            {tab === "active"
              ? "No active ambulance assignment is waiting for this account."
              : "No completed transport arrivals recorded yet."}
          </div>
        ) : null}

        <ul className="space-y-4">
          {visibleList.map((item) => {
            const currentIdx = TRANSPORT_ORDER.indexOf(item.status);
            const nextStatus = TRANSPORT_ORDER[currentIdx + 1];
            const nextLabel = NEXT_ACTION_LABEL[item.status];
            const detail = detailsByReferral[item.referralId];

            const originFac = session.facilities.find((f) => f.id === item.originFacilityId);
            const destFac = session.facilities.find((f) => f.id === item.destinationFacilityId);
            const routeKm = originFac && destFac ? distanceKm(originFac, destFac) : null;
            const latestVital = detail?.vitals.at(-1);

            const crewBadge =
              !item.crewUserId
                ? "Unassigned — tap Accept to claim"
                : item.crewUserId === session.user.id
                  ? "Assigned to you"
                  : "Assigned to crew";

            return (
              <li key={item.id} className="rounded-3xl border border-line bg-card p-4 shadow-card sm:p-6 space-y-4">
                {/* Top Status & Category */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-teal px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                        {TRANSPORT_LABEL[item.status]}
                      </span>
                      <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-[11px] font-semibold text-ink/75">
                        {crewBadge}
                      </span>
                    </div>
                    <h2 className="mt-2 font-display text-2xl text-teal-dark sm:text-3xl">
                      {CATEGORY_LABEL[item.summary.category]} · {ageLabel(item.summary.age, item.summary.ageUnit)} · {item.summary.sex}
                    </h2>
                    <p className="mt-1 text-base font-medium text-ink">{item.summary.diagnosis}</p>
                  </div>
                  <div className="text-right text-xs text-ink/60">
                    <p className="font-semibold text-ink">ETA ~{item.etaMin} min</p>
                    {routeKm !== null ? <p>{formatKm(routeKm)} route</p> : null}
                    <p>Updated {formatClock(item.updatedAt)}</p>
                  </div>
                </div>

                {/* Journey progress steps */}
                <ol className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                  {TRANSPORT_ORDER.map((step, idx) => {
                    const done = idx < currentIdx || item.status === "arrived";
                    const active = idx === currentIdx && item.status !== "arrived";
                    return (
                      <li
                        key={step}
                        className={cx(
                          "rounded-xl border px-2 py-2 text-center text-[11px] font-semibold leading-tight",
                          done
                            ? "border-moss/30 bg-moss/10 text-moss"
                            : active
                              ? "border-teal bg-mist text-teal-dark ring-1 ring-teal"
                              : "border-line bg-white text-ink/45",
                        )}
                      >
                        {TRANSPORT_LABEL[step]}
                      </li>
                    );
                  })}
                </ol>

                {/* Fixed route & destination lock */}
                <div className="grid gap-3 rounded-2xl border border-teal/25 bg-mist/60 p-3.5 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/55">Pickup (referring clinic)</p>
                    <p className="mt-0.5 text-base font-semibold text-ink">{item.summary.originName}</p>
                    {originFac?.phone ? <p className="font-mono text-xs text-ink/70">{originFac.phone}</p> : null}
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-dark">
                        Fixed destination hospital
                      </p>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-teal-dark border border-teal/30">
                        Locked
                      </span>
                    </div>
                    <p className="mt-0.5 text-base font-bold text-teal-dark">{item.summary.destinationName}</p>
                    {destFac?.phone ? <p className="font-mono text-xs text-ink/70">{destFac.phone}</p> : null}
                    <p className="mt-0.5 text-[11px] text-ink/65">
                      Referral: {STATUS_LABEL[item.summary.referralStatus]} · Crew cannot alter destination
                    </p>
                  </div>
                </div>

                {/* Clinical snapshot + allergies + prep */}
                <div className="grid gap-3 rounded-2xl border border-line bg-paper/70 p-3.5 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">Latest vitals & allergies</p>
                    <p className="mt-1 font-semibold text-ink">
                      {latestVital
                        ? vitalLine(latestVital)
                        : vitalLine({
                            systolic: item.summary.systolic,
                            diastolic: item.summary.diastolic,
                            pulse: item.summary.pulse,
                            spo2: item.summary.spo2,
                            avpu: item.summary.avpu,
                          })}
                    </p>
                    <p className="mt-1 text-xs text-ink/75">
                      <span className="font-semibold">Allergies:</span> {item.summary.allergies || "None known"}
                    </p>
                    {detail?.interventions.length ? (
                      <p className="mt-0.5 text-xs text-ink/75">
                        <span className="font-semibold">Given:</span> {detail.interventions.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink/55">Hospital readiness</p>
                    {detail?.prep.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {detail.prep.map((p) => (
                          <span
                            key={p.key}
                            className={cx(
                              "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                              p.acknowledgedAt ? "border-moss/40 bg-moss/10 text-moss" : "border-line bg-white text-ink/60",
                            )}
                          >
                            {p.label} {p.acknowledgedAt ? "✓" : "…"}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-ink/65">
                        {item.note ? `Last crew note: "${item.note}"` : "No status note recorded yet."}
                      </p>
                    )}
                  </div>
                </div>

                {/* Recent vitals log if loaded */}
                {detail && detail.vitals.length > 0 ? (
                  <details className="rounded-2xl border border-line bg-white px-3.5 py-2.5 text-xs">
                    <summary className="cursor-pointer font-semibold text-teal-dark">
                      Vitals log ({detail.vitals.length} {detail.vitals.length === 1 ? "reading" : "readings"})
                    </summary>
                    <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
                      {[...detail.vitals].reverse().map((v) => (
                        <li key={v.id}>
                          <span className="font-semibold text-ink">{vitalLine(v)}</span>{" "}
                          <span className="text-ink/60">
                            · {v.context.replaceAll("_", " ")} · {formatClock(v.serverTime || v.deviceTime)} · {v.recordedBy.name}
                            {v.note ? ` · ${v.note}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {/* Glove-friendly status note + huge primary status button */}
                {nextStatus && nextLabel ? (
                  <div className="space-y-3 border-t border-line pt-4">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Optional crew note</p>
                      <div className="flex flex-wrap gap-1.5">
                        {QUICK_NOTES.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setStatusNotes((curr) => ({ ...curr, [item.id]: preset }))}
                            className={cx(
                              "min-h-[38px] rounded-full border px-3 py-1 text-xs font-semibold",
                              statusNotes[item.id] === preset
                                ? "border-teal bg-mist text-teal-dark"
                                : "border-line bg-paper text-ink/80",
                            )}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <input
                        value={statusNotes[item.id] ?? ""}
                        onChange={(e) => setStatusNotes((curr) => ({ ...curr, [item.id]: e.target.value }))}
                        placeholder="Optional status or ETA note…"
                        className="min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <button
                        type="button"
                        disabled={busyKey === item.id}
                        onClick={() => void advanceStatus(item)}
                        className="min-h-[58px] w-full rounded-2xl bg-teal px-6 py-3.5 text-base font-bold text-white shadow-card hover:bg-teal-dark disabled:opacity-50"
                      >
                        {busyKey === item.id ? "Updating…" : nextLabel}
                      </button>

                      <button
                        type="button"
                        onClick={() => openVitalsDrawer(item)}
                        className="min-h-[58px] rounded-2xl border-2 border-teal bg-mist px-5 py-3.5 text-sm font-bold text-teal-dark hover:bg-white"
                      >
                        {expandedVitalId === item.id ? "Close vitals" : "+ En-route vitals"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-2xl bg-moss/10 px-4 py-3 text-sm font-semibold text-moss">
                    Arrival at {item.summary.destinationName} recorded. Hospital completes final bed handover.
                  </p>
                )}

                {/* Glove-friendly quick vital entry drawer */}
                {expandedVitalId === item.id && nextStatus ? (
                  <div className="space-y-4 rounded-2xl border-2 border-teal/40 bg-paper p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-teal-dark">Quick en-route vital entry</h3>
                      <span className="text-xs text-ink/60">Tagged en_route · notifies hospital</span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* SpO2 */}
                      <div className="rounded-2xl border border-line bg-white p-3">
                        <span className="block text-xs font-semibold text-ink/70">SpO₂ (%)</span>
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSpo2((v) => stepNumber(v, -1, 40, 100, 95))}
                            className="min-h-[48px] min-w-[48px] rounded-xl border border-line bg-paper text-lg font-bold"
                            aria-label="Decrease SpO2"
                          >
                            −
                          </button>
                          <input
                            value={spo2}
                            onChange={(e) => setSpo2(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                            inputMode="numeric"
                            placeholder="%"
                            className="min-h-[48px] w-full rounded-xl border border-line bg-white px-2 text-center font-mono text-xl font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setSpo2((v) => stepNumber(v, 1, 40, 100, 95))}
                            className="min-h-[48px] min-w-[48px] rounded-xl border border-line bg-paper text-lg font-bold"
                            aria-label="Increase SpO2"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Pulse */}
                      <div className="rounded-2xl border border-line bg-white p-3">
                        <span className="block text-xs font-semibold text-ink/70">Heart rate (bpm)</span>
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPulse((v) => stepNumber(v, -5, 20, 260, 100))}
                            className="min-h-[48px] min-w-[48px] rounded-xl border border-line bg-paper text-lg font-bold"
                            aria-label="Decrease pulse"
                          >
                            −
                          </button>
                          <input
                            value={pulse}
                            onChange={(e) => setPulse(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                            inputMode="numeric"
                            placeholder="bpm"
                            className="min-h-[48px] w-full rounded-xl border border-line bg-white px-2 text-center font-mono text-xl font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => setPulse((v) => stepNumber(v, 5, 20, 260, 100))}
                            className="min-h-[48px] min-w-[48px] rounded-xl border border-line bg-paper text-lg font-bold"
                            aria-label="Increase pulse"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Systolic / Diastolic */}
                      <div className="rounded-2xl border border-line bg-white p-3">
                        <span className="block text-xs font-semibold text-ink/70">Blood pressure (mmHg)</span>
                        <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <input
                            value={systolic}
                            onChange={(e) => setSystolic(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                            inputMode="numeric"
                            aria-label="Systolic BP"
                            placeholder="Sys"
                            className="min-h-[48px] w-full rounded-xl border border-line bg-white px-2 text-center font-mono text-lg font-bold"
                          />
                          <span className="font-bold text-ink/50">/</span>
                          <input
                            value={diastolic}
                            onChange={(e) => setDiastolic(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                            inputMode="numeric"
                            aria-label="Diastolic BP"
                            placeholder="Dia"
                            className="min-h-[48px] w-full rounded-xl border border-line bg-white px-2 text-center font-mono text-lg font-bold"
                          />
                        </div>
                      </div>

                      {/* AVPU */}
                      <div className="rounded-2xl border border-line bg-white p-3">
                        <span className="block text-xs font-semibold text-ink/70">AVPU</span>
                        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                          {(["A", "V", "P", "U"] as Avpu[]).map((code) => (
                            <button
                              key={code}
                              type="button"
                              onClick={() => setAvpu((c) => (c === code ? "" : code))}
                              className={cx(
                                "min-h-[48px] rounded-xl border text-center",
                                avpu === code ? "border-teal bg-teal text-white font-bold" : "border-line bg-paper text-ink",
                              )}
                            >
                              <span className="block font-mono text-base">{code}</span>
                              <span className="block text-[9px] leading-none">{AVPU_LABEL[code]}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <input
                      value={vitalNote}
                      onChange={(e) => setVitalNote(e.target.value)}
                      placeholder="Optional en-route observation (e.g. Oxygen flow increased)…"
                      className="min-h-[48px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm"
                    />

                    <button
                      type="button"
                      disabled={busyKey === `vital_${item.id}`}
                      onClick={() => void submitEnRouteVitals(item)}
                      className="min-h-[54px] w-full rounded-2xl bg-teal px-5 py-3 text-base font-bold text-white disabled:opacity-50"
                    >
                      {busyKey === `vital_${item.id}`
                        ? "Sending vitals…"
                        : connectivity === "offline"
                          ? "Queue en-route vitals locally"
                          : "Send en-route vitals to hospital"}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </DeskFrame>
  );
}
