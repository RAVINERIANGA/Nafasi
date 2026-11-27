import { SUBROLE_LABEL } from "@/domain/labels";
import type { ActorStamp, AuditEvent, AuditType, Database, ReferralStatus, User } from "@/domain/types";
import type { RequestContext } from "@/server/http/context";

export function actorFrom(user: User, db: Database): ActorStamp {
  const facility = db.facilities.find((item) => item.id === user.facilityId);
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    subrole: SUBROLE_LABEL[user.subrole],
    registrationNumber: user.registrationNumber,
    facilityId: user.facilityId,
    facilityName: facility?.name ?? "Unknown facility",
  };
}

export function systemActor(facilityId: string, facilityName: string): ActorStamp {
  return {
    id: "system",
    name: "NAFASI timer",
    role: "system",
    subrole: "Timer",
    registrationNumber: "—",
    facilityId,
    facilityName,
  };
}

export function appendEvent(
  db: Database,
  input: {
    type: AuditType;
    referralId?: string;
    actor: ActorStamp;
    ctx?: RequestContext;
    previousStatus?: ReferralStatus | null;
    newStatus?: ReferralStatus | null;
    reason?: string;
    meta?: AuditEvent["meta"];
    deviceTime?: string;
  },
): AuditEvent {
  const event: AuditEvent = {
    id: `evt_${crypto.randomUUID()}`,
    referralId: input.referralId,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorRole: input.actor.role === "system" ? "system" : `${input.actor.role}:${input.actor.subrole}`,
    registrationNumber: input.actor.registrationNumber,
    facilityId: input.actor.facilityId,
    facilityName: input.actor.facilityName,
    deviceId: input.ctx?.deviceId ?? "server",
    deviceLabel: input.ctx?.deviceLabel ?? "Simulated server",
    type: input.type,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    deviceTime: input.deviceTime ?? input.ctx?.deviceTime ?? new Date().toISOString(),
    serverTime: new Date().toISOString(),
    reason: input.reason,
    meta: input.meta,
  };
  db.events.push(event);
  return event;
}
