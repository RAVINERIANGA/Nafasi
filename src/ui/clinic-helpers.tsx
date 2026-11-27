"use client";

import Link from "next/link";
import type { ConnectivityMode, DeliveryState, ReferralStatus } from "@/domain/types";
import { DELIVERY_LABEL, STATUS_LABEL } from "@/domain/labels";
import { cx } from "@/domain/format";
import { ApiClientError, OfflineError } from "@/services/api";

export function problemMessage(error: unknown, fallback = "The simulated server could not complete that action.") {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const STATUS_STYLE: Record<ReferralStatus, string> = {
  PREPARING: "bg-paper text-ink border-line",
  BROADCASTING: "bg-amber/15 text-amber border-amber/30",
  AWAITING_ACCEPTANCE: "bg-sky/10 text-sky border-sky/30",
  ACCEPTED: "bg-moss/10 text-moss border-moss/30",
  TRANSPORT_ASSIGNED: "bg-mist text-teal-dark border-teal/30",
  EN_ROUTE: "bg-sky/10 text-sky border-sky/30",
  ARRIVED: "bg-moss/15 text-moss border-moss/40",
  COMPLETED: "bg-moss text-white border-moss",
  CANCELLED: "bg-paper text-ink/70 border-line",
  ESCALATED: "bg-clay/10 text-clay border-clay/30",
};

const DELIVERY_STYLE: Record<DeliveryState, string> = {
  draft: "bg-paper text-ink/75 border-line",
  queued: "bg-amber/15 text-amber border-amber/30",
  sent: "bg-sky/10 text-sky border-sky/30",
  delivered: "bg-moss/10 text-moss border-moss/30",
  partial: "bg-amber/15 text-amber border-amber/30",
  failed: "bg-clay/10 text-clay border-clay/30",
};

export function StatusBadge({ status }: { status: ReferralStatus }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function DeliveryBadge({ delivery }: { delivery: DeliveryState }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", DELIVERY_STYLE[delivery])}>
      {DELIVERY_LABEL[delivery]}
    </span>
  );
}

const CANONICAL_FLOW: ReferralStatus[] = [
  "PREPARING",
  "BROADCASTING",
  "AWAITING_ACCEPTANCE",
  "ACCEPTED",
  "TRANSPORT_ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "COMPLETED",
];

export function StatusStepper({ status }: { status: ReferralStatus }) {
  const activeIdx = CANONICAL_FLOW.indexOf(status);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-ink/60">Referral journey</span>
        <span className="font-mono text-[11px] text-ink/60">{status}</span>
      </div>
      {status === "ESCALATED" || status === "CANCELLED" ? (
        <div
          className={cx(
            "rounded-2xl border px-3 py-2 text-xs font-semibold",
            status === "ESCALATED" ? "border-clay/30 bg-clay/10 text-clay" : "border-line bg-paper text-ink/80",
          )}
        >
          {STATUS_LABEL[status]} · {status}
        </div>
      ) : null}
      <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {CANONICAL_FLOW.map((step, index) => {
          const done = activeIdx > index || status === "COMPLETED";
          const current = activeIdx === index && status !== "COMPLETED";
          return (
            <li
              key={step}
              className={cx(
                "rounded-xl border px-2 py-1.5 text-center text-[11px] leading-tight",
                done
                  ? "border-moss/30 bg-moss/10 font-semibold text-moss"
                  : current
                    ? "border-teal bg-mist font-bold text-teal-dark"
                    : "border-line bg-white/70 text-ink/45",
              )}
            >
              <span className="block truncate">{STATUS_LABEL[step]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const CONNECTIVITY_META: Record<ConnectivityMode, { title: string; detail: string; tone: string }> = {
  online: {
    title: "Link online",
    detail: "Realtime simulation active. Server acknowledgements arrive within seconds.",
    tone: "border-moss/30 bg-moss/10 text-moss",
  },
  degraded: {
    title: "Link degraded",
    detail: "Slow link simulated. Secondary offers fall back to simulated SMS framing.",
    tone: "border-amber/30 bg-amber/10 text-amber",
  },
  gateway_failure: {
    title: "Gateway failure simulated",
    detail: "Broadcasts will fail acknowledgement so you can verify retry and SMS fallback.",
    tone: "border-clay/30 bg-clay/10 text-clay",
  },
  offline: {
    title: "Device offline",
    detail: "Nothing is sent to hospitals. Drafts and broadcasts queue locally in IndexedDB.",
    tone: "border-clay/40 bg-clay/10 text-clay",
  },
};

export function ConnectivityBanner({
  connectivity,
  queueCount,
  draftCount,
  showQueueLink = true,
}: {
  connectivity: ConnectivityMode;
  queueCount: number;
  draftCount: number;
  showQueueLink?: boolean;
}) {
  const meta = CONNECTIVITY_META[connectivity];
  const pendingTotal = queueCount + draftCount;

  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm", meta.tone)}>
      <div>
        <p className="font-semibold">{meta.title}</p>
        <p className="text-xs text-ink/80">{meta.detail}</p>
      </div>
      {showQueueLink ? (
        <Link
          href="/clinic/queue"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-current/25 bg-white px-3.5 py-1.5 text-xs font-semibold text-ink hover:border-teal"
        >
          <span>On this device</span>
          <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", pendingTotal > 0 ? "bg-amber text-white" : "bg-paper text-ink/70")}>
            {pendingTotal}
          </span>
        </Link>
      ) : null}
    </div>
  );
}

export function PinStepUpField({
  value,
  onChange,
  label = "Clinician PIN (4+ digits)",
  hint,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  id?: string;
}) {
  return (
    <label htmlFor={id} className="block text-xs font-semibold text-ink/75">
      {label}
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        type="password"
        placeholder="••••"
        className="mt-1 block min-h-[44px] w-44 rounded-xl border border-line bg-white px-3.5 py-2 font-mono text-base tracking-widest text-ink"
      />
      {hint ? <span className="mt-1 block text-[11px] font-normal text-ink/60">{hint}</span> : null}
    </label>
  );
}
