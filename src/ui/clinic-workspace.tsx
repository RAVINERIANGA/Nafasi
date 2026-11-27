"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppNotification, TransportView } from "@/domain/types";
import { ageLabel, cx, formatClock, vitalLine } from "@/domain/format";
import { CATEGORY_LABEL } from "@/domain/labels";
import { OfflineError, api } from "@/services/api";
import {
  OFFLINE_EVENT,
  deleteDraft,
  readDraft,
  readDrafts,
  readLatestAutosave,
  readQueue,
  type DraftRecord,
  type QueueOp,
} from "@/services/offline";
import { useApp } from "@/services/provider";
import { ConnectivityBanner, DeliveryBadge, StatusBadge, problemMessage } from "@/ui/clinic-helpers";
import { ClinicReferralTracker } from "@/ui/clinic-referral";
import { DraftForm } from "@/ui/draft";
import { DeskFrame } from "@/ui/frame";
import type { PresentedReferral } from "@/ui/types";

type FilterMode = "active" | "all" | "closed";

export function ClinicWorkspace() {
  const { ready, session, connectivity } = useApp();
  const [referrals, setReferrals] = useState<PresentedReferral[]>([]);
  const [transports, setTransports] = useState<TransportView[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [localDrafts, setLocalDrafts] = useState<DraftRecord[]>([]);
  const [localQueue, setLocalQueue] = useState<QueueOp[]>([]);
  const [autosaveDraft, setAutosaveDraft] = useState<DraftRecord | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wizardMode, setWizardMode] = useState<{
    open: boolean;
    referral?: PresentedReferral;
    draft?: DraftRecord;
  }>({ open: false });
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("active");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cachedOffline, setCachedOffline] = useState(false);

  const loadLocal = useCallback(async () => {
    if (!session) return;
    try {
      const [drafts, ops, latest] = await Promise.all([
        readDrafts(),
        readQueue(),
        readLatestAutosave(session.facility.id, session.user.id),
      ]);
      setLocalDrafts(drafts.filter((d) => !d.facilityId || d.facilityId === session.facility.id));
      setLocalQueue(ops.filter((o) => !o.facilityId || o.facilityId === session.facility.id));
      if (latest) {
        const p = latest.payload;
        const pt = (p.patient ?? {}) as Record<string, unknown>;
        const nonEmpty =
          Boolean(String(pt.hospitalNumber ?? "").trim()) ||
          Boolean(String(p.diagnosis ?? "").trim()) ||
          Boolean(String(pt.name ?? "").trim()) ||
          (Array.isArray(p.vitals) && p.vitals.length > 0);
        setAutosaveDraft(nonEmpty ? latest : null);
      } else {
        setAutosaveDraft(null);
      }
    } catch {
      /* IndexedDB unavailable */
    }
  }, [session]);

  const loadRemote = useCallback(async () => {
    if (!session || session.user.role !== "clinic") return;
    if (connectivity === "offline") {
      setCachedOffline(true);
      setLoading(false);
      return;
    }
    try {
      const [nextReferrals, nextTransports, nextNotes] = await Promise.all([
        api<PresentedReferral[]>("referrals"),
        api<TransportView[]>("transports"),
        api<AppNotification[]>("notifications"),
      ]);
      setReferrals(nextReferrals);
      setTransports(nextTransports);
      setNotifications(nextNotes.filter((n) => !n.read).slice(0, 4));
      setCachedOffline(false);
      setError("");
      setSelectedId((current) => {
        const pending = sessionStorage.getItem("nafasi-open-referral");
        if (pending && nextReferrals.some((r) => r.id === pending)) {
          sessionStorage.removeItem("nafasi-open-referral");
          setMobileDetailOpen(true);
          return pending;
        }
        if (current && nextReferrals.some((r) => r.id === current)) return current;
        return nextReferrals.find((r) => !["COMPLETED", "CANCELLED"].includes(r.status))?.id ?? nextReferrals[0]?.id ?? null;
      });
    } catch (caught) {
      if (caught instanceof OfflineError) {
        setCachedOffline(true);
      } else {
        setError(problemMessage(caught, "Could not load clinic referrals."));
      }
    } finally {
      setLoading(false);
    }
  }, [session, connectivity]);

  useEffect(() => {
    if (!ready || !session || session.user.role !== "clinic") return;
    void loadLocal();
    void loadRemote();

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const draftParam = params.get("draft");
      if (draftParam) {
        void readDraft(draftParam).then((found) => {
          if (found) {
            setWizardMode({ open: true, draft: found });
            setMobileDetailOpen(true);
          }
        });
      }
    }
  }, [ready, session, loadLocal, loadRemote]);

  useEffect(() => {
    const handler = () => void loadLocal();
    window.addEventListener(OFFLINE_EVENT, handler);
    return () => window.removeEventListener(OFFLINE_EVENT, handler);
  }, [loadLocal]);

  useEffect(() => {
    if (!ready || !session || session.user.role !== "clinic") return;
    if (connectivity === "offline" || !session.token) return;
    const source = new EventSource(`/api/events?token=${encodeURIComponent(session.token)}`);
    const refresh = () => void loadRemote();
    source.addEventListener("referral.updated", refresh);
    source.addEventListener("transport.updated", refresh);
    source.addEventListener("notification.updated", refresh);
    return () => source.close();
  }, [ready, session, connectivity, loadRemote]);

  // Fast background sync refresh only when any referral is awaiting gateway ack or hospital response
  const hasTransientState = referrals.some(
    (r) => r.status === "BROADCASTING" || r.status === "AWAITING_ACCEPTANCE",
  );
  useEffect(() => {
    if (!hasTransientState || connectivity === "offline") return;
    const timer = setInterval(() => void loadRemote(), 2000);
    return () => clearInterval(timer);
  }, [hasTransientState, connectivity, loadRemote]);

  const filteredReferrals = useMemo(() => {
    return referrals.filter((item) => {
      const closed = item.status === "COMPLETED" || item.status === "CANCELLED";
      if (filter === "active") return !closed;
      if (filter === "closed") return closed;
      return true;
    });
  }, [referrals, filter]);

  const selected = referrals.find((r) => r.id === selectedId) ?? null;
  const selectedTransport = selected?.transportId
    ? transports.find((t) => t.id === selected.transportId) ?? null
    : null;

  async function markNoteRead(id: string) {
    setNotifications((curr) => curr.filter((n) => n.id !== id));
    await api(`notifications/${id}/read`, { method: "POST", body: {} }).catch(() => {});
  }

  async function discardAutosave() {
    if (!autosaveDraft) return;
    await deleteDraft(autosaveDraft.id).catch(() => {});
    setAutosaveDraft(null);
  }

  if (!ready || !session || session.user.role !== "clinic") {
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the clinic desk…</p>;
  }

  const showMobileDetail = wizardMode.open || mobileDetailOpen;

  return (
    <DeskFrame role="clinic">
      <div className="space-y-4">
        {/* Top connectivity + primary emergency CTA */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl text-teal-dark">Clinic referrals</h1>
            <p className="text-sm text-ink/70">
              {session.facility.name} · Create, broadcast, and track patient bed reservations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setWizardMode({ open: true });
              setMobileDetailOpen(true);
            }}
            className="min-h-[50px] shrink-0 rounded-full bg-clay px-5 py-2.5 text-sm font-bold text-white shadow-card hover:bg-clay/90"
          >
            + New emergency referral
          </button>
        </div>

        <ConnectivityBanner
          connectivity={connectivity}
          queueCount={localQueue.length}
          draftCount={localDrafts.filter((d) => d.kind === "autosave").length}
        />

        {/* Unsaved local draft banner */}
        {autosaveDraft && !wizardMode.open ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-teal/35 bg-mist px-4 py-3 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-dark">
                Unsaved draft on this device
              </p>
              <p className="text-sm text-ink">
                {String((autosaveDraft.payload.patient as Record<string, unknown> | undefined)?.hospitalNumber || "No hospital ref yet")} ·{" "}
                {typeof autosaveDraft.payload.category === "string" && autosaveDraft.payload.category in CATEGORY_LABEL
                  ? CATEGORY_LABEL[autosaveDraft.payload.category as keyof typeof CATEGORY_LABEL]
                  : "Referral"}{" "}
                · saved {formatClock(autosaveDraft.updatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setWizardMode({ open: true, draft: autosaveDraft });
                  setMobileDetailOpen(true);
                }}
                className="min-h-[42px] rounded-full bg-teal px-4 py-1.5 text-xs font-semibold text-white"
              >
                Resume draft
              </button>
              <button
                type="button"
                onClick={() => void discardAutosave()}
                className="min-h-[42px] rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-semibold text-ink/75"
              >
                Discard
              </button>
            </div>
          </div>
        ) : null}

        {/* Unread alerts */}
        {notifications.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {notifications.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-line bg-card px-3.5 py-2.5 text-xs shadow-card"
              >
                <div>
                  <p className="font-semibold text-teal-dark">{item.title}</p>
                  <p className="mt-0.5 text-ink/75">{item.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void markNoteRead(item.id)}
                  className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink/70"
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {cachedOffline && referrals.length > 0 ? (
          <p className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2 text-xs text-ink">
            Showing last synced referrals while offline. New changes queue locally in{" "}
            <Link href="/clinic/queue" className="font-semibold underline">
              On this device
            </Link>
            .
          </p>
        ) : null}

        {error ? <p className="rounded-xl bg-clay/10 px-3.5 py-2.5 text-sm font-semibold text-clay">{error}</p> : null}

        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* Referral list (hidden on small screens when detail/wizard is open) */}
          <aside className={cx("space-y-3", showMobileDetail ? "hidden lg:block" : "block")}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1 rounded-full border border-line bg-white p-1 text-xs">
                {(
                  [
                    ["active", "Active"],
                    ["all", "All"],
                    ["closed", "Closed"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    className={cx(
                      "min-h-[34px] rounded-full px-3 font-semibold",
                      filter === id ? "bg-teal text-white" : "text-ink/70",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-ink/60">{filteredReferrals.length} shown</span>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((k) => (
                  <div key={k} className="h-24 animate-pulse rounded-2xl border border-line bg-card/60" />
                ))}
              </div>
            ) : null}

            {!loading && filteredReferrals.length === 0 ? (
              <div className="rounded-2xl border border-line bg-card p-5 text-sm text-ink/70">
                {connectivity === "offline" && referrals.length === 0 ? (
                  <div className="space-y-2">
                    <p className="font-semibold text-ink">Offline — no synced referrals cached yet.</p>
                    <p className="text-xs">
                      You can still start an emergency referral; it will save locally and queue in{" "}
                      <Link href="/clinic/queue" className="font-semibold text-teal underline">
                        On this device
                      </Link>
                      .
                    </p>
                  </div>
                ) : (
                  <p>No {filter === "all" ? "" : `${filter} `}referrals for this clinic yet.</p>
                )}
              </div>
            ) : null}

            <ul className="space-y-2.5">
              {filteredReferrals.map((referral) => {
                const isSelected = selectedId === referral.id && !wizardMode.open;
                return (
                  <li key={referral.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setWizardMode({ open: false });
                        setSelectedId(referral.id);
                        setMobileDetailOpen(true);
                      }}
                      className={cx(
                        "w-full rounded-2xl border px-3.5 py-3 text-left transition",
                        isSelected ? "border-teal bg-mist ring-1 ring-teal" : "border-line bg-card hover:border-teal/50",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {referral.patient.name ?? referral.patient.hospitalNumber}
                        </span>
                        <StatusBadge status={referral.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/70">
                        <span>{CATEGORY_LABEL[referral.category]}</span>
                        <span>·</span>
                        <span>{ageLabel(referral.patient.age, referral.patient.ageUnit)}</span>
                        <span>·</span>
                        <span className="font-mono">{referral.patient.hospitalNumber}</span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-ink/75">{referral.diagnosis}</p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink/60">
                        <span>{vitalLine(referral.vitals.at(-1))}</span>
                        <DeliveryBadge delivery={referral.delivery} />
                      </div>
                      {referral.destinationName ? (
                        <p className="mt-1 text-[11px] font-semibold text-teal-dark">
                          → {referral.destinationName}
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Main detail / wizard pane */}
          <section className={cx("space-y-3", showMobileDetail ? "block" : "hidden lg:block")}>
            {showMobileDetail ? (
              <button
                type="button"
                onClick={() => {
                  setWizardMode({ open: false });
                  setMobileDetailOpen(false);
                }}
                className="inline-flex min-h-[42px] items-center rounded-full border border-line bg-white px-4 py-1.5 text-xs font-semibold text-teal-dark lg:hidden"
              >
                ← All referrals
              </button>
            ) : null}

            {wizardMode.open ? (
              <DraftForm
                key={wizardMode.referral?.id ?? wizardMode.draft?.id ?? "new"}
                initialReferral={wizardMode.referral}
                initialDraft={wizardMode.draft}
                onCancel={() => {
                  setWizardMode({ open: false });
                  setMobileDetailOpen(false);
                }}
                onCreated={(referral) => {
                  setWizardMode({ open: false });
                  setReferrals((curr) => [referral, ...curr.filter((r) => r.id !== referral.id)]);
                  setSelectedId(referral.id);
                  setMobileDetailOpen(true);
                  void loadRemote();
                  void loadLocal();
                }}
                onQueued={() => {
                  setWizardMode({ open: false });
                  setMobileDetailOpen(false);
                  void loadLocal();
                }}
              />
            ) : selected ? (
              <ClinicReferralTracker
                referral={selected}
                transport={selectedTransport}
                facilities={session.facilities}
                onUpdated={() => void loadRemote()}
                onEditDraft={(refToEdit) => {
                  setWizardMode({ open: true, referral: refToEdit });
                  setMobileDetailOpen(true);
                }}
              />
            ) : (
              <div className="rounded-3xl border border-line bg-card p-6 text-sm text-ink/70 shadow-card">
                Select a referral to inspect delivery, hospital offers, vitals, and transport progress — or tap{" "}
                <span className="font-semibold text-ink">+ New emergency referral</span> to start one.
              </div>
            )}
          </section>
        </div>
      </div>
    </DeskFrame>
  );
}
