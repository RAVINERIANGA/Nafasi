"use client";

import { useEffect, useState } from "react";
import type { Bed, BedStatus, CapacityRecord, Facility } from "@/domain/types";
import { formatWhen } from "@/domain/format";
import { BED_KIND_LABEL } from "@/domain/labels";
import { ApiClientError, OfflineError, api } from "@/services/api";

type Snapshot = {
  facility: Facility;
  capacity: CapacityRecord | null;
  beds: Bed[];
};

function problem(error: unknown) {
  if (error instanceof ApiClientError || error instanceof OfflineError) return error.message;
  return "Capacity could not be loaded.";
}

export function CapacityEditor({ facilityId }: { facilityId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [oxygen, setOxygen] = useState(true);
  const [theatre, setTheatre] = useState(false);
  const [blood, setBlood] = useState("0");
  const [notes, setNotes] = useState("");
  const [beds, setBeds] = useState<Bed[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function apply(next: Snapshot) {
    setSnapshot(next);
    setOxygen(next.capacity?.oxygenAvailable ?? false);
    setTheatre(next.capacity?.theatreAvailable ?? false);
    setBlood(String(next.capacity?.bloodUnits ?? 0));
    setNotes(next.capacity?.notes ?? "");
    setBeds(next.beds);
  }

  useEffect(() => {
    api<Snapshot>(`facilities/${facilityId}/capacity`)
      .then(apply)
      .catch((caught) => setError(problem(caught)));
  }, [facilityId]);

  function setBedStatus(id: string, status: BedStatus) {
    setBeds((current) => current.map((bed) => (bed.id === id ? { ...bed, status } : bed)));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    try {
      const next = await api<Snapshot>(`facilities/${facilityId}/capacity`, {
        method: "PUT",
        body: {
          oxygenAvailable: oxygen,
          theatreAvailable: theatre,
          bloodUnits: Number(blood),
          notes,
          bedUpdates: beds
            .filter((bed) => bed.status !== "locked")
            .map((bed) => ({ id: bed.id, status: bed.status })),
        },
      });
      apply(next);
      setNote("Confirmed capacity saved. Routing will use this record, not a prediction.");
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-3xl border border-line bg-card p-5 shadow-card">
      <header>
        <h2 className="font-display text-2xl text-teal-dark">{snapshot?.facility.shortName ?? "Hospital"} capacity</h2>
        <p className="mt-1 text-sm text-ink/70">
          {snapshot?.capacity
            ? `Last confirmed ${formatWhen(snapshot.capacity.updatedAt)} by ${snapshot.capacity.updatedByName}.`
            : "No confirmed capacity yet. Saving creates the record routing will trust."}
        </p>
        {snapshot?.capacity?.predictionNote ? <p className="mt-1 text-xs text-ink/50">{snapshot.capacity.predictionNote}</p> : null}
      </header>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>
          <input type="checkbox" checked={oxygen} onChange={(event) => setOxygen(event.target.checked)} /> Oxygen available
        </label>
        <label>
          <input type="checkbox" checked={theatre} onChange={(event) => setTheatre(event.target.checked)} /> Theatre available
        </label>
        <label>
          Blood units
          <input value={blood} onChange={(event) => setBlood(event.target.value)} inputMode="numeric" className="ml-2 w-20 rounded-xl border border-line bg-white px-3 py-1.5" />
        </label>
      </div>
      <label className="block text-xs font-semibold text-ink/70">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
      </label>
      <ul className="space-y-2">
        {beds.map((bed) => (
          <li key={bed.id} className="flex items-center justify-between gap-3 rounded-2xl bg-paper px-3 py-2 text-sm">
            <span>
              {bed.label}
              <span className="block text-xs text-ink/50">{BED_KIND_LABEL[bed.kind]}</span>
            </span>
            {bed.status === "locked" ? (
              <span className="text-xs font-semibold text-amber">Reserved</span>
            ) : (
              <select value={bed.status} onChange={(event) => setBedStatus(bed.id, event.target.value as BedStatus)} className="rounded-xl border border-line bg-white px-2 py-1 text-sm">
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="out_of_service">Out of service</option>
              </select>
            )}
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      {note ? <p className="text-sm text-moss">{note}</p> : null}
      <button type="submit" disabled={busy || !snapshot} className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        Save confirmed capacity
      </button>
    </form>
  );
}
