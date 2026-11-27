import type { BroadcastMode, Category, TransportStatus } from "@/domain/types";

export type DraftRecord = {
  id: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  localOnly: boolean;
  facilityId?: string;
  userId?: string;
  kind?: "autosave" | "queued";
  step?: number;
};

export type QueueOpSummary = {
  category?: Category;
  hospitalNumber?: string;
  patientName?: string;
  diagnosis?: string;
  mode?: BroadcastMode;
};

export type QueueOp = {
  opId: string;
  kind: "upsert" | "broadcast" | "vitals" | "cancel";
  referralId: string;
  body: Record<string, unknown>;
  enqueuedAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastAttemptAt?: string;
  lastError?: string;
  hold?: boolean;
  needsPin?: boolean;
  facilityId?: string;
  userId?: string;
  summary?: QueueOpSummary;
};

export type SyncReceipt = {
  opId: string;
  referralId: string;
  kind: QueueOp["kind"];
  status: "applied" | "duplicate";
  deliveryLabel: string;
  acknowledgedAt: string;
  facilityId?: string;
  summary?: QueueOpSummary;
};

export type TransportPendingUpdate =
  | {
      id: string;
      kind: "status";
      transportId: string;
      referralId: string;
      status: TransportStatus;
      note?: string;
      createdAt: string;
      attempts: number;
      lastError?: string;
    }
  | {
      id: string;
      kind: "vitals";
      transportId: string;
      referralId: string;
      body: {
        systolic?: number;
        diastolic?: number;
        pulse?: number;
        spo2?: number;
        avpu?: string;
        note?: string;
      };
      createdAt: string;
      attempts: number;
      lastError?: string;
    };

export const OFFLINE_EVENT = "nafasi:offline-changed";

export function notifyOfflineChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("nafasi", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "opId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function request<T>(storeName: "drafts" | "queue", mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const result = run(tx.objectStore(storeName));
        result.onsuccess = () => resolve(result.result);
        result.onerror = () => reject(result.error);
      }),
  );
}

export async function saveDraft(draft: DraftRecord) {
  const res = await request("drafts", "readwrite", (store) => store.put(draft));
  notifyOfflineChanged();
  return res;
}

export function readDrafts() {
  return request<DraftRecord[]>("drafts", "readonly", (store) => store.getAll());
}

export function readDraft(id: string) {
  return request<DraftRecord | undefined>("drafts", "readonly", (store) => store.get(id));
}

export async function deleteDraft(id: string) {
  const res = await request("drafts", "readwrite", (store) => store.delete(id));
  notifyOfflineChanged();
  return res;
}

export async function enqueue(op: QueueOp) {
  const res = await request("queue", "readwrite", (store) => store.put(op));
  notifyOfflineChanged();
  return res;
}

export function readQueue() {
  return request<QueueOp[]>("queue", "readonly", (store) => store.getAll());
}

export async function removeOp(opId: string) {
  const res = await request("queue", "readwrite", (store) => store.delete(opId));
  notifyOfflineChanged();
  return res;
}

