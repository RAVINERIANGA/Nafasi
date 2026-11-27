import { DEMO_OTP } from "@/domain/demo-data";
import { maskPhone } from "@/domain/format";
import type { Database } from "@/domain/types";
import { actorFrom, appendEvent } from "@/server/core/audit";
import { ApiError, type RequestContext } from "@/server/http/context";
import { directory } from "@/server/core/workflow";

export function startOtp(db: Database, ctx: RequestContext, body: Record<string, unknown>) {
  void ctx;
  const identifier = String(body.identifier ?? "").trim().replace(/\s/g, "").toLowerCase();
  const user = db.users.find((item) => item.phone.replace(/\s/g, "").toLowerCase() === identifier || item.email.toLowerCase() === identifier);
  if (!user) throw new ApiError(404, "UNKNOWN_ACCOUNT", "No simulated account uses that phone or email.");
  const challenge = {
    id: `otp_${crypto.randomUUID()}`,
    userId: user.id,
    code: DEMO_OTP,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  db.challenges.push(challenge);
  return {
    challengeId: challenge.id,
    channel: "simulated_sms" as const,
    maskedTo: maskPhone(user.phone),
    simulatedCode: DEMO_OTP,
    expiresAt: challenge.expiresAt,
    note: "Simulated gateway. No SMS or email was sent.",
    realMessageSent: false as const,
  };
}

export function verifyOtp(db: Database, body: Record<string, unknown>) {
  const challenge = db.challenges.find((item) => item.id === String(body.challengeId ?? ""));
  if (!challenge || new Date(challenge.expiresAt).getTime() < Date.now()) {
    throw new ApiError(400, "CODE_EXPIRED", "Request a new simulated code.");
  }
  if (String(body.code ?? "").trim() !== challenge.code) {
    throw new ApiError(401, "CODE_INVALID", "That code does not match the simulated code.");
  }
  challenge.pendingToken = `pend_${crypto.randomUUID()}`;
  return {
    pendingToken: challenge.pendingToken,
    note: "Identity check passed in the simulation. Enter the PIN to open a session.",
  };
}

export function submitPin(db: Database, ctx: RequestContext, body: Record<string, unknown>) {
  const purpose = body.purpose === "step_up" ? "step_up" : "login";
  if (purpose === "login") {
    const challenge = db.challenges.find((item) => item.pendingToken && item.pendingToken === body.pendingToken);
    if (!challenge) throw new ApiError(401, "AUTH_REQUIRED", "Verify the simulated code first.");
    const user = db.users.find((item) => item.id === challenge.userId);
    if (!user || user.pin !== String(body.pin ?? "")) {
      throw new ApiError(401, "PIN_INVALID", "That PIN does not match this simulated account.");
    }
    const token = `ses_${crypto.randomUUID()}`;
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString(), deviceId: ctx.deviceId });
    appendEvent(db, {
      type: "LOGIN",
      actor: actorFrom(user, db),
      ctx,
      meta: { channel: "simulated_otp" },
    });
    return { token, ...directory(db, user) };
  }
  const session = db.sessions.find((item) => item.token === ctx.token);
  const user = db.users.find((item) => item.id === session?.userId);
  if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Sign in to continue.");
  if (user.pin !== String(body.pin ?? "")) throw new ApiError(401, "PIN_INVALID", "That PIN does not match this simulated account.");
  const token = `pin_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  db.pinGrants.push({ token, userId: user.id, purpose: "step_up" as const, expiresAt });
  appendEvent(db, { type: "PIN_STEP_UP", actor: actorFrom(user, db), ctx });
  return { pinToken: token, expiresAt };
}

export function logout(db: Database, ctx: RequestContext) {
  const session = db.sessions.find((item) => item.token === ctx.token);
  if (!session) return { ok: true };
  const user = db.users.find((item) => item.id === session.userId);
  db.sessions = db.sessions.filter((item) => item.token !== ctx.token);
  if (user) appendEvent(db, { type: "LOGOUT", actor: actorFrom(user, db), ctx });
  return { ok: true };
}
