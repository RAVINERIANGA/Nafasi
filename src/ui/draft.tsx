"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AVPU_LABEL,
  CATEGORY_HINT,
  CATEGORY_LABEL,
  CATEGORY_RESOURCES,
  INTERVENTIONS,
} from "@/domain/labels";
import {
  CATEGORIES,
  type ActorStamp,
  type Avpu,
  type BroadcastMode,
  type Category,
  type RankedFacility,
  type Sex,
  type Vital,
} from "@/domain/types";
import { cx, formatClock, formatWhen, vitalLine } from "@/domain/format";
import { OfflineError, api } from "@/services/api";
import {
  clearAutosavesFor,
  deleteDraft,
  enqueue,
  newClientReferralId,
  newOpId,
  readLatestAutosave,
  saveDraft,
  type DraftRecord,
} from "@/services/offline";
import { useApp } from "@/services/provider";
import { PinStepUpField, problemMessage } from "@/ui/clinic-helpers";
import { SmsFallbackModal } from "@/ui/sms-preview";
import type { PresentedReferral } from "@/ui/types";

type Step = 1 | 2 | 3 | 4;

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Category" },
  { id: 2, label: "Patient" },
  { id: 3, label: "Vitals" },
  { id: 4, label: "Send" },
];

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
];

function buildActorStamp(session: ReturnType<typeof useApp>["session"]): ActorStamp {
  if (!session) {
    return {
      id: "offline_user",
      name: "Clinician",
      role: "clinic",
      subrole: "Clinician",
      registrationNumber: "UNVERIFIED",
      facilityId: "",
      facilityName: "Clinic",
    };
  }
  return {
    id: session.user.id,
    name: session.user.name,
    role: session.user.role,
    subrole: session.user.subrole,
    registrationNumber: session.user.registrationNumber,
    facilityId: session.facility.id,
    facilityName: session.facility.name,
  };
}

function parseDraftVitals(raw: unknown, fallbackActor: ActorStamp): Vital[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, idx) => {
      const v = item as Record<string, unknown>;
      return {
        id: typeof v.id === "string" && v.id ? v.id : `vit_local_${idx}_${Date.now()}`,
        systolic: typeof v.systolic === "number" ? v.systolic : undefined,
        diastolic: typeof v.diastolic === "number" ? v.diastolic : undefined,
        pulse: typeof v.pulse === "number" ? v.pulse : undefined,
        spo2: typeof v.spo2 === "number" ? v.spo2 : undefined,
        avpu: typeof v.avpu === "string" && v.avpu ? (v.avpu as Avpu) : undefined,
        note: typeof v.note === "string" ? v.note : undefined,
        context: "pre_transfer" as const,
        deviceTime: typeof v.deviceTime === "string" && v.deviceTime ? v.deviceTime : new Date().toISOString(),
        serverTime: typeof v.serverTime === "string" ? v.serverTime : "",
        recordedBy:
          v.recordedBy && typeof v.recordedBy === "object"
            ? (v.recordedBy as ActorStamp)
            : fallbackActor,
      };
    })
    .filter((v) => v.systolic || v.diastolic || v.pulse || v.spo2 || v.avpu);
}

