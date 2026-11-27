export type DraftRecord = {
  id: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  localOnly: boolean;
};

export type QueueOp = {
  opId: string;
  kind: "upsert" | "broadcast" | "vitals" | "cancel";
  referralId: string;
  body: Record<string, unknown>;
  enqueuedAt: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  hold?: boolean;
  needsPin?: boolean;
};

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

export function saveDraft(draft: DraftRecord) {
  return request("drafts", "readwrite", (store) => store.put(draft));
}

export function readDrafts() {
  return request<DraftRecord[]>("drafts", "readonly", (store) => store.getAll());
}

export function deleteDraft(id: string) {
  return request("drafts", "readwrite", (store) => store.delete(id));
}

export function enqueue(op: QueueOp) {
  return request("queue", "readwrite", (store) => store.put(op));
}

export function readQueue() {
  return request<QueueOp[]>("queue", "readonly", (store) => store.getAll());
}

export function removeOp(opId: string) {
  return request("queue", "readwrite", (store) => store.delete(opId));
}

export async function ensureSampleQueue() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("nafasi-sample-queue")) return;
  const id = "ref_local_sample";
  await saveDraft({
    id,
    updatedAt: new Date().toISOString(),
    localOnly: true,
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
    lastError: "Queued on this device. Not sent.",
  });
  localStorage.setItem("nafasi-sample-queue", "1");
}
