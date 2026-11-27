"use client";

import { useEffect, useState } from "react";
import type { Facility, PublicUser, Role, Subrole, SystemConfig } from "@/domain/types";
import { UNRESOLVED_DECISIONS } from "@/domain/demo-data";
import { ROLE_LABEL, SUBROLE_LABEL } from "@/domain/labels";
import { ApiClientError, api } from "@/services/api";
import { useApp } from "@/services/provider";
import { CapacityEditor } from "@/ui/capacity";
import { DeskFrame } from "@/ui/frame";

const SUBROLES: Record<Role, Subrole[]> = {
  clinic: ["nurse", "clinical_officer", "doctor"],
  hospital: ["doctor", "triage_officer", "hospital_admin"],
  transport: ["driver", "emt", "dispatcher"],
  admin: ["super_admin"],
};

function problem(error: unknown) {
  return error instanceof ApiClientError ? error.message : "The directory could not be updated.";
}

export function DirectoryDesk() {
  const { session } = useApp();
  const [facilities, setFacilities] = useState<Facility[]>(session?.facilities ?? []);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [config, setConfig] = useState<SystemConfig | null>(session?.config ?? null);
  const [hospitalId, setHospitalId] = useState(session?.facilities.find((item) => item.type === "hospital")?.id ?? "");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+254711");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("clinic");
  const [subrole, setSubrole] = useState<Subrole>("nurse");
  const [facilityId, setFacilityId] = useState(session?.facilities.find((item) => item.type === "clinic")?.id ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session || session.user.role !== "admin") return;
    Promise.all([api<PublicUser[]>("users"), api<Facility[]>("facilities"), api<SystemConfig>("config")])
      .then(([nextUsers, nextFacilities, nextConfig]) => {
        setUsers(nextUsers ?? []);
        setFacilities(nextFacilities);
        setConfig(nextConfig);
        setHospitalId((current) => current || nextFacilities.find((item) => item.type === "hospital")?.id || "");
        setFacilityId((current) => current || nextFacilities.find((item) => item.type === "clinic")?.id || "");
      })
      .catch((caught) => setError(problem(caught)));
  }, [session]);

  async function toggle(facility: Facility) {
    setError("");
    try {
      const next = await api<Facility>(`facilities/${facility.id}`, { method: "PATCH", body: { participating: !facility.participating } });
      setFacilities((current) => current.map((item) => (item.id === next.id ? next : item)));
      setNote(`${next.shortName} is ${next.participating ? "participating" : "paused"}.`);
    } catch (caught) {
      setError(problem(caught));
    }
  }

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<SystemConfig>("config", { method: "PUT", body: config });
      setConfig(next);
      setNote("Windows saved for this simulation. They are not a validated safety policy.");
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await api<PublicUser>("users", {
        body: { name, phone, email, role, subrole, facilityId, pin, registrationNumber: "UNVERIFIED" },
      });
      setUsers((current) => [...current, created]);
      setName("");
      setPin("");
      setNote(`${created.name} can sign in with the simulated code and PIN ${pin}. Registration numbers are not checked.`);
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  const hospitals = facilities.filter((item) => item.type === "hospital");
  const facilityChoices = facilities.filter((item) => {
    if (role === "clinic") return item.type === "clinic";
    if (role === "hospital") return item.type === "hospital";
    if (role === "transport") return item.type === "dispatch";
    return item.type === "admin";
  });

  return (
    <DeskFrame role="admin">
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-3xl text-teal-dark">Directory</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink/70">Facilities, accounts, and the timers that drive routing. Participation can be paused here. Who must adopt the system is still undecided.</p>
        </header>
        {error ? <p className="text-sm text-clay">{error}</p> : null}
        {note ? <p className="text-sm text-moss">{note}</p> : null}
        <section className="grid gap-3 lg:grid-cols-2">
          <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
            <h2 className="font-semibold">Facilities</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {facilities.map((facility) => (
                <li key={facility.id} className="flex items-center justify-between gap-3">
                  <span>
                    {facility.name}
                    <span className="block text-xs text-ink/50">{facility.type}</span>
                  </span>
                  <button type="button" onClick={() => void toggle(facility)} className="rounded-full border border-line bg-white px-3 py-1 text-xs">
                    {facility.participating ? "Pause" : "Resume"}
                  </button>
                </li>
              ))}
            </ul>
          </article>
          <article className="rounded-3xl border border-line bg-card p-4 shadow-card">
            <h2 className="font-semibold">Accounts</h2>
            <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
              {users.map((user) => (
                <li key={user.id}>
                  {user.name}
                  <span className="block text-xs text-ink/50">
                    {ROLE_LABEL[user.role]} · {SUBROLE_LABEL[user.subrole]} · {user.phone}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        </section>
        <form onSubmit={addUser} className="space-y-3 rounded-3xl border border-line bg-card p-4 shadow-card">
          <h2 className="font-semibold">Add an account</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink/70">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-ink/70">
              Phone
              <input value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-ink/70">
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-ink/70">
              PIN
              <input value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-ink/70">
              Role
              <select
                value={role}
                onChange={(event) => {
                  const next = event.target.value as Role;
                  setRole(next);
                  setSubrole(SUBROLES[next][0]);
                  setFacilityId(facilities.find((item) => item.type === (next === "transport" ? "dispatch" : next))?.id ?? "");
                }}
                className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
              >
                {(Object.keys(ROLE_LABEL) as Role[]).map((item) => (
                  <option key={item} value={item}>
                    {ROLE_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink/70">
              Subrole
              <select value={subrole} onChange={(event) => setSubrole(event.target.value as Subrole)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
                {SUBROLES[role].map((item) => (
                  <option key={item} value={item}>
                    {SUBROLE_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-ink/70 sm:col-span-2">
              Facility
              <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
                {facilityChoices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy} className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Create account
          </button>
        </form>
        {config ? (
          <form onSubmit={saveConfig} className="space-y-3 rounded-3xl border border-line bg-card p-4 shadow-card">
            <h2 className="font-semibold">Timers</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Acceptance window (seconds)" value={config.acceptanceWindowSeconds} onChange={(value) => setConfig({ ...config, acceptanceWindowSeconds: value })} />
              <NumberField label="Escalation window (seconds)" value={config.escalationWindowSeconds} onChange={(value) => setConfig({ ...config, escalationWindowSeconds: value })} />
              <NumberField label="Safety hold (minutes)" value={config.safetyTimeoutMinutes} onChange={(value) => setConfig({ ...config, safetyTimeoutMinutes: value })} />
              <NumberField label="Safety warning (minutes)" value={config.safetyWarningMinutes} onChange={(value) => setConfig({ ...config, safetyWarningMinutes: value })} />
              <NumberField label="Capacity stays fresh (minutes)" value={config.capacityFreshMinutes} onChange={(value) => setConfig({ ...config, capacityFreshMinutes: value })} />
              <label className="text-xs font-semibold text-ink/70">
                Default broadcast
                <select
                  value={config.defaultBroadcastMode}
                  onChange={(event) => setConfig({ ...config, defaultBroadcastMode: event.target.value as SystemConfig["defaultBroadcastMode"] })}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                >
                  <option value="single">Nearest eligible</option>
                  <option value="parallel">Several at once</option>
                </select>
              </label>
            </div>
            <button type="submit" disabled={busy} className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
              Save timers
            </button>
          </form>
        ) : null}
        <section className="space-y-3">
          <label className="block text-xs font-semibold text-ink/70">
            Hospital capacity
            <select value={hospitalId} onChange={(event) => setHospitalId(event.target.value)} className="mt-1 w-full max-w-md rounded-xl border border-line bg-white px-3 py-2 text-sm">
              {hospitals.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {hospitalId ? <CapacityEditor key={hospitalId} facilityId={hospitalId} /> : null}
        </section>
        <section className="rounded-3xl border border-line bg-card p-4 shadow-card">
          <h2 className="font-semibold">Unresolved decisions</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {UNRESOLVED_DECISIONS.map((item) => (
              <li key={item.id}>
                <span className="font-semibold">{item.title}</span>
                <span className="text-ink/50"> · {item.state}</span>
                <span className="block text-ink/70">{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </DeskFrame>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="text-xs font-semibold text-ink/70">
      {label}
      <input value={value} onChange={(event) => onChange(Number(event.target.value))} inputMode="numeric" className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
    </label>
  );
}