export function DraftForm({
  onCancel,
  onCreated,
  initialReferral,
  initialDraft,
  onQueued,
}: {
  onCancel: () => void;
  onCreated: (referral: PresentedReferral) => void;
  initialReferral?: PresentedReferral;
  initialDraft?: DraftRecord;
  onQueued?: (referralId: string) => void;
}) {
  const router = useRouter();
  const { session, connectivity } = useApp();
  const actorStamp = useMemo(() => buildActorStamp(session), [session]);

  const [referralId, setReferralId] = useState<string>(() => initialReferral?.id ?? initialDraft?.id ?? newClientReferralId());
  const [step, setStep] = useState<Step>(() => {
    const s = initialDraft?.step;
    return s === 1 || s === 2 || s === 3 || s === 4 ? s : 1;
  });

  const [category, setCategory] = useState<Category>(() => {
    if (initialReferral) return initialReferral.category;
    const cat = initialDraft?.payload.category;
    return typeof cat === "string" && CATEGORIES.includes(cat as Category) ? (cat as Category) : "respiratory";
  });

  const initialPatient = (initialDraft?.payload.patient ?? {}) as Record<string, unknown>;
  const [name, setName] = useState<string>(() => initialReferral?.patient.name ?? (typeof initialPatient.name === "string" ? initialPatient.name : ""));
  const [hospitalNumber, setHospitalNumber] = useState<string>(
    () => initialReferral?.patient.hospitalNumber ?? (typeof initialPatient.hospitalNumber === "string" ? initialPatient.hospitalNumber : ""),
  );
  const [age, setAge] = useState<string>(() =>
    initialReferral ? String(initialReferral.patient.age) : initialPatient.age !== undefined ? String(initialPatient.age) : "",
  );
  const [ageUnit, setAgeUnit] = useState<"years" | "months">(() =>
    initialReferral?.patient.ageUnit ?? (initialPatient.ageUnit === "months" ? "months" : "years"),
  );
  const [sex, setSex] = useState<Sex>(() =>
    initialReferral?.patient.sex ??
    (typeof initialPatient.sex === "string" && ["female", "male", "other", "unknown"].includes(initialPatient.sex)
      ? (initialPatient.sex as Sex)
      : "female"),
  );
  const [diagnosis, setDiagnosis] = useState<string>(
    () => initialReferral?.diagnosis ?? (typeof initialDraft?.payload.diagnosis === "string" ? initialDraft.payload.diagnosis : ""),
  );
  const [allergies, setAllergies] = useState<string>(
    () => initialReferral?.allergies ?? (typeof initialDraft?.payload.allergies === "string" ? initialDraft.payload.allergies : "None known"),
  );
  const [notes, setNotes] = useState<string>(
    () => initialReferral?.notes ?? (typeof initialDraft?.payload.notes === "string" ? initialDraft.payload.notes : ""),
  );
  const [interventions, setInterventions] = useState<string[]>(() => {
    if (initialReferral) return initialReferral.interventions;
    if (Array.isArray(initialDraft?.payload.interventions)) {
      return initialDraft.payload.interventions.map(String).filter(Boolean);
    }
    return [];
  });
  const [customIntervention, setCustomIntervention] = useState("");

  const [recordedVitals, setRecordedVitals] = useState<Vital[]>(() => {
    if (initialReferral) return initialReferral.vitals;
    if (initialDraft) return parseDraftVitals(initialDraft.payload.vitals, actorStamp);
    return [];
  });

  // Active vital input buffer
  const [spo2, setSpo2] = useState("");
  const [pulse, setPulse] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [avpu, setAvpu] = useState<Avpu | "">("");
  const [vitalNote, setVitalNote] = useState("");

  const [mode, setMode] = useState<BroadcastMode>(() => session?.config.defaultBroadcastMode ?? "single");
  const [pin, setPin] = useState("");
  const [autosaveAt, setAutosaveAt] = useState<string | null>(initialDraft?.updatedAt ?? null);
  const [resumableDraft, setResumableDraft] = useState<DraftRecord | null>(null);
  const [resumePromptChecked, setResumePromptChecked] = useState(Boolean(initialReferral || initialDraft));
  const [smsOpen, setSmsOpen] = useState(false);

  const [error, setError] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [busyAction, setBusyAction] = useState<"" | "save" | "route" | "broadcast" | "queue">("");

  const skipFirstAutosave = useRef(true);

  // Check for existing autosave draft on fresh open
  useEffect(() => {
    if (initialReferral || initialDraft || !session) {
      setResumePromptChecked(true);
      return;
    }
    let alive = true;
    readLatestAutosave(session.facility.id, session.user.id)
      .then((found) => {
        if (!alive) return;
        if (found) {
          const p = found.payload;
          const pt = (p.patient ?? {}) as Record<string, unknown>;
          const hasData =
            Boolean(String(pt.hospitalNumber ?? "").trim()) ||
            Boolean(String(p.diagnosis ?? "").trim()) ||
            Boolean(String(pt.name ?? "").trim()) ||
            (Array.isArray(p.vitals) && p.vitals.length > 0);
          if (hasData) setResumableDraft(found);
        }
        setResumePromptChecked(true);
      })
      .catch(() => {
        if (alive) setResumePromptChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [initialReferral, initialDraft, session]);

  function applyDraftRecord(draft: DraftRecord) {
    const p = draft.payload;
    const pt = (p.patient ?? {}) as Record<string, unknown>;
    setReferralId(draft.id);
    if (typeof p.category === "string" && CATEGORIES.includes(p.category as Category)) {
      setCategory(p.category as Category);
    }
    setName(typeof pt.name === "string" ? pt.name : "");
    setHospitalNumber(typeof pt.hospitalNumber === "string" ? pt.hospitalNumber : "");
    setAge(pt.age !== undefined && pt.age !== null ? String(pt.age) : "");
    setAgeUnit(pt.ageUnit === "months" ? "months" : "years");
    setSex(
      typeof pt.sex === "string" && ["female", "male", "other", "unknown"].includes(pt.sex)
        ? (pt.sex as Sex)
        : "female",
    );
    setDiagnosis(typeof p.diagnosis === "string" ? p.diagnosis : "");
    setAllergies(typeof p.allergies === "string" ? p.allergies : "None known");
    setNotes(typeof p.notes === "string" ? p.notes : "");
    setInterventions(Array.isArray(p.interventions) ? p.interventions.map(String).filter(Boolean) : []);
    setRecordedVitals(parseDraftVitals(p.vitals, actorStamp));
    setStep(draft.step === 1 || draft.step === 2 || draft.step === 3 || draft.step === 4 ? draft.step : 2);
    setAutosaveAt(draft.updatedAt);
    setResumableDraft(null);
  }

  async function discardResumable() {
    if (!resumableDraft) return;
    await deleteDraft(resumableDraft.id).catch(() => {});
    setResumableDraft(null);
    setReferralId(newClientReferralId());
    setStatusNote("Previous local draft discarded.");
  }

  function hasPendingVitalInput() {
    return Boolean(systolic.trim() || diastolic.trim() || pulse.trim() || spo2.trim() || avpu);
  }

  function buildVitalFromInputs(): { vital?: Vital; error?: string } {
    if (!hasPendingVitalInput()) return {};
    const parsedSys = systolic.trim() ? Number(systolic) : undefined;
    const parsedDia = diastolic.trim() ? Number(diastolic) : undefined;
    const parsedPulse = pulse.trim() ? Number(pulse) : undefined;
    const parsedSpo2 = spo2.trim() ? Number(spo2) : undefined;

    if (parsedSys !== undefined && (!Number.isFinite(parsedSys) || parsedSys < 40 || parsedSys > 260)) {
      return { error: "Systolic BP must be between 40 and 260." };
    }
    if (parsedDia !== undefined && (!Number.isFinite(parsedDia) || parsedDia < 20 || parsedDia > 180)) {
      return { error: "Diastolic BP must be between 20 and 180." };
    }
    if (parsedPulse !== undefined && (!Number.isFinite(parsedPulse) || parsedPulse < 20 || parsedPulse > 260)) {
      return { error: "Heart rate / pulse must be between 20 and 260." };
    }
    if (parsedSpo2 !== undefined && (!Number.isFinite(parsedSpo2) || parsedSpo2 < 40 || parsedSpo2 > 100)) {
      return { error: "SpO₂ must be between 40% and 100%." };
    }

    const now = new Date().toISOString();
    return {
      vital: {
        id: `vit_local_${crypto.randomUUID().slice(0, 8)}`,
        systolic: parsedSys !== undefined ? Math.round(parsedSys) : undefined,
        diastolic: parsedDia !== undefined ? Math.round(parsedDia) : undefined,
        pulse: parsedPulse !== undefined ? Math.round(parsedPulse) : undefined,
        spo2: parsedSpo2 !== undefined ? Math.round(parsedSpo2) : undefined,
        avpu: avpu || undefined,
        note: vitalNote.trim() || undefined,
        context: "pre_transfer",
        deviceTime: now,
        serverTime: "",
        recordedBy: actorStamp,
      },
    };
  }

  function commitVitalBuffer(): Vital[] | null {
    if (!hasPendingVitalInput()) return recordedVitals;
    const built = buildVitalFromInputs();
    if (built.error) {
      setError(built.error);
      return null;
    }
    if (!built.vital) return recordedVitals;
    const next = [...recordedVitals, built.vital];
    setRecordedVitals(next);
    setSystolic("");
    setDiastolic("");
    setPulse("");
    setSpo2("");
    setAvpu("");
    setVitalNote("");
    setError("");
    return next;
  }

  function buildPayload(vitalsToUse: Vital[]) {
    const parsedAge = age.trim() === "" ? undefined : Number(age);
    return {
      id: referralId,
      category,
      patient: {
        name: name.trim() || undefined,
        hospitalNumber: hospitalNumber.trim(),
        age: parsedAge !== undefined && Number.isFinite(parsedAge) ? Math.round(parsedAge) : undefined,
        ageUnit,
        sex,
      },
      diagnosis: diagnosis.trim(),
      allergies: allergies.trim() || "None known",
      notes: notes.trim(),
      interventions,
      vitals: vitalsToUse.map((v) => ({
        id: v.id.startsWith("vit_local_") ? undefined : v.id,
        systolic: v.systolic,
        diastolic: v.diastolic,
        pulse: v.pulse,
        spo2: v.spo2,
        avpu: v.avpu,
        note: v.note,
        deviceTime: v.deviceTime,
        recordedBy: v.recordedBy,
      })),
    };
  }

  // Autosave to IndexedDB
  useEffect(() => {
    if (!resumePromptChecked || initialReferral || resumableDraft || !session) return;
    if (skipFirstAutosave.current) {
      skipFirstAutosave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const pending = hasPendingVitalInput() ? buildVitalFromInputs().vital : undefined;
      const mergedVitals = pending ? [...recordedVitals, pending] : recordedVitals;
      const now = new Date().toISOString();
      const payload = {
        id: referralId,
        category,
        patient: {
          name: name.trim() || undefined,
          hospitalNumber: hospitalNumber.trim(),
          age: age.trim() === "" ? undefined : Number(age),
          ageUnit,
          sex,
        },
        diagnosis: diagnosis.trim(),
        allergies: allergies.trim() || "None known",
        notes: notes.trim(),
        interventions,
        vitals: mergedVitals,
      };
      void saveDraft({
        id: referralId,
        updatedAt: now,
        localOnly: true,
        facilityId: session.facility.id,
        userId: session.user.id,
        kind: "autosave",
        step,
        payload,
      }).then(() => setAutosaveAt(now));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resumePromptChecked,
    initialReferral,
    resumableDraft,
    session,
    referralId,
    step,
    category,
    name,
    hospitalNumber,
    age,
    ageUnit,
    sex,
    diagnosis,
    allergies,
    notes,
    interventions,
    recordedVitals,
    systolic,
    diastolic,
    pulse,
    spo2,
    avpu,
    vitalNote,
  ]);

  function toggleIntervention(item: string) {
    setInterventions((current) => {
      if (item === "None yet") {
        return current.includes("None yet") ? [] : ["None yet"];
      }
      const withoutNone = current.filter((v) => v !== "None yet");
      if (withoutNone.includes(item)) return withoutNone.filter((v) => v !== item);
      if (withoutNone.length >= 12) return withoutNone;
      return [...withoutNone, item];
    });
  }

  function addCustomIntervention() {
    const clean = customIntervention.trim().slice(0, 40);
    if (!clean) return;
    setInterventions((current) => {
      const withoutNone = current.filter((v) => v !== "None yet");
      if (withoutNone.includes(clean) || withoutNone.length >= 12) return withoutNone;
      return [...withoutNone, clean];
    });
    setCustomIntervention("");
  }

  function validateForm(vitalsToUse: Vital[], requireVitals: boolean): string | null {
    if (hospitalNumber.trim().length < 2) return "Enter the originating clinic hospital number (at least 2 characters).";
    const ageNum = Number(age);
    if (age.trim() === "" || !Number.isFinite(ageNum) || ageNum < 0 || ageNum > 120) {
      return "Enter a valid patient age between 0 and 120.";
    }
    if (diagnosis.trim().length < 2) return "Enter the suspected diagnosis (at least 2 characters).";
    if (requireVitals && vitalsToUse.length === 0) {
      return "Record at least one vital sign (BP, pulse, SpO₂, or AVPU) before broadcasting.";
    }
    return null;
  }

  async function queueLocally(withBroadcast: boolean, vitalsToUse: Vital[]) {
    if (!session) return;
    const payload = buildPayload(vitalsToUse);
    const now = new Date().toISOString();
    await saveDraft({
      id: referralId,
      updatedAt: now,
      localOnly: true,
      facilityId: session.facility.id,
      userId: session.user.id,
      kind: "queued",
      step: 4,
      payload,
    });
    await enqueue({
      opId: newOpId(),
      kind: "upsert",
      referralId,
      body: payload,
      enqueuedAt: now,
      attempts: 0,
      nextAttemptAt: Date.now(),
      hold: false,
      facilityId: session.facility.id,
      userId: session.user.id,
      summary: {
        category,
        hospitalNumber: hospitalNumber.trim(),
        patientName: name.trim() || undefined,
        diagnosis: diagnosis.trim(),
      },
      lastError: "Queued on this device. Not sent.",
    });
    if (withBroadcast) {
      await enqueue({
        opId: newOpId(),
        kind: "broadcast",
        referralId,
        body: { mode },
        enqueuedAt: new Date(Date.now() + 10).toISOString(),
        attempts: 0,
        nextAttemptAt: Date.now(),
        hold: false,
        needsPin: true,
        facilityId: session.facility.id,
        userId: session.user.id,
        summary: {
          category,
          hospitalNumber: hospitalNumber.trim(),
          patientName: name.trim() || undefined,
          diagnosis: diagnosis.trim(),
          mode,
        },
        lastError: "Broadcast queued locally. Enter PIN in On this device when ready to send.",
      });
    }
    await clearAutosavesFor(session.facility.id, session.user.id, referralId);
  }

  async function saveDraftAction(goToRouting: boolean) {
    setError("");
    setStatusNote("");
    const vitalsToUse = commitVitalBuffer();
    if (!vitalsToUse) return;
    const issue = validateForm(vitalsToUse, goToRouting);
    if (issue) {
      setError(issue);
      return;
    }

    if (connectivity === "offline") {
      setBusyAction("queue");
      try {
        await queueLocally(false, vitalsToUse);
        setStatusNote("Saved to this device as Queued: not sent.");
        onQueued?.(referralId);
      } catch (caught) {
        setError(problemMessage(caught, "Could not save offline draft."));
      } finally {
        setBusyAction("");
      }
      return;
    }

    setBusyAction(goToRouting ? "route" : "save");
    try {
      const referral = await api<PresentedReferral>("referrals", { body: buildPayload(vitalsToUse) });
      await deleteDraft(referralId).catch(() => {});
      if (session) await clearAutosavesFor(session.facility.id, session.user.id);
      if (goToRouting) {
        router.push(`/clinic/referrals/${referral.id}/routing`);
      } else {
        onCreated(referral);
      }
    } catch (caught) {
      if (caught instanceof OfflineError) {
        await queueLocally(false, vitalsToUse).catch(() => {});
        setStatusNote("Connection lost. Referral saved locally as Queued: not sent.");
        onQueued?.(referralId);
      } else {
        setError(problemMessage(caught, "The draft was not saved."));
      }
      setBusyAction("");
    }
  }

  async function broadcastNowAction() {
    setError("");
    setStatusNote("");
    const vitalsToUse = commitVitalBuffer();
    if (!vitalsToUse) return;
    const issue = validateForm(vitalsToUse, true);
    if (issue) {
      setError(issue);
      return;
    }

    if (connectivity === "offline") {
      setBusyAction("queue");
      try {
        await queueLocally(true, vitalsToUse);
        setStatusNote("Device is offline. Queued referral and broadcast locally (not sent).");
        onQueued?.(referralId);
      } catch (caught) {
        setError(problemMessage(caught, "Could not queue offline broadcast."));
      } finally {
        setBusyAction("");
      }
      return;
    }

    if (pin.length < 4) {
      setError("Enter your 4+ digit clinician PIN before broadcasting.");
      return;
    }

    setBusyAction("broadcast");
    setStatusNote("Verifying PIN and sending broadcast to simulated server — pending acknowledgement…");
    try {
      const grant = await api<{ pinToken: string }>("auth/pin", {
        body: { purpose: "step_up", pin },
      });
      await api<PresentedReferral>("referrals", { body: buildPayload(vitalsToUse) });
      const result = await api<{ referral: PresentedReferral; ranked: RankedFacility[] }>(
        `referrals/${referralId}/broadcast`,
        {
          body: { mode },
          pinToken: grant.pinToken,
        },
      );
      await deleteDraft(referralId).catch(() => {});
      if (session) await clearAutosavesFor(session.facility.id, session.user.id);
      onCreated(result.referral);
    } catch (caught) {
      if (caught instanceof OfflineError) {
        await queueLocally(true, vitalsToUse).catch(() => {});
        setStatusNote("Link dropped before server acknowledged. Saved on this device as Queued: not sent.");
        onQueued?.(referralId);
      } else {
        setStatusNote("");
        setError(problemMessage(caught, "Broadcast could not be completed."));
      }
      setBusyAction("");
    }
  }

  async function discardCurrentDraft() {
    await deleteDraft(referralId).catch(() => {});
    if (session) await clearAutosavesFor(session.facility.id, session.user.id);
    onCancel();
  }

  const previewVital = useMemo(() => {
    if (hasPendingVitalInput()) {
      return {
        systolic: systolic || undefined,
        diastolic: diastolic || undefined,
        pulse: pulse || undefined,
        spo2: spo2 || undefined,
        avpu: avpu || undefined,
      };
    }
    const last = recordedVitals.at(-1);
    return last
      ? {
          systolic: last.systolic,
          diastolic: last.diastolic,
          pulse: last.pulse,
          spo2: last.spo2,
          avpu: last.avpu,
        }
      : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systolic, diastolic, pulse, spo2, avpu, recordedVitals]);

  const effectiveVitalCount = recordedVitals.length + (hasPendingVitalInput() ? 1 : 0);
  const validationIssue = validateForm(
    hasPendingVitalInput() ? [...recordedVitals, { id: "tmp", context: "pre_transfer", deviceTime: "", serverTime: "", recordedBy: actorStamp }] : recordedVitals,
    true,
  );

  return (
    <div className="space-y-4 rounded-3xl border border-line bg-card p-4 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal">
            {initialReferral ? "Edit preparing referral" : "Emergency referral wizard"}
          </p>
          <h2 className="mt-1 font-display text-2xl text-teal-dark sm:text-3xl">
            {initialReferral ? `Update ${initialReferral.patient.hospitalNumber}` : "New emergency referral"}
          </h2>
          <p className="mt-1 text-xs text-ink/65">
            {autosaveAt
              ? `Autosaved on this device at ${formatClock(autosaveAt)} · ID ${referralId.slice(0, 12)}`
              : "Autosaves on this device while you type. Server chooses destination on broadcast."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!initialReferral ? (
            <button
              type="button"
              onClick={() => void discardCurrentDraft()}
              className="min-h-[40px] rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink/75 hover:border-clay hover:text-clay"
            >
              Discard draft
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[40px] rounded-full border border-line bg-white px-3.5 py-1.5 text-xs font-semibold text-ink/80"
          >
            Close
          </button>
        </div>
      </div>

      {resumableDraft ? (
        <div className="rounded-2xl border border-teal/35 bg-mist p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-dark">Unsaved draft found on this device</p>
          <p className="mt-1 text-sm text-ink">
            {String((resumableDraft.payload.patient as Record<string, unknown> | undefined)?.hospitalNumber || "No hospital ref yet")} ·{" "}
            {typeof resumableDraft.payload.category === "string" && resumableDraft.payload.category in CATEGORY_LABEL
              ? CATEGORY_LABEL[resumableDraft.payload.category as Category]
              : "Referral"}{" "}
            · saved {formatWhen(resumableDraft.updatedAt)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyDraftRecord(resumableDraft)}
              className="min-h-[44px] rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white"
            >
              Resume draft
            </button>
            <button
              type="button"
              onClick={() => void discardResumable()}
              className="min-h-[44px] rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink"
            >
              Discard & start fresh
            </button>
          </div>
        </div>
      ) : null}

      {/* Stepper tabs */}
      <nav aria-label="Referral wizard steps" className="grid grid-cols-4 gap-1.5">
        {STEPS.map((item) => {
          const active = step === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (step === 3 && hasPendingVitalInput()) {
                  const committed = commitVitalBuffer();
                  if (!committed) return;
                }
                setStep(item.id);
              }}
              className={cx(
                "min-h-[44px] rounded-2xl border px-2 py-2 text-center text-xs font-semibold transition",
                active
                  ? "border-teal bg-teal text-white"
                  : item.id < step
                    ? "border-teal/30 bg-mist text-teal-dark"
                    : "border-line bg-white text-ink/70 hover:border-teal/50",
              )}
            >
              <span className="block text-[10px] opacity-75">Step {item.id}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Step 1: Category */}
      {step === 1 ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Choose emergency category</h3>
            <p className="text-xs text-ink/65">Drives hospital capability matching and pre-arrival prep checklist.</p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {CATEGORIES.map((item) => {
              const selected = category === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={cx(
                    "min-h-[82px] rounded-2xl border p-3.5 text-left transition",
                    selected ? "border-teal bg-mist ring-1 ring-teal" : "border-line bg-white hover:border-teal/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-teal-dark">{CATEGORY_LABEL[item]}</span>
                    {selected ? (
                      <span className="rounded-full bg-teal px-2 py-0.5 text-[11px] font-semibold text-white">Selected</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-ink/75">{CATEGORY_HINT[item]}</p>
                  <p className="mt-2 text-[11px] text-ink/55">Prep: {CATEGORY_RESOURCES[item].join(" · ")}</p>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-[48px] w-full rounded-full bg-teal px-6 py-2.5 text-sm font-semibold text-white sm:w-auto"
            >
              Next: Patient & diagnosis →
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 2: Patient & clinical */}
      {step === 2 ? (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-ink/75">
              Hospital number (patient_ref) <span className="text-clay">*</span>
              <input
                value={hospitalNumber}
                onChange={(event) => setHospitalNumber(event.target.value)}
                placeholder="e.g. RC-22410"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 font-mono text-sm"
              />
              <span className="mt-1 block text-[11px] font-normal text-ink/55">Links referral back to your clinic file.</span>
            </label>
            <label className="block text-xs font-semibold text-ink/75">
              Patient name (optional)
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Fictional name or leave blank"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm"
              />
              <span className="mt-1 block text-[11px] font-normal text-ink/55">Hidden from ambulance crew.</span>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className="block text-xs font-semibold text-ink/75">
                Age <span className="text-clay">*</span>
                <input
                  value={age}
                  onChange={(event) => setAge(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="0–120"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-base"
                />
              </label>
              <div>
                <span className="block text-xs font-semibold text-ink/75">Unit</span>
                <div className="mt-1 grid grid-cols-2 gap-1 rounded-xl border border-line bg-white p-1">
                  {(["years", "months"] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => setAgeUnit(unit)}
                      className={cx(
                        "min-h-[36px] rounded-lg px-2.5 text-xs font-semibold capitalize",
                        ageUnit === unit ? "bg-teal text-white" : "text-ink/70",
                      )}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-ink/75">
                Sex <span className="text-clay">*</span>
              </span>
              <div className="mt-1 grid grid-cols-4 gap-1 rounded-xl border border-line bg-white p-1">
                {SEX_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSex(opt.value)}
                    className={cx(
                      "min-h-[36px] rounded-lg px-2 text-xs font-semibold",
                      sex === opt.value ? "bg-teal text-white" : "text-ink/70",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="block text-xs font-semibold text-ink/75">
            Suspected diagnosis <span className="text-clay">*</span>
            <input
              value={diagnosis}
              onChange={(event) => setDiagnosis(event.target.value)}
              placeholder="e.g. Postpartum haemorrhage, acute respiratory distress"
              className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-ink/75">
              Allergies
              <div className="mt-1 flex gap-2">
                <input
                  value={allergies}
                  onChange={(event) => setAllergies(event.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setAllergies("None known")}
                  className="min-h-[44px] shrink-0 rounded-xl border border-line bg-paper px-3 text-xs font-semibold text-ink/80"
                >
                  None
                </button>
              </div>
            </label>
            <label className="block text-xs font-semibold text-ink/75">
              Clinical notes
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Key symptoms, onset time, obstetric/injury context…"
                className="mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-[48px] rounded-full border border-line bg-white px-5 py-2.5 text-sm font-semibold text-ink"
            >
              ← Category
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="min-h-[48px] rounded-full bg-teal px-6 py-2.5 text-sm font-semibold text-white"
            >
              Next: Vitals & interventions →
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 3: Vitals & interventions */}
      {step === 3 ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-line bg-paper/70 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Record baseline vitals</h3>
                <p className="text-xs text-ink/65">Each entry records timestamp and clinician ({actorStamp.name}).</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-teal-dark border border-line">
                {effectiveVitalCount} {effectiveVitalCount === 1 ? "reading" : "readings"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <label className="block text-xs font-semibold text-ink/75">
                Systolic BP
                <input
                  value={systolic}
                  onChange={(event) => setSystolic(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="mmHg"
                  className="mt-1 min-h-[48px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-base"
                />
              </label>
              <label className="block text-xs font-semibold text-ink/75">
                Diastolic BP
                <input
                  value={diastolic}
                  onChange={(event) => setDiastolic(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="mmHg"
                  className="mt-1 min-h-[48px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-base"
                />
              </label>
              <label className="block text-xs font-semibold text-ink/75">
                Heart rate
                <input
                  value={pulse}
                  onChange={(event) => setPulse(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="bpm"
                  className="mt-1 min-h-[48px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-base"
                />
              </label>
              <label className="block text-xs font-semibold text-ink/75">
                SpO₂ %
                <input
                  value={spo2}
                  onChange={(event) => setSpo2(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="%"
                  className="mt-1 min-h-[48px] w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-base"
                />
              </label>
            </div>

            <div>
              <span className="block text-xs font-semibold text-ink/75">AVPU consciousness</span>
              <div className="mt-1.5 grid grid-cols-4 gap-2">
                {(["A", "V", "P", "U"] as Avpu[]).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setAvpu((current) => (current === code ? "" : code))}
                    className={cx(
                      "min-h-[52px] rounded-xl border px-2 py-1.5 text-center transition",
                      avpu === code ? "border-teal bg-teal text-white" : "border-line bg-white text-ink",
                    )}
                  >
                    <span className="block font-mono text-base font-bold">{code}</span>
                    <span className="block text-[10px] opacity-80">{AVPU_LABEL[code]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[200px] flex-1 text-xs font-semibold text-ink/75">
                Vital note (optional)
                <input
                  value={vitalNote}
                  onChange={(event) => setVitalNote(event.target.value)}
                  placeholder="e.g. On 4L/min nasal prongs"
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={!hasPendingVitalInput()}
                onClick={() => void commitVitalBuffer()}
                className="min-h-[44px] rounded-full border border-teal bg-white px-4 py-2 text-xs font-semibold text-teal-dark disabled:opacity-45"
              >
                + Record vital set
              </button>
            </div>

            {recordedVitals.length > 0 ? (
              <ul className="space-y-2 pt-1">
                {recordedVitals.map((v, idx) => (
                  <li key={v.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2 text-xs">
                    <div>
                      <p className="font-semibold text-ink">
                        #{idx + 1} · {vitalLine(v)}
                      </p>
                      <p className="text-ink/60">
                        {formatClock(v.deviceTime)} · {v.recordedBy.name} ({v.recordedBy.registrationNumber})
                        {v.note ? ` · ${v.note}` : ""}
                      </p>
                    </div>
                    {v.id.startsWith("vit_local_") ? (
                      <button
                        type="button"
                        onClick={() => setRecordedVitals((curr) => curr.filter((item) => item.id !== v.id))}
                        className="text-xs font-semibold text-clay"
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-ink/75">Interventions already given</legend>
            <div className="flex flex-wrap gap-2">
              {INTERVENTIONS.map((item) => {
                const active = interventions.includes(item);
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleIntervention(item)}
                    className={cx(
                      "min-h-[42px] rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
                      active ? "border-teal bg-mist text-teal-dark" : "border-line bg-white text-ink/80",
                    )}
                  >
                    {active ? `✓ ${item}` : item}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <input
                value={customIntervention}
                onChange={(event) => setCustomIntervention(event.target.value)}
                placeholder="Add another intervention…"
                className="min-h-[40px] flex-1 rounded-xl border border-line bg-white px-3 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={addCustomIntervention}
                className="min-h-[40px] rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink"
              >
                Add
              </button>
            </div>
          </fieldset>

          <div className="flex flex-wrap justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                if (hasPendingVitalInput() && !commitVitalBuffer()) return;
                setStep(2);
              }}
              className="min-h-[48px] rounded-full border border-line bg-white px-5 py-2.5 text-sm font-semibold text-ink"
            >
              ← Patient
            </button>
            <button
              type="button"
              onClick={() => {
                if (hasPendingVitalInput() && !commitVitalBuffer()) return;
                setStep(4);
              }}
              className="min-h-[48px] rounded-full bg-teal px-6 py-2.5 text-sm font-semibold text-white"
            >
              Next: Review & broadcast →
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 4: Review & Send */}
      {step === 4 ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-line bg-paper p-4 text-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-teal-dark">{CATEGORY_LABEL[category]}</span>
              <span className="font-mono text-xs text-ink/60">ref {hospitalNumber.trim() || "—"}</span>
            </div>
            <p className="font-semibold text-ink">
              {name.trim() ? `${name.trim()} · ` : ""}
              {age ? `${age} ${ageUnit}` : "Age missing"} · {sex}
            </p>
            <p className="text-ink/85">{diagnosis.trim() || "Diagnosis missing"}</p>
            <p className="text-xs text-ink/70">
              Allergies: {allergies.trim() || "None known"}
              {interventions.length ? ` · Given: ${interventions.join(", ")}` : ""}
            </p>
            <p className="text-xs font-semibold text-ink/80">
              Latest vital: {vitalLine(recordedVitals.at(-1))}
            </p>
          </div>

          {validationIssue ? (
            <div className="rounded-2xl border border-amber/35 bg-amber/10 px-4 py-3 text-xs text-ink">
              <span className="font-semibold">Needed before broadcast: </span>
              {validationIssue}
            </div>
          ) : null}

          {connectivity === "offline" ? (
            <div className="space-y-3 rounded-2xl border border-clay/30 bg-clay/10 p-4 text-sm">
              <p className="font-semibold text-clay">Device is offline — nothing will be sent now</p>
              <p className="text-xs text-ink/80">
                Save locally as a Draft or Queue for automatic/manual retry when connectivity returns. You can also preview the compressed SMS packet.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => void saveDraftAction(false)}
                  className="min-h-[48px] rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busyAction === "queue" ? "Saving to device…" : "Queue referral (not sent)"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => void broadcastNowAction()}
                  className="min-h-[48px] rounded-full border border-clay bg-white px-5 py-2.5 text-sm font-semibold text-clay disabled:opacity-50"
                >
                  Queue emergency broadcast
                </button>
                <button
                  type="button"
                  onClick={() => setSmsOpen(true)}
                  className="min-h-[48px] rounded-full border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink"
                >
                  Compressed SMS preview
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-line bg-white p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Broadcast mode</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setMode("single")}
                    className={cx(
                      "min-h-[52px] rounded-xl border px-3 py-2 text-left text-xs",
                      mode === "single" ? "border-teal bg-mist font-semibold text-teal-dark" : "border-line bg-white text-ink/75",
                    )}
                  >
                    <span className="block text-sm">Nearest eligible hospital</span>
                    <span className="text-[11px] opacity-75">Sequential offer with auto-reroute</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("parallel")}
                    className={cx(
                      "min-h-[52px] rounded-xl border px-3 py-2 text-left text-xs",
                      mode === "parallel" ? "border-teal bg-mist font-semibold text-teal-dark" : "border-line bg-white text-ink/75",
                    )}
                  >
                    <span className="block text-sm">Up to {session?.config.parallelOfferLimit ?? 3} hospitals at once</span>
                    <span className="text-[11px] opacity-75">First bed lock withdraws others</span>
                  </button>
                </div>
              </div>

              <PinStepUpField
                id="wizard-broadcast-pin"
                value={pin}
                onChange={setPin}
                label="Confirm with clinician PIN to broadcast"
                hint="Required step-up check before alerting receiving hospitals."
              />

              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={Boolean(busyAction) || Boolean(validationIssue) || pin.length < 4}
                  onClick={() => void broadcastNowAction()}
                  className="min-h-[50px] flex-1 rounded-full bg-clay px-5 py-2.5 text-sm font-bold text-white hover:bg-clay/90 disabled:opacity-45 sm:flex-none"
                >
                  {busyAction === "broadcast" ? "Broadcasting (pending ack)…" : "BROADCAST EMERGENCY"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => void saveDraftAction(true)}
                  className="min-h-[50px] rounded-full bg-teal px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-45"
                >
                  {busyAction === "route" ? "Opening routing…" : "Review ranked hospitals"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => void saveDraftAction(false)}
                  className="min-h-[50px] rounded-full border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-45"
                >
                  {busyAction === "save" ? "Saving…" : "Save draft on server"}
                </button>
                <button
                  type="button"
                  onClick={() => setSmsOpen(true)}
                  className="min-h-[50px] rounded-full border border-line bg-paper px-4 py-2.5 text-xs font-semibold text-ink/80"
                >
                  SMS fallback preview
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="min-h-[44px] rounded-full border border-line bg-white px-5 py-2 text-sm font-semibold text-ink"
            >
              ← Vitals & interventions
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="rounded-xl bg-clay/10 px-3.5 py-2.5 text-sm font-semibold text-clay">{error}</p> : null}
      {statusNote ? <p className="rounded-xl bg-mist px-3.5 py-2.5 text-sm font-semibold text-teal-dark">{statusNote}</p> : null}

      <SmsFallbackModal
        open={smsOpen}
        onClose={() => setSmsOpen(false)}
        input={{
          referralId,
          category,
          hospitalNumber,
          age,
          ageUnit,
          sex,
          diagnosis,
          vital: previewVital,
          facilityCode: session?.facility.shortName,
          userCode: session?.user.registrationNumber,
        }}
      />
    </div>
  );
}
