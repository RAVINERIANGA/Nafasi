import fs from "fs";
import path from "path";
import type { Database } from "@/domain/types";
import { drainWs, publish } from "@/server/realtime/hub";
import { createSeed } from "@/server/realtime/seed";
import { processTimers } from "@/server/core/workflow";

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

function persist(db: Database) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
  bucket().memory = db;
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
