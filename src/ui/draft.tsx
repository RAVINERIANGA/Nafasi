"use client";

import { useState } from "react";
import { CATEGORIES, type Category } from "@/domain/types";
import { uid } from "@/domain/format";
import { CATEGORY_LABEL, INTERVENTIONS } from "@/domain/labels";
import { ApiClientError, api } from "@/services/api";
import type { PresentedReferral } from "@/ui/types";

export function DraftForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (referral: PresentedReferral) => void }) {
  const [category, setCategory] = useState<Category>("respiratory");
  const [name, setName] = useState("");
  const [hospitalNumber, setHospitalNumber] = useState("RC-");
  const [age, setAge] = useState("4");
  const [ageUnit, setAgeUnit] = useState<"years" | "months">("years");
  const [sex, setSex] = useState("female");
  const [diagnosis, setDiagnosis] = useState("");
  const [allergies, setAllergies] = useState("None known");
  const [notes, setNotes] = useState("");
  const [interventions, setInterventions] = useState<string[]>(["Oxygen"]);
  const [spo2, setSpo2] = useState("92");
  const [pulse, setPulse] = useState("128");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [avpu, setAvpu] = useState("A");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(item: string) {
    setInterventions((current) => (current.includes(item) ? current.filter((value) => value !== item) : [...current, item]));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const referral = await api<PresentedReferral>("referrals", {
        body: {
          id: uid("ref").replace(/-/g, ""),
          category,
          patient: { name, hospitalNumber, age: Number(age), ageUnit, sex },
          diagnosis,
          allergies,
          notes,
          interventions,
          vitals: [
            {
              spo2: spo2 ? Number(spo2) : undefined,
              pulse: pulse ? Number(pulse) : undefined,
              systolic: systolic ? Number(systolic) : undefined,
              diastolic: diastolic ? Number(diastolic) : undefined,
              avpu,
            },
          ],
        },
      });
      onCreated(referral);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "The draft was not saved.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 rounded-3xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl text-teal-dark">Prepare a referral</h2>
          <p className="mt-1 text-sm text-ink/70">This stays a draft until you broadcast it. The server chooses the hospital.</p>
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-ink/60">
          Close
        </button>
      </div>
      <label className="block text-xs font-semibold text-ink/70">
        Category
        <select value={category} onChange={(event) => setCategory(event.target.value as Category)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {CATEGORY_LABEL[item]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Patient name" value={name} onChange={setName} />
        <Field label="Hospital number" value={hospitalNumber} onChange={setHospitalNumber} />
        <Field label="Age" value={age} onChange={setAge} />
        <label className="block text-xs font-semibold text-ink/70">
          Age unit
          <select value={ageUnit} onChange={(event) => setAgeUnit(event.target.value as "years" | "months")} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
            <option value="years">Years</option>
            <option value="months">Months</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-ink/70">
          Sex
          <select value={sex} onChange={(event) => setSex(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
      </div>
      <Field label="Suspected diagnosis" value={diagnosis} onChange={setDiagnosis} />
      <Field label="Allergies" value={allergies} onChange={setAllergies} />
      <label className="block text-xs font-semibold text-ink/70">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" rows={3} />
      </label>
      <fieldset>
        <legend className="text-xs font-semibold text-ink/70">Given so far</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTERVENTIONS.map((item) => (
            <label key={item} className={`rounded-full border px-3 py-1 text-xs ${interventions.includes(item) ? "border-teal bg-mist" : "border-line bg-white"}`}>
              <input type="checkbox" className="sr-only" checked={interventions.includes(item)} onChange={() => toggle(item)} />
              {item}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="SpO₂" value={spo2} onChange={setSpo2} />
        <Field label="Pulse" value={pulse} onChange={setPulse} />
        <Field label="Systolic" value={systolic} onChange={setSystolic} />
        <Field label="Diastolic" value={diastolic} onChange={setDiastolic} />
        <label className="block text-xs font-semibold text-ink/70">
          AVPU
          <select value={avpu} onChange={(event) => setAvpu(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm">
            {["A", "V", "P", "U"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="text-sm text-clay">{error}</p> : null}
      <button type="submit" disabled={busy} className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        Save draft
      </button>
    </form>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-ink/70">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
    </label>
  );
}
