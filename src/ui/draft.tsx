"use client";

import { useState } from "react";
import { CATEGORIES, type Category } from "@/domain/types";
import { uid } from "@/domain/format";
import { CATEGORY_HINT, CATEGORY_LABEL, CATEGORY_RESOURCES, INTERVENTIONS } from "@/domain/labels";
import { ApiClientError, api } from "@/services/api";
import type { PresentedReferral } from "@/ui/types";

export function DraftForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (referral: PresentedReferral) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [category, setCategory] = useState<Category>("obstetric");
  const [name, setName] = useState("");
  const [hospitalNumber, setHospitalNumber] = useState("RC-" + Math.floor(1000 + Math.random() * 9000));
  const [age, setAge] = useState("26");
  const [ageUnit, setAgeUnit] = useState<"years" | "months">("years");
  const [sex, setSex] = useState("female");
  const [diagnosis, setDiagnosis] = useState("Severe pre-eclampsia with impending eclampsia");
  const [allergies, setAllergies] = useState("None known");
  const [notes, setNotes] = useState("BP refractory to initial oral antihypertensive. Needs emergency magnesium sulfate & urgent delivery evaluation.");
  const [interventions, setInterventions] = useState<string[]>(["IV fluids", "Magnesium", "Oxygen"]);
  
  // Vitals
  const [spo2, setSpo2] = useState("96");
  const [pulse, setPulse] = useState("110");
  const [systolic, setSystolic] = useState("168");
  const [diastolic, setDiastolic] = useState("112");
  const [avpu, setAvpu] = useState("A");
  
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(item: string) {
    setInterventions((current) =>
      current.includes(item) ? current.filter((value) => value !== item) : [...current, item]
    );
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
    <form onSubmit={save} className="space-y-6 rounded-3xl border border-line bg-card p-6 shadow-card">
      {/* Wizard Header */}
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-clay text-[11px] font-bold text-white">
              !
            </span>
            <p className="text-xs font-bold uppercase tracking-wider text-clay">New Emergency Referral</p>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-teal-dark mt-1">
            {step === 1 && "Step 1: Emergency Category"}
            {step === 2 && "Step 2: Patient & Vitals"}
            {step === 3 && "Step 3: Interventions & Review"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold text-ink/70 hover:bg-paper"
        >
          ✕ Cancel
        </button>
      </div>

      {/* Progress Dots */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              step >= s ? "bg-teal" : "bg-line"
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="rounded-2xl border border-clay/30 bg-clay/5 p-3 text-xs font-medium text-clay">
          ⚠️ {error}
        </div>
      )}

      {/* STEP 1: Emergency Category Selector */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-xs text-ink/65">
            Select the primary critical reason for transfer. The system uses this to filter capable receiving hospitals.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    active
                      ? "border-teal bg-mist shadow-sm ring-1 ring-teal"
                      : "border-line bg-white hover:border-teal/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-base font-bold text-teal-dark">
                      {CATEGORY_LABEL[cat]}
                    </span>
                    {active && <span className="text-teal font-bold text-sm">✓ Selected</span>}
                  </div>
                  <p className="mt-1 text-xs text-ink/70 leading-relaxed">{CATEGORY_HINT[cat]}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {CATEGORY_RESOURCES[cat].map((res) => (
                      <span key={res} className="rounded-md bg-paper px-2 py-0.5 text-[10px] font-semibold text-ink/60">
                        {res}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-xl bg-teal px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-dark transition"
            >
              Continue to Patient Details →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Patient & Vitals */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Patient Name (Optional in emergency)" value={name} onChange={setName} placeholder="Mama Zawadi" />
            <Field label="Hospital Number (Facility Patient ID)" value={hospitalNumber} onChange={setHospitalNumber} placeholder="RC-2041" />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Age" value={age} onChange={setAge} />
              <label className="block text-xs font-bold text-ink/75">
                Age Unit
                <select
                  value={ageUnit}
                  onChange={(e) => setAgeUnit(e.target.value as "years" | "months")}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                >
                  <option value="years">Years</option>
                  <option value="months">Months</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-bold text-ink/75">
              Biological Sex
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
          </div>

          <Field label="Suspected Diagnosis / Presentation" value={diagnosis} onChange={setDiagnosis} />

          {/* Vitals Input Grid */}
          <div className="rounded-2xl border border-teal/20 bg-mist/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-teal-dark">Immediate Triage Vitals</p>
              <span className="text-[11px] text-ink/60">Device-stamped</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <Field label="SpO₂ (%)" value={spo2} onChange={setSpo2} placeholder="96" />
              <Field label="Pulse (bpm)" value={pulse} onChange={setPulse} placeholder="110" />
              <Field label="Systolic BP" value={systolic} onChange={setSystolic} placeholder="160" />
              <Field label="Diastolic BP" value={diastolic} onChange={setDiastolic} placeholder="100" />
              <label className="block text-xs font-bold text-ink/75 col-span-2 sm:col-span-1">
                AVPU Scale
                <select
                  value={avpu}
                  onChange={(e) => setAvpu(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold text-teal-dark"
                >
                  <option value="A">Alert (A)</option>
                  <option value="V">Voice (V)</option>
                  <option value="P">Pain (P)</option>
                  <option value="U">Unresponsive (U)</option>
                </select>
              </label>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-xl border border-line px-5 py-2.5 text-xs font-bold text-ink/70 hover:bg-paper"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-xl bg-teal px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-dark transition"
            >
              Continue to Interventions →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Interventions & Review */}
      {step === 3 && (
        <div className="space-y-5">
          <Field label="Known Allergies" value={allergies} onChange={setAllergies} />

          <label className="block text-xs font-bold text-ink/75">
            Clinical Notes &amp; Handover Considerations
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-teal"
              rows={3}
            />
          </label>

          {/* Treatments Already Administered */}
          <fieldset>
            <legend className="text-xs font-bold text-ink/75 mb-2">Interventions Administered at Origin</legend>
            <div className="flex flex-wrap gap-2">
              {INTERVENTIONS.map((item) => {
                const checked = interventions.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggle(item)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                      checked
                        ? "border-teal bg-teal text-white shadow-sm"
                        : "border-line bg-white text-ink/75 hover:border-teal/60"
                    }`}
                  >
                    {checked ? "✓ " : "+ "}
                    {item}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Quick Summary Pill */}
          <div className="rounded-2xl border border-line bg-paper p-4 text-xs text-ink/75 space-y-1">
            <p>
              <strong>Category:</strong> {CATEGORY_LABEL[category]} | <strong>Patient:</strong> {name || "Unnamed"} ({hospitalNumber})
            </p>
            <p>
              <strong>Vitals:</strong> BP {systolic}/{diastolic} · Pulse {pulse} · SpO₂ {spo2}% · AVPU: {avpu}
            </p>
          </div>

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-xl border border-line px-5 py-2.5 text-xs font-bold text-ink/70 hover:bg-paper"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-moss px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-moss/90 transition disabled:opacity-50"
            >
              {busy ? "Saving draft..." : "Save Emergency Draft ✓"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-bold text-ink/75">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm text-ink outline-none transition focus:border-teal"
      />
    </label>
  );
}
