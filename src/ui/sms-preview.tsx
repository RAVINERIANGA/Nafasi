"use client";

import { useState } from "react";
import type { Category } from "@/domain/types";
import { formatCompressedSms } from "@/services/offline";

export interface SmsPreviewInput {
  referralId: string;
  category: Category;
  hospitalNumber?: string;
  age?: number | string;
  ageUnit?: "years" | "months";
  sex?: string;
  diagnosis?: string;
  vital?: {
    systolic?: number | string;
    diastolic?: number | string;
    pulse?: number | string;
    spo2?: number | string;
    avpu?: string;
  };
  facilityCode?: string;
  userCode?: string;
}

export function SmsFallbackModal({
  open,
  input,
  onClose,
}: {
  open: boolean;
  input: SmsPreviewInput;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const sms = formatCompressedSms(input);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(sms.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sms-fallback-title"
    >
      <div className="w-full max-w-lg rounded-3xl border border-line bg-card p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber">Simulated SMS fallback preview</p>
            <h2 id="sms-fallback-title" className="mt-1 font-display text-2xl text-teal-dark">
              Compressed emergency packet
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-full border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink/80 hover:border-teal"
          >
            Close
          </button>
        </div>

        <div className="mt-3 rounded-2xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-xs text-ink">
          <span className="font-semibold">Simulated gateway preview only.</span> No real SMS has been or will be sent by this prototype. In production, a verified SMS gateway forwards this compact frame under the clinician’s registered phone number.
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-paper p-3.5">
          <div className="flex items-center justify-between gap-2 text-xs text-ink/60">
            <span>Payload ({sms.chars} chars · {sms.segments} SMS {sms.segments === 1 ? "segment" : "segments"})</span>
            <span className="font-mono text-[11px] uppercase text-teal-dark">realMessageSent: false</span>
          </div>
          <p className="mt-2 break-all rounded-xl bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-ink">
            {sms.text}
          </p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
          {sms.fields.map((item) => (
            <div key={item.label} className="rounded-xl bg-paper/70 px-3 py-2">
              <dt className="font-semibold text-ink/55">{item.label}</dt>
              <dd className="mt-0.5 text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyText()}
            className="min-h-[44px] rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white hover:bg-teal-dark"
          >
            {copied ? "Copied sample packet" : "Copy simulated SMS text"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
