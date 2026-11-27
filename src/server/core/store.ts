import fs from "fs";
import path from "path";
import type { Database } from "@/domain/types";
import { drainWs, publish } from "@/server/realtime/hub";
import { createSeed } from "@/server/realtime/seed";
import { processTimers } from "@/server/core/workflow";
import { db as firestoreDb } from "@/services/firebase";
import { doc, setDoc } from "firebase/firestore";

const FILE = path.join(process.cwd(), "data", "store.json");

type GlobalStore = {
  chain: Promise<void>;
  memory?: Database;
};

const g = globalThis as typeof globalThis & { __nafasi?: GlobalStore };

function bucket(): GlobalStore {
  if (!g.__nafasi) g.__nafasi = { chain: Promise.resolve() };
  return g.__nafasi;
}

function readFromDisk(): Database {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as Database;
    if (!parsed || parsed.seedVersion !== createSeed().seedVersion) return createSeed();
    return parsed;
  } catch {
    return createSeed();
  }
}

function load(): Database {
  const slot = bucket();
  if (!slot.memory) slot.memory = readFromDisk();
  return slot.memory;
}

function sanitize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// Background async cloud sync to Firestore so local disk and cloud stay synchronized
async function syncToFirestore(db: Database) {
  try {
    if (!firestoreDb) return;
    // Sync latest system state snapshot to Firestore cloud
    await setDoc(doc(firestoreDb, "system_state", "live_snapshot"), sanitize({
      updatedAt: new Date().toISOString(),
      referralCount: db.referrals.length,
      activeReferrals: db.referrals.filter((r) => !["COMPLETED", "CANCELLED"].includes(r.status)).length,
      auditCount: db.events.length,
      latestEvent: db.events.at(-1) ?? null,
    }), { merge: true });

    // Sync any newly touched referrals
    const latestRef = db.referrals.at(-1);
    if (latestRef) {
      await setDoc(doc(firestoreDb, "referrals", latestRef.id), sanitize(latestRef), { merge: true });
    }
  } catch (err) {
    // Cloud sync logs non-fatal warnings without interrupting local runtime
    console.warn("Firestore background sync note:", err);
  }
}

function persist(db: Database) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
  bucket().memory = db;
  // Trigger cloud sync
  void syncToFirestore(db);
}

export function readDb(): Database {
  return structuredClone(load());
}

export function mutate<T>(fn: (db: Database) => T): Promise<T> {
  const slot = bucket();
  const run = slot.chain.then(() => {
    const db = load();
    processTimers(db);
    const result = fn(db);
    persist(db);
    for (const event of drainWs()) publish(event);
    return result;
  });
  slot.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resetDatabase() {
  const slot = bucket();
  const run = slot.chain.then(() => {
    const db = createSeed();
    persist(db);
    return db;
  });
  slot.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