export function newClientReferralId() {
  return `ref_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function newOpId() {
  return `op_${crypto.randomUUID()}`;
}

export function computeBackoffMs(attempts: number) {
  const exp = Math.min(attempts, 5);
  return Math.min(120_000, 5_000 * 2 ** exp);
}

export async function readLatestAutosave(facilityId: string, userId: string): Promise<DraftRecord | null> {
  const drafts = await readDrafts();
  const matches = drafts
    .filter((item) => item.kind === "autosave" && item.facilityId === facilityId && (!item.userId || item.userId === userId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return matches[0] ?? null;
}

export async function clearAutosavesFor(facilityId: string, userId: string, keepId?: string) {
  const drafts = await readDrafts();
  const targets = drafts.filter(
    (item) => item.kind === "autosave" && item.facilityId === facilityId && (!item.userId || item.userId === userId) && item.id !== keepId,
  );
  await Promise.all(targets.map((item) => deleteDraft(item.id)));
}

const RECEIPT_KEY = "nafasi-sync-receipts";

export function readSyncReceipts(facilityId?: string): SyncReceipt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(RECEIPT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SyncReceipt[];
    if (!Array.isArray(parsed)) return [];
    return facilityId ? parsed.filter((item) => !item.facilityId || item.facilityId === facilityId) : parsed;
  } catch {
    return [];
  }
}

export function appendSyncReceipts(next: SyncReceipt[]) {
  if (typeof window === "undefined" || !next.length) return;
  try {
    const existing = readSyncReceipts();
    const merged = [...next, ...existing].slice(0, 12);
    sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(merged));
    notifyOfflineChanged();
  } catch {
    /* ignore storage quota issues */
  }
}

function transportPendingKey(userId: string) {
  return `nafasi-transport-pending-${userId}`;
}

export function readTransportPending(userId: string): TransportPendingUpdate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(transportPendingKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TransportPendingUpdate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTransportPending(userId: string, items: TransportPendingUpdate[]) {
  if (typeof window === "undefined") return;
  try {
    if (!items.length) localStorage.removeItem(transportPendingKey(userId));
    else localStorage.setItem(transportPendingKey(userId), JSON.stringify(items));
    notifyOfflineChanged();
  } catch {
    /* ignore storage quota issues */
  }
}

const CAT_SHORT: Record<Category, string> = {
  obstetric: "OBS",
  trauma: "TRM",
  icu: "ICU",
  blood: "BLD",
  respiratory: "RSP",
  cardiac: "CRD",
  other: "OTH",
};

export interface CompressedSmsResult {
  text: string;
  chars: number;
  segments: number;
  realMessageSent: false;
  fields: { label: string; value: string }[];
}

export function formatCompressedSms(input: {
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
}): CompressedSmsResult {
  const cat = CAT_SHORT[input.category] ?? "OTH";
  const ageVal = input.age !== undefined && input.age !== "" ? String(input.age) : "?";
  const unit = input.ageUnit === "months" ? "M" : "Y";
  const sex = (input.sex?.[0] ?? "U").toUpperCase();
  const ref = (input.hospitalNumber || "NOREF").replace(/\|/g, "").trim().slice(0, 14);
  const bp =
    input.vital?.systolic && input.vital?.diastolic
      ? `${input.vital.systolic}/${input.vital.diastolic}`
      : input.vital?.systolic
        ? `${input.vital.systolic}/?`
        : "-";
  const hr = input.vital?.pulse ? String(input.vital.pulse) : "-";
  const o2 = input.vital?.spo2 ? `${input.vital.spo2}%` : "-";
  const avpu = input.vital?.avpu ? String(input.vital.avpu).toUpperCase() : "-";
  const dx = (input.diagnosis || "Emergency").replace(/[\r\n|]+/g, " ").trim().slice(0, 32);
  const fac = (input.facilityCode || "CLINIC").replace(/[\r\n|]+/g, "").trim().slice(0, 10);
  const usr = (input.userCode || "STAFF").replace(/[\r\n|]+/g, "").trim().slice(0, 12);
  const uuid8 = input.referralId.replace(/^ref_/, "").slice(0, 8);

  const text = `NAF1|${cat}|${ageVal}${unit}${sex}|${ref}|BP${bp} P${hr} O2:${o2} ${avpu}|${dx}|${fac}|${usr}|${uuid8}`;
  const chars = text.length;
  const segments = Math.max(1, Math.ceil(chars / 160));

  return {
    text,
    chars,
    segments,
    realMessageSent: false,
    fields: [
      { label: "Category", value: cat },
      { label: "Demographics", value: `${ageVal}${unit} / ${sex}` },
      { label: "Hospital ref", value: ref },
      { label: "Vitals", value: `BP ${bp}, Pulse ${hr}, SpO₂ ${o2}, AVPU ${avpu}` },
      { label: "Diagnosis", value: dx },
      { label: "Facility / Clinician", value: `${fac} · ${usr}` },
      { label: "Idempotency key", value: uuid8 },
    ],
  };
}

export async function ensureSampleQueue() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("nafasi-sample-queue")) return;
  const id = "ref_local_sample";
  await saveDraft({
    id,
    updatedAt: new Date().toISOString(),
    localOnly: true,
    kind: "queued",
    facilityId: "fac_rafiki",
    payload: {
      category: "respiratory",
      patient: { hospitalNumber: "RC-LOCAL-1", age: 3, ageUnit: "years", sex: "male", name: "Baraka Musa" },
      diagnosis: "Pneumonia with low oxygen",
      notes: "Sample draft stored only on this device.",
      allergies: "None known",
      interventions: ["Oxygen"],
      vitals: [{ spo2: 89, pulse: 150, avpu: "A", systolic: 90, diastolic: 60 }],
    },
  });
  await enqueue({
    opId: "op_local_sample",
    kind: "upsert",
    referralId: id,
    body: {},
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: Date.now() + 86_400_000,
    hold: true,
    facilityId: "fac_rafiki",
    summary: {
      category: "respiratory",
      hospitalNumber: "RC-LOCAL-1",
      patientName: "Baraka Musa",
      diagnosis: "Pneumonia with low oxygen",
    },
    lastError: "Held on this device as a fictional sample. Not sent.",
  });
  localStorage.setItem("nafasi-sample-queue", "1");
}
