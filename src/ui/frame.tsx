"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ConnectivityMode, Role } from "@/domain/types";
import { HOME_PATH, ROLE_LABEL, SUBROLE_LABEL } from "@/domain/labels";
import { useApp } from "@/services/provider";

const CONNECTIVITY: { id: ConnectivityMode; label: string; dotColor: string }[] = [
  { id: "online", label: "Online (Full Fiber)", dotColor: "bg-moss" },
  { id: "degraded", label: "Degraded 2G / Edge", dotColor: "bg-amber" },
  { id: "gateway_failure", label: "SMS Gateway Degraded", dotColor: "bg-clay" },
  { id: "offline", label: "Offline (Local Queue)", dotColor: "bg-ink/40" },
];

const LINKS: Record<Role, [string, string, string][]> = {
  clinic: [
    ["/clinic", "Referrals", "📋"],
    ["/clinic/queue", "Offline Queue", "📱"],
  ],
  hospital: [
    ["/hospital", "ED Command", "🚨"],
    ["/hospital/capacity", "Bed Capacity", "🏥"],
  ],
  transport: [
    ["/transport", "Ambulance Console", "🚑"],
  ],
  admin: [
    ["/admin", "Regional Analytics", "📊"],
    ["/admin/directory", "Directory & Facilities", "🏛️"],
  ],
};

export function DeskFrame({ role, children }: { role: Role; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { ready, session, connectivity, setConnectivity, signOut } = useApp();

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/");
    else if (session.user.role !== role) router.replace(HOME_PATH[session.user.role]);
  }, [ready, session, role, router]);

  if (!ready || !session || session.user.role !== role) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-paper">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal border-t-transparent" />
          <p className="text-sm font-medium text-ink/70">Connecting to secure workstation...</p>
        </div>
      </div>
    );
  }

  const activeMode = CONNECTIVITY.find((m) => m.id === connectivity) ?? CONNECTIVITY[0];

  return (
    <div className="min-h-dvh flex flex-col bg-paper selection:bg-teal selection:text-white">
      {/* Top Professional Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Logo & Clinician Identity Badge */}
          <div className="flex items-center gap-3">
            <Link href={HOME_PATH[role]} className="flex items-center gap-2 group">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-dark font-display text-sm font-bold text-white shadow-sm transition group-hover:bg-teal">
                N
              </span>
              <span className="font-display text-lg font-bold text-teal-dark">NAFASI</span>
            </Link>

            <span className="hidden sm:inline-block h-4 w-px bg-line" />

            {/* User identity stamp */}
            <div className="hidden sm:block">
              <p className="text-xs font-bold text-ink leading-tight">
                {session.user.name} <span className="text-ink/50 font-normal">({session.user.registrationNumber})</span>
              </p>
              <p className="text-[11px] text-teal-dark font-medium leading-tight">
                {SUBROLE_LABEL[session.user.subrole]} · <strong>{session.facility.shortName}</strong>
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-1.5 order-last sm:order-none w-full sm:w-auto justify-center sm:justify-start pt-2 sm:pt-0">
            {LINKS[role].map(([href, label, icon]) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${
                    active
                      ? "bg-teal-dark text-white shadow-sm"
                      : "text-ink/75 hover:bg-card hover:text-ink"
                  }`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Controls: Connectivity Simulation & Sign Out */}
          <div className="flex items-center gap-2.5">
            {/* Network simulator dropdown */}
            <div className="flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1 text-xs shadow-sm">
              <span className={`h-2 w-2 rounded-full ${activeMode.dotColor}`} />
              <select
                value={connectivity}
                onChange={(event) => setConnectivity(event.target.value as ConnectivityMode)}
                className="bg-transparent font-medium text-ink outline-none text-xs cursor-pointer"
              >
                {CONNECTIVITY.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Logout */}
            <button
              type="button"
              className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink/70 hover:bg-paper hover:text-ink transition shadow-sm"
              onClick={() => {
                void signOut().then(() => router.push("/"));
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Security Context Subheader */}
      <div className="bg-teal-dark/95 border-b border-teal-dark px-4 py-1.5 text-center text-[11px] font-semibold text-white/90">
        🔒 Active Session: {ROLE_LABEL[role]} Console · Simulated Data Only · Kenya Emergency Health Pilot
      </div>

      {/* Main Workspace Frame */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
