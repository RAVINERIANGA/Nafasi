import { listenerCount } from "@/server/realtime/hub";
import { startOtp, logout, submitPin, verifyOtp } from "@/server/core/auth";
import { mutate, readDb, resetDatabase } from "@/server/core/store";
import {
  acceptReferral,
  acknowledgePrep,
  addVitals,
  analytics,
  applySync,
  broadcastReferral,
  cancelReferral,
  confirmHandover,
  createFacility,
  createTransport,
  createUser,
  declineReferral,
  directory,
  escalateReferral,
  getCapacity,
  getReferral,
  listAudit,
  listNotifications,
  listReferrals,
  listTransports,
  markNotification,
  previewRouting,
  recordView,
  releaseBed,
  requireUser,
  sessionUser,
  updateCapacity,
  updateConfig,
  updateFacility,
  updateTransport,
  upsertReferral,
} from "@/server/core/workflow";
import type { ConnectivityMode } from "@/domain/types";
import { ApiError, type RequestContext } from "@/server/http/context";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function contextOf(req: Request): RequestContext {
  const header = req.headers;
  const connectivity = header.get("x-connectivity") ?? "online";
  const allowed: ConnectivityMode[] = ["online", "degraded", "gateway_failure", "offline"];
  return {
    deviceId: header.get("x-device-id") || "browser",
    deviceLabel: header.get("x-device-label") || "Browser",
    deviceTime: header.get("x-device-time") || new Date().toISOString(),
    connectivity: allowed.includes(connectivity as ConnectivityMode) ? (connectivity as ConnectivityMode) : "online",
    token: header.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined,
    pinToken: header.get("x-pin-token") || undefined,
  };
}

async function readBody(req: Request) {
  if (req.method === "GET") return {};
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "INVALID", "The request body is not valid JSON.");
  }
}

export async function handle(method: string, parts: string[], req: Request) {
  try {
    const ctx = contextOf(req);
    const path = parts.join("/");
    const url = new URL(req.url);

    if (method === "GET" && path === "health") {
      const db = await readDb();
      return json({
        ok: true,
        simulated: true,
        now: new Date().toISOString(),
        referrals: db.referrals.length,
        sseClients: listenerCount(),
      });
    }

    if (method === "POST" && path === "demo/reset") {
      await resetDatabase();
      return json({ ok: true, note: "Demo data restored. No real records were touched." });
    }

    if (method === "POST" && path === "auth/otp") {
      const body = await readBody(req);
      return json(await mutate((db) => startOtp(db, ctx, body)));
    }
    if (method === "POST" && path === "auth/verify") {
      const body = await readBody(req);
      return json(await mutate((db) => verifyOtp(db, body)));
    }
    if (method === "POST" && path === "auth/pin") {
      const body = await readBody(req);
      return json(await mutate((db) => submitPin(db, ctx, body)));
    }
    if (method === "POST" && path === "session/logout") {
      return json(await mutate((db) => logout(db, ctx)));
    }
    if (method === "GET" && path === "session") {
      const data = await mutate((db) => {
        const user = sessionUser(db, ctx.token);
        if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Sign in to continue.");
        return directory(db, user);
      });
      return json(data);
    }

    const body = method === "GET" ? {} : await readBody(req);
    const data = await mutate((db) => {
      const user = requireUser(db, ctx);

      if (method === "GET" && path === "referrals") return listReferrals(db, user);
      if (method === "POST" && path === "referrals") return upsertReferral(db, user, ctx, body);
      if (method === "GET" && parts[0] === "referrals" && parts.length === 2) return getReferral(db, user, parts[1]);
      if (method === "GET" && parts[0] === "referrals" && parts[2] === "routing") {
        return previewRouting(db, user, parts[1], url.searchParams.get("mode") === "parallel" ? "parallel" : "single");
      }
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "cancel") return cancelReferral(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "vitals") return addVitals(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "broadcast") return broadcastReferral(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "accept") return acceptReferral(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "decline") return declineReferral(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "release-bed") return releaseBed(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "handover") return confirmHandover(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "prep") return acknowledgePrep(db, user, ctx, parts[1], body);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "view") return recordView(db, user, ctx, parts[1]);
      if (method === "POST" && parts[0] === "referrals" && parts[2] === "escalate") return escalateReferral(db, user, ctx, parts[1], body);

      if (method === "GET" && path === "facilities") return db.facilities;
      if (method === "POST" && path === "facilities") return createFacility(db, user, ctx, body);
      if (method === "PATCH" && parts[0] === "facilities" && parts.length === 2) return updateFacility(db, user, ctx, parts[1], body);
      if (method === "GET" && parts[0] === "facilities" && parts[2] === "capacity" && parts.length === 3) return getCapacity(db, user, parts[1]);
      if (method === "PUT" && parts[0] === "facilities" && parts[2] === "capacity") return updateCapacity(db, user, ctx, parts[1], body);
      if (method === "GET" && path === "beds") {
        const facilityId = url.searchParams.get("facility_id") ?? user.facilityId;
        if (user.role === "clinic" || (user.role === "hospital" && facilityId !== user.facilityId) || (user.role === "transport")) {
          throw new ApiError(403, "FORBIDDEN", "Bed detail is limited to the holding hospital and admin.");
        }
        return db.beds.filter((bed) => bed.facilityId === facilityId);
      }

      if (method === "GET" && path === "transports") return listTransports(db, user);
      if (method === "POST" && path === "transports") return createTransport(db, user, ctx, body);
      if (method === "PATCH" && parts[0] === "transports" && parts[2] === "status") return updateTransport(db, user, ctx, parts[1], body);

      if (method === "POST" && path === "sync/referrals") {
        const operations = Array.isArray(body.operations) ? (body.operations as Record<string, unknown>[]) : [];
        return applySync(db, user, ctx, operations);
      }

      if (method === "GET" && path === "audit") return listAudit(db, user, url.searchParams.get("referral_id") ?? undefined);
      if (method === "GET" && path === "analytics") {
        if (user.role !== "admin" && user.role !== "hospital") throw new ApiError(403, "FORBIDDEN", "Analytics are limited to hospital and admin accounts.");
        return analytics(db);
      }
      if (method === "GET" && path === "notifications") return listNotifications(db, user);
      if (method === "POST" && parts[0] === "notifications" && parts[2] === "read") return markNotification(db, user, parts[1]);
      if (method === "GET" && path === "users") {
        if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "User management is limited to the super admin.");
        return directory(db, user).users;
      }
      if (method === "POST" && path === "users") return createUser(db, user, ctx, body);
      if (method === "GET" && path === "config") return db.config;
      if (method === "PUT" && path === "config") return updateConfig(db, user, ctx, body);

      throw new ApiError(404, "NOT_FOUND", "That API path is not in the simulated contract.");
    });

    return json(data);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
    console.error(error);
    return json({ error: { code: "SERVER", message: "The simulated server could not complete that action." } }, 500);
  }
}
