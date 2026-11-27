"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ConnectivityMode, Role } from "@/domain/types";
import { HOME_PATH, ROLE_LABEL, SUBROLE_LABEL } from "@/domain/labels";
import { useApp } from "@/services/provider";

const CONNECTIVITY: { id: ConnectivityMode; label: string }[] = [
  { id: "online", label: "Online" },
  { id: "degraded", label: "Degraded" },
  { id: "gateway_failure", label: "Gateway failure" },
  { id: "offline", label: "Offline" },
];

const LINKS: Record<Role, [string, string][]> = {
  clinic: [
    ["/clinic", "Referrals"],
    ["/clinic/queue", "On this device"],
  ],
  hospital: [
    ["/hospital", "Incoming"],
    ["/hospital/capacity", "Capacity"],
  ],
  transport: [["/transport", "Assignments"]],
  admin: [
    ["/admin", "Region"],
    ["/admin/directory", "Directory"],
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
    return <p className="px-6 py-16 text-sm text-ink/70">Opening the simulation…</p>;
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="font-display text-xl text-teal-dark">NAFASI</p>
            <p className="text-xs text-ink/60">
              {session.user.name} · {SUBROLE_LABEL[session.user.subrole]} · {session.facility.shortName}
            </p>
          </div>
          <nav className="flex gap-1">
            {LINKS[role].map(([href, label]) => {
              const active = pathname === href;
              return (
                <Link key={href} href={href} className={`rounded-full px-3 py-1.5 text-sm ${active ? "bg-teal text-white" : "text-ink/70"}`}>
                  {label}
                </Link>
              );
            })}
          </nav>
          <label className="text-xs font-semibold text-ink/60">
            Link
            <select
              value={connectivity}
              onChange={(event) => setConnectivity(event.target.value as ConnectivityMode)}
              className="ml-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm text-ink"
            >
              {CONNECTIVITY.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-full border border-line bg-white px-3 py-1.5 text-sm"
            onClick={() => {
              void signOut().then(() => router.push("/"));
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <p className="bg-teal-dark px-4 py-2 text-center text-xs text-white">
        Simulated data only. {ROLE_LABEL[role]} desk. No real hospital, ambulance, or message is involved.
      </p>
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  );
}
