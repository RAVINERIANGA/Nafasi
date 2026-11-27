"use client";

import { useEffect, useState } from "react";
import type { TransportView } from "@/domain/types";
import { ageLabel, formatClock } from "@/domain/format";
import { CATEGORY_LABEL, TRANSPORT_LABEL } from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "Could not update transport status.";
}

export function TransportDesk({
  transports,
  loading,
  onChanged,
}: {
  transports: TransportView[];
  loading: boolean;
  onChanged: () => void;
}) {
  const order = ["requested", "accepted", "at_clinic", "onboard", "en_route", "arrived"] as const;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selectedTransport, setSelectedTransport] = useState<TransportView | null>(null);

  // En route vital entry states
  const [showVitalsModal, setShowVitalsModal] = useState(false);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [spo2, setSpo2] = useState("");
  const [avpu, setAvpu] = useState("A");
  const [vitalsNote, setVitalsNote] = useState("");

  useEffect(() => {
    if (transports.length > 0 && !selectedTransport) {
      setSelectedTransport(transports[0]);
    } else if (selectedTransport) {
      const refreshed = transports.find((t) => t.id === selectedTransport.id);
      if (refreshed) setSelectedTransport(refreshed);
    }
  }, [transports, selectedTransport]);

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

  async function sendEnRouteVitals(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTransport) return;
    setBusy("vitals");
    setError("");
    try {
      await api(`referrals/${selectedTransport.referralId}/vitals`, {
        body: {
          systolic: systolic ? Number(systolic) : undefined,
          diastolic: diastolic ? Number(diastolic) : undefined,
          pulse: pulse ? Number(pulse) : undefined,
          spo2: spo2 ? Number(spo2) : undefined,
          avpu,
          context: "en_route",
          note: vitalsNote || "Logged en-route in ambulance",
        },
      });
      setShowVitalsModal(false);
      setSystolic("");
      setDiastolic("");
      setPulse("");
      setSpo2("");
      setVitalsNote("");
      onChanged();
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy("");
    }
  }

  const active = selectedTransport ?? transports[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-sky animate-pulse" />
            <p className="text-xs font-bold uppercase tracking-wider text-sky">EMS Ambulance Console</p>
          </div>
          <h1 className="font-display text-3xl font-bold text-teal-dark mt-1">Field Transport Dispatch</h1>
          <p className="text-xs text-ink/70">Touch-optimized for ambulance mobile tablets and gloved interaction.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-clay/30 bg-clay/5 p-3.5 text-xs text-clay font-medium">
          ⚠️ {error}
        </div>
      )}

      {loading && <p className="text-sm text-ink/60">Connecting to telemetry network...</p>}
      {!loading && transports.length === 0 && (
        <div className="rounded-3xl border border-line bg-card p-8 text-center shadow-card">
          <p className="font-display text-xl text-teal-dark">No Active Ambulance Assignments</p>
          <p className="mt-1 text-xs text-ink/60">
            When a clinic referral is accepted and locks a hospital bed, dispatch missions will appear here.
          </p>
        </div>
      )}

      {transports.length > 0 && active && (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Left Column: Active Mission Action Panel */}
          <section className="space-y-4">
            <article className="rounded-3xl border-2 border-teal/30 bg-card p-6 shadow-card space-y-5">
              <div className="flex items-center justify-between border-b border-line pb-4">
                <div>
                  <span className="rounded-full bg-mist px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-dark border border-teal/20">
                    Status: {TRANSPORT_LABEL[active.status]}
                  </span>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold text-teal-dark mt-2">
                    {CATEGORY_LABEL[active.summary.category]} Emergency
                  </h2>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-bold text-ink/50 uppercase tracking-wide">Transit ETA</p>
                  <p className="font-display text-3xl font-bold text-teal-dark">{active.etaMin} min</p>
                </div>
              </div>

              {/* Transit Route Badge */}
              <div className="rounded-2xl bg-paper p-4 text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal text-white text-[10px] font-bold">A</span>
                  <span className="font-semibold text-ink">Origin: {active.summary.originName}</span>
                </div>
                <div className="ml-2.5 h-4 border-l-2 border-dashed border-teal/40" />
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-moss text-white text-[10px] font-bold">B</span>
                  <span className="font-semibold text-teal-dark">Locked Destination: {active.summary.destinationName}</span>
                </div>
              </div>

              {/* Patient summary (Minimal fields for EMS privacy) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-xl border border-line bg-white p-2.5">
                  <p className="text-[10px] font-bold text-ink/50 uppercase">Demographics</p>
                  <p className="font-semibold mt-0.5">{ageLabel(active.summary.age, active.summary.ageUnit)} · {active.summary.sex}</p>
                </div>
                <div className="rounded-xl border border-line bg-white p-2.5">
                  <p className="text-[10px] font-bold text-ink/50 uppercase">SpO₂</p>
                  <p className="font-semibold mt-0.5">{active.summary.spo2 ? `${active.summary.spo2}%` : "—"}</p>
                </div>
                <div className="rounded-xl border border-line bg-white p-2.5">
                  <p className="text-[10px] font-bold text-ink/50 uppercase">Pulse</p>
                  <p className="font-semibold mt-0.5">{active.summary.pulse ? `${active.summary.pulse} bpm` : "—"}</p>
                </div>
                <div className="rounded-xl border border-line bg-white p-2.5">
                  <p className="text-[10px] font-bold text-ink/50 uppercase">AVPU</p>
                  <p className="font-semibold mt-0.5">{active.summary.avpu ?? "—"}</p>
                </div>
              </div>

              <div className="text-xs text-ink/75 space-y-1">
                <p><strong>Presentation:</strong> {active.summary.diagnosis}</p>
                <p><strong>Allergies:</strong> {active.summary.allergies || "None reported"}</p>
              </div>

              {/* Big Stage Advance Button for Gloves */}
              {(() => {
                const next = order[order.indexOf(active.status) + 1];
                if (!next) {
                  return (
                    <div className="rounded-2xl bg-moss/10 p-4 text-center">
                      <p className="text-sm font-bold text-moss">✓ Patient Safely Delivered at Hospital Doors</p>
                      <p className="text-xs text-moss/80 mt-0.5">Awaiting receiving ED handover confirmation.</p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-3 pt-2">
                    <button
                      type="button"
                      disabled={busy === active.id}
                      onClick={() => void advance(active)}
                      className="w-full rounded-2xl bg-teal py-4 text-base font-bold text-white shadow-md transition hover:bg-teal-dark active:scale-[0.98] disabled:opacity-50"
                    >
                      {busy === active.id ? "Updating Telemetry..." : `Mark: ${TRANSPORT_LABEL[next].toUpperCase()} →`}
                    </button>
                    {["onboard", "en_route"].includes(active.status) && (
                      <button
                        type="button"
                        onClick={() => setShowVitalsModal(true)}
                        className="w-full rounded-xl border-2 border-teal bg-mist py-2.5 text-xs font-bold text-teal-dark hover:bg-teal hover:text-white transition"
                      >
                        + Log Real-Time En-Route Vitals (Push to ED)
                      </button>
                    )}
                  </div>
                );
              })()}
            </article>

            {/* En Route Vitals Modal */}
            {showVitalsModal && (
              <form onSubmit={sendEnRouteVitals} className="rounded-3xl border border-teal/40 bg-card p-5 shadow-card space-y-4">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-teal-dark">Record En-Route Telemetry</h3>
                  <button type="button" onClick={() => setShowVitalsModal(false)} className="text-xs text-ink/60">✕</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <label className="font-bold text-ink/75">
                    SpO₂ (%)
                    <input value={spo2} onChange={(e) => setSpo2(e.target.value)} placeholder="94" className="mt-1 w-full rounded-xl border border-line p-2" />
                  </label>
                  <label className="font-bold text-ink/75">
                    Pulse (bpm)
                    <input value={pulse} onChange={(e) => setPulse(e.target.value)} placeholder="115" className="mt-1 w-full rounded-xl border border-line p-2" />
                  </label>
                  <label className="font-bold text-ink/75">
                    BP (Sys)
                    <input value={systolic} onChange={(e) => setSystolic(e.target.value)} placeholder="130" className="mt-1 w-full rounded-xl border border-line p-2" />
                  </label>
                  <label className="font-bold text-ink/75">
                    BP (Dia)
                    <input value={diastolic} onChange={(e) => setDiastolic(e.target.value)} placeholder="85" className="mt-1 w-full rounded-xl border border-line p-2" />
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={busy === "vitals"}
                  className="w-full rounded-xl bg-teal py-2.5 text-xs font-bold text-white shadow-sm hover:bg-teal-dark"
                >
                  Broadcast Vitals to ED Command
                </button>
              </form>
            )}
          </section>

          {/* Right Column: Mission Fleet Feed */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink/60">Assigned Transports ({transports.length})</h3>
            <div className="space-y-2">
              {transports.map((t) => {
                const isSelected = active.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTransport(t)}
                    className={`w-full rounded-2xl border p-4 text-left transition-all ${
                      isSelected
                        ? "border-teal bg-mist/80 shadow-sm ring-1 ring-teal"
                        : "border-line bg-card hover:border-teal/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-teal-dark">
                        {TRANSPORT_LABEL[t.status]}
                      </span>
                      <span className="text-xs font-mono font-bold text-ink/60">ETA {t.etaMin}m</span>
                    </div>
                    <p className="font-display text-base font-bold text-ink mt-1">
                      {CATEGORY_LABEL[t.summary.category]}
                    </p>
                    <p className="text-xs text-ink/60 mt-0.5">
                      {t.summary.originName} → {t.summary.destinationName}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
