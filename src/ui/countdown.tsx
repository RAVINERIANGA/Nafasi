"use client";

import { useEffect, useState } from "react";

/**
 * Live countdown component for the 60-second acceptance window.
 * Shows a circular progress ring that depletes as time runs out,
 * plus a large numeric seconds display. Pulses red in the final 15 s.
 */
export function AcceptanceCountdown({
  expiresAt,
  onExpired,
}: {
  expiresAt: string;
  onExpired?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsLeft(expiresAt));

  useEffect(() => {
    const tick = setInterval(() => {
      const left = secondsLeft(expiresAt);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick);
        onExpired?.();
      }
    }, 250);
    return () => clearInterval(tick);
  }, [expiresAt, onExpired]);

  const total = 60;
  const fraction = Math.max(0, remaining) / total;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - fraction);
  const urgent = remaining <= 15;
  const expired = remaining <= 0;

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-line"
            strokeWidth="6"
          />
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke="currentColor"
            className={urgent ? "text-clay" : "text-teal"}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.3s ease" }}
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center font-display text-2xl ${
            expired ? "text-clay" : urgent ? "text-clay animate-pulse" : "text-teal-dark"
          }`}
        >
          {expired ? "0" : Math.ceil(remaining)}
        </span>
      </div>
      <div>
        <p
          className={`text-sm font-semibold ${
            expired ? "text-clay" : urgent ? "text-clay" : "text-teal-dark"
          }`}
        >
          {expired
            ? "Offer expired"
            : urgent
              ? "Expiring soon"
              : "Acceptance window"}
        </p>
        <p className="text-xs text-ink/60">
          {expired
            ? "This offer has timed out. The server may reroute."
            : `${Math.ceil(remaining)} second${Math.ceil(remaining) === 1 ? "" : "s"} remaining`}
        </p>
      </div>
    </div>
  );
}

/**
 * Compact inline countdown — just the number and a small ring.
 * Used in list cards.
 */
export function MiniCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => secondsLeft(expiresAt));

  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining(secondsLeft(expiresAt));
    }, 500);
    return () => clearInterval(tick);
  }, [expiresAt]);

  const expired = remaining <= 0;
  const urgent = remaining <= 15;

  if (expired) {
    return <span className="text-xs font-semibold text-clay">Expired</span>;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        urgent
          ? "bg-clay/10 text-clay animate-pulse"
          : "bg-teal/10 text-teal-dark"
      }`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${urgent ? "bg-clay" : "bg-teal"}`} />
      {Math.ceil(remaining)}s
    </span>
  );
}

function secondsLeft(expiresAt: string) {
  return Math.max(0, (new Date(expiresAt).getTime() - Date.now()) / 1000);
}
