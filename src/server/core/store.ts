import { Pool, type PoolClient } from "pg";
import type {
  AppNotification,
  AuditEvent,
  Bed,
  CapacityRecord,
  Database,
  Facility,
  OtpChallenge,
  PinGrant,
  Referral,
  Session,
  SystemConfig,
  Transport,
  User,
} from "@/domain/types";
import { drainWs, publish } from "@/server/realtime/hub";
import { createSeed } from "@/server/realtime/seed";
import { processTimers } from "@/server/core/workflow";

type Slot = {
  chain: Promise<void>;
  pool?: Pool;
};

const g = globalThis as typeof globalThis & { __nafasi?: Slot };

function bucket(): Slot {
  if (!g.__nafasi) g.__nafasi = { chain: Promise.resolve() };
  return g.__nafasi;
}

function connection(): Pool {
  const slot = bucket();
  if (slot.pool) return slot.pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Add the Render Postgres URL to .env.local.");
  const remote = /render\.com|sslmode=require/i.test(connectionString);
  slot.pool = new Pool({
    connectionString,
    max: 4,
    ssl: remote ? { rejectUnauthorized: false } : undefined,
  });
  return slot.pool;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    subrole TEXT NOT NULL,
    registration_number TEXT NOT NULL,
    facility_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    pin TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    type TEXT NOT NULL,
    region TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    capabilities TEXT NOT NULL,
    phone TEXT NOT NULL,
    participating INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS beds (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    facility_id TEXT NOT NULL,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    lock_json TEXT
  );
  CREATE TABLE IF NOT EXISTS capacity (
    facility_id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    oxygen_available INTEGER NOT NULL,
    blood_units INTEGER NOT NULL,
    theatre_available INTEGER NOT NULL,
    notes TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    prediction_note TEXT
  );
  CREATE TABLE IF NOT EXISTS referrals (id TEXT PRIMARY KEY, position INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS transports (id TEXT PRIMARY KEY, position INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, position INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, position INTEGER NOT NULL, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    device_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pin_grants (
    token TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    pending_token TEXT
  );
  CREATE TABLE IF NOT EXISTS applied_ops (
    op_id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    body TEXT NOT NULL
  );
`;

async function rows<T>(client: PoolClient, sql: string): Promise<T[]> {
  const result = await client.query(sql);
  return result.rows as T[];
}

async function readAll(client: PoolClient): Promise<Database> {
  const users = (await rows<User & { registration_number: string; facility_id: string }>(client, "SELECT * FROM users ORDER BY position")).map(
    (row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      subrole: row.subrole,
      registrationNumber: row.registration_number,
      facilityId: row.facility_id,
      phone: row.phone,
      email: row.email,
      pin: row.pin,
    }),
  );
  const facilities = (
    await rows<{
      id: string;
      name: string;
      short_name: string;
      type: Facility["type"];
      region: string;
      lat: number;
      lng: number;
      capabilities: string;
      phone: string;
      participating: number;
    }>(client, "SELECT * FROM facilities ORDER BY position")
  ).map((row) => ({
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    type: row.type,
    region: row.region,
    lat: row.lat,
    lng: row.lng,
    capabilities: JSON.parse(row.capabilities) as Facility["capabilities"],
    phone: row.phone,
    participating: Boolean(row.participating),
  }));
  const beds = (await rows<Bed & { facility_id: string; lock_json: string | null }>(client, "SELECT * FROM beds ORDER BY position")).map((row) => ({
    id: row.id,
    facilityId: row.facility_id,
    label: row.label,
    kind: row.kind,
    status: row.status,
    lock: row.lock_json ? (JSON.parse(row.lock_json) as Bed["lock"]) : undefined,
  }));
  const capacity = (
    await rows<
      CapacityRecord & {
        facility_id: string;
        oxygen_available: number;
        blood_units: number;
        theatre_available: number;
        updated_by: string;
        updated_by_name: string;
        updated_at: string;
        prediction_note: string | null;
      }
    >(client, "SELECT * FROM capacity ORDER BY position")
  ).map((row) => ({
    facilityId: row.facility_id,
    oxygenAvailable: Boolean(row.oxygen_available),
    bloodUnits: row.blood_units,
    theatreAvailable: Boolean(row.theatre_available),
    notes: row.notes,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at,
    predictionNote: row.prediction_note ?? undefined,
  }));
  const body = async <T>(table: string) =>
    (await rows<{ body: string }>(client, `SELECT body FROM ${table} ORDER BY position`)).map((row) => JSON.parse(row.body) as T);
  const applied = await rows<{ op_id: string; applied_at: string }>(client, "SELECT * FROM applied_ops ORDER BY position");
  const configRow = (await client.query<{ body: string }>("SELECT body FROM config WHERE id = 1")).rows[0];
  const version = (await client.query<{ value: string }>("SELECT value FROM meta WHERE key = 'seedVersion'")).rows[0];
  return {
    seedVersion: Number(version?.value ?? createSeed().seedVersion),
    users,
    facilities,
    beds,
    capacity,
    referrals: await body<Referral>("referrals"),
    transports: await body<Transport>("transports"),
    events: await body<AuditEvent>("events"),
    notifications: await body<AppNotification>("notifications"),
    sessions: (await rows<Session & { user_id: string; created_at: string; device_id: string }>(client, "SELECT * FROM sessions ORDER BY position")).map(
      (row) => ({ token: row.token, userId: row.user_id, createdAt: row.created_at, deviceId: row.device_id }),
    ),
    pinGrants: (await rows<PinGrant & { user_id: string; expires_at: string }>(client, "SELECT * FROM pin_grants ORDER BY position")).map((row) => ({
      token: row.token,
      userId: row.user_id,
      purpose: row.purpose,
      expiresAt: row.expires_at,
    })),
    challenges: (
      await rows<OtpChallenge & { user_id: string; expires_at: string; pending_token: string | null }>(
        client,
        "SELECT * FROM challenges ORDER BY position",
      )
    ).map((row) => ({
      id: row.id,
      userId: row.user_id,
      code: row.code,
      expiresAt: row.expires_at,
      pendingToken: row.pending_token ?? undefined,
    })),
    appliedOps: Object.fromEntries(applied.map((row) => [row.op_id, row.applied_at])),
    config: configRow ? (JSON.parse(configRow.body) as SystemConfig) : createSeed().config,
  };
}

async function persist(client: PoolClient, data: Database) {
  await client.query(`
    DELETE FROM users;
    DELETE FROM facilities;
    DELETE FROM beds;
    DELETE FROM capacity;
    DELETE FROM referrals;
    DELETE FROM transports;
    DELETE FROM events;
    DELETE FROM notifications;
    DELETE FROM sessions;
    DELETE FROM pin_grants;
    DELETE FROM challenges;
    DELETE FROM applied_ops;
    DELETE FROM config;
  `);
  for (const [position, row] of data.users.entries()) {
    await client.query(
      `INSERT INTO users (id, position, name, role, subrole, registration_number, facility_id, phone, email, pin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, position, row.name, row.role, row.subrole, row.registrationNumber, row.facilityId, row.phone, row.email, row.pin],
    );
  }
  for (const [position, row] of data.facilities.entries()) {
    await client.query(
      `INSERT INTO facilities (id, position, name, short_name, type, region, lat, lng, capabilities, phone, participating)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.id, position, row.name, row.shortName, row.type, row.region, row.lat, row.lng, JSON.stringify(row.capabilities), row.phone, row.participating ? 1 : 0],
    );
  }
  for (const [position, row] of data.beds.entries()) {
    await client.query(
      `INSERT INTO beds (id, position, facility_id, label, kind, status, lock_json) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.id, position, row.facilityId, row.label, row.kind, row.status, row.lock ? JSON.stringify(row.lock) : null],
    );
  }
  for (const [position, row] of data.capacity.entries()) {
    await client.query(
      `INSERT INTO capacity (facility_id, position, oxygen_available, blood_units, theatre_available, notes, updated_by, updated_by_name, updated_at, prediction_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.facilityId,
        position,
        row.oxygenAvailable ? 1 : 0,
        row.bloodUnits,
        row.theatreAvailable ? 1 : 0,
        row.notes,
        row.updatedBy,
        row.updatedByName,
        row.updatedAt,
        row.predictionNote ?? null,
      ],
    );
  }
  const documents: Array<[string, { id: string }[]]> = [
    ["referrals", data.referrals],
    ["transports", data.transports],
    ["events", data.events],
    ["notifications", data.notifications],
  ];
  for (const [table, records] of documents) {
    for (const [position, row] of records.entries()) {
      await client.query(`INSERT INTO ${table} (id, position, body) VALUES ($1,$2,$3)`, [row.id, position, JSON.stringify(row)]);
    }
  }
  for (const [position, row] of data.sessions.entries()) {
    await client.query(`INSERT INTO sessions (token, position, user_id, created_at, device_id) VALUES ($1,$2,$3,$4,$5)`, [
      row.token,
      position,
      row.userId,
      row.createdAt,
      row.deviceId,
    ]);
  }
  for (const [position, row] of data.pinGrants.entries()) {
    await client.query(`INSERT INTO pin_grants (token, position, user_id, purpose, expires_at) VALUES ($1,$2,$3,$4,$5)`, [
      row.token,
      position,
      row.userId,
      row.purpose,
      row.expiresAt,
    ]);
  }
  for (const [position, row] of data.challenges.entries()) {
    await client.query(
      `INSERT INTO challenges (id, position, user_id, code, expires_at, pending_token) VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.id, position, row.userId, row.code, row.expiresAt, row.pendingToken ?? null],
    );
  }
  for (const [position, [opId, appliedAt]] of Object.entries(data.appliedOps).entries()) {
    await client.query(`INSERT INTO applied_ops (op_id, position, applied_at) VALUES ($1,$2,$3)`, [opId, position, appliedAt]);
  }
  await client.query(`INSERT INTO config (id, body) VALUES (1, $1)`, [JSON.stringify(data.config)]);
  await client.query(
    `INSERT INTO meta (key, value) VALUES ('seedVersion', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(data.seedVersion)],
  );
}

async function ensureSchema(client: PoolClient) {
  await client.query(SCHEMA);
}

async function load(client: PoolClient): Promise<Database> {
  await ensureSchema(client);
  const version = (await client.query<{ value: string }>("SELECT value FROM meta WHERE key = 'seedVersion'")).rows[0];
  const expected = createSeed().seedVersion;
  if (!version || Number(version.value) !== expected) {
    const fresh = createSeed();
    await persist(client, fresh);
    return fresh;
  }
  return readAll(client);
}

async function session<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await connection().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [482913]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const slot = bucket();
  const run = slot.chain.then(work);
  slot.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function readDb(): Promise<Database> {
  return enqueue(() => session(async (client) => structuredClone(await load(client))));
}

export function mutate<T>(fn: (db: Database) => T): Promise<T> {
  return enqueue(async () => {
    const result = await session(async (client) => {
      const db = await load(client);
      const before = JSON.stringify(db);
      processTimers(db);
      const value = fn(db);
      if (JSON.stringify(db) !== before) await persist(client, db);
      return value;
    });
    for (const event of drainWs()) publish(event);
    return result;
  });
}

export function resetDatabase() {
  return enqueue(() =>
    session(async (client) => {
      await ensureSchema(client);
      const db = createSeed();
      await persist(client, db);
      return db;
    }),
  );
}
