import { CATEGORY_LABEL, SUBROLE_LABEL } from "@/domain/labels";
import type {
  ActorStamp,
  AppNotification,
  AuditEvent,
  Avpu,
  Bed,
  BroadcastMode,
  Category,
  Database,
  Facility,
  Offer,
  PrepItem,
  Referral,
  ReferralStatus,
  Transport,
  TransportStatus,
  TransportView,
  User,
  Vital,
  VitalContext,
  WsEvent,
} from "@/domain/types";
import { actorFrom, appendEvent, systemActor } from "@/server/core/audit";
import { rankFacilities } from "@/server/core/routing";
import { ApiError, type RequestContext } from "@/server/http/context";
import { queueWs } from "@/server/realtime/hub";

const ACTIVE: ReferralStatus[] = [
  "PREPARING",
  "BROADCASTING",
  "AWAITING_ACCEPTANCE",
  "ACCEPTED",
  "TRANSPORT_ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "ESCALATED",
];

const g = globalThis as typeof globalThis & { __nafasiArmed?: Set<string> };

function armed(id: string) {
  if (!g.__nafasiArmed) g.__nafasiArmed = new Set();
  if (g.__nafasiArmed.has(id)) return false;
  g.__nafasiArmed.add(id);
  return true;
}

function fid() {
  return crypto.randomUUID();
}

function facilityName(db: Database, id?: string) {
  return db.facilities.find((item) => item.id === id)?.name ?? "Unknown facility";
}

function touch(referral: Referral, status?: ReferralStatus) {
  referral.updatedAt = new Date().toISOString();
  if (status) referral.status = status;
  queueWs({
    id: `ws_${fid()}`,
    type: "referral.updated",
    serverTime: referral.updatedAt,
    referralId: referral.id,
    facilityIds: involvedFacilities(referral),
    status: referral.status,
  });
}

function involvedFacilities(referral: Referral) {
  return [
    referral.originFacilityId,
    referral.destinationFacilityId,
    ...referral.offers.map((offer) => offer.facilityId),
  ].filter((id): id is string => Boolean(id));
}

function notify(
  db: Database,
  input: Omit<AppNotification, "id" | "createdAt" | "read" | "realMessageSent">,
) {
  const item: AppNotification = {
    ...input,
    id: `ntf_${fid()}`,
    createdAt: new Date().toISOString(),
    read: false,
    realMessageSent: false,
  };
  db.notifications.unshift(item);
  queueWs({
    id: `ws_${fid()}`,
    type: "notification.updated",
    serverTime: item.createdAt,
    referralId: item.referralId,
    facilityIds: [item.facilityId, input.userId ? undefined : item.facilityId].filter(
      (id): id is string => Boolean(id),
    ),
  });
  return item;
}

function mustReferral(db: Database, id: string) {
  const referral = db.referrals.find((item) => item.id === id);
  if (!referral) throw new ApiError(404, "NOT_FOUND", "Referral not found.");
  return referral;
}

function assertPin(db: Database, user: User, ctx: RequestContext) {
  const grant = db.pinGrants.find((item) => item.token === ctx.pinToken && item.userId === user.id);
  if (!grant || grant.purpose !== "step_up" || new Date(grant.expiresAt).getTime() < Date.now()) {
    throw new ApiError(401, "PIN_REQUIRED", "Enter your PIN to confirm this action.");
  }
}

export function requireUser(db: Database, ctx: RequestContext) {
  const session = db.sessions.find((item) => item.token === ctx.token);
  if (!session) throw new ApiError(401, "AUTH_REQUIRED", "Sign in to continue.");
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) throw new ApiError(401, "AUTH_REQUIRED", "Sign in to continue.");
  return user;
}

function isDispatcher(user: User) {
  return user.role === "transport" && user.subrole === "dispatcher";
}

export function canAccess(db: Database, user: User, referral: Referral) {
  if (user.role === "admin") return true;
  if (user.role === "clinic") return referral.originFacilityId === user.facilityId;
  if (user.role === "hospital") {
    return (
      referral.destinationFacilityId === user.facilityId ||
      referral.offers.some((offer) => offer.facilityId === user.facilityId)
    );
  }
  const transport = db.transports.find((item) => item.id === referral.transportId);
  if (!transport) return false;
  return isDispatcher(user) || !transport.crewUserId || transport.crewUserId === user.id;
}

function assertAccess(db: Database, user: User, referral: Referral) {
  if (!canAccess(db, user, referral)) {
    throw new ApiError(403, "FORBIDDEN", "Your account cannot open this referral.");
  }
}

function publicUser(user: User) {
  const { pin: _pin, ...rest } = user;
  return rest;
}

export function presentReferral(db: Database, user: User, referral: Referral) {
  const clone = structuredClone(referral);
  if (user.role === "transport") {
    clone.patient = {
      ...clone.patient,
      name: undefined,
      hospitalNumber: "Hidden",
    };
    clone.notes = "";
  }
  return {
    ...clone,
    originName: facilityName(db, clone.originFacilityId),
    destinationName: clone.destinationFacilityId ? facilityName(db, clone.destinationFacilityId) : undefined,
    timeline: timelineFor(db, user, clone.id),
  };
}

function timelineFor(db: Database, user: User, referralId: string) {
  return db.events
    .filter((event) => event.referralId === referralId)
    .filter((event) => (user.role === "transport" ? event.type !== "DETAIL_VIEWED" || event.meta?.scope === "transport_minimum" : true))
    .map((event) => {
      if (user.role !== "transport") return event;
      const copy = { ...event, meta: event.meta ? { ...event.meta } : undefined };
      if (copy.meta) {
        delete copy.meta.patientName;
        delete copy.meta.hospitalNumber;
      }
      return copy;
    });
}

function prepFor(category: Category): PrepItem[] {
  return [
    { key: "team", label: "Receiving team called", required: true },
    {
      key: "blood",
      label: "Blood confirmed",
      required: category === "obstetric" || category === "trauma" || category === "blood",
    },
    {
      key: "theatre",
      label: "Theatre aware",
      required: category === "obstetric" || category === "trauma",
    },
    {
      key: "oxygen",
      label: "Oxygen ready",
      required: category === "icu" || category === "respiratory" || category === "cardiac" || category === "trauma",
    },
  ];
}

function aggregateDelivery(referral: Referral) {
  const states = referral.offers
    .filter((offer) => offer.status === "pending" || offer.status === "accepted")
    .map((offer) => offer.delivery.state);
  if (!states.length) return;
  if (states.every((state) => state === "failed")) referral.delivery = "failed";
  else if (states.every((state) => state === "delivered")) referral.delivery = "delivered";
  else if (states.some((state) => state === "delivered") && states.some((state) => state !== "delivered")) {
    referral.delivery = "partial";
  } else if (states.every((state) => state === "sent" || state === "delivered")) referral.delivery = "sent";
  else referral.delivery = "queued";
}

function offerChannel(referral: Referral, index: number): Offer["delivery"]["channel"] {
  if (referral.broadcastFault === "degraded" && index > 0) return "simulated_sms";
  return "realtime";
}

function addOffers(
  db: Database,
  referral: Referral,
  facilityIds: string[],
  distances: Map<string, { distanceKm: number; etaMin: number }>,
  actor: ActorStamp,
  ctx: RequestContext | undefined,
  reason?: string,
) {
  const now = new Date();
  const expires = new Date(now.getTime() + db.config.acceptanceWindowSeconds * 1000).toISOString();
  referral.acceptanceDeadline = expires;
  facilityIds.forEach((facilityId, index) => {
    const place = distances.get(facilityId);
    const channel = offerChannel(referral, index);
    const offer: Offer = {
      id: `off_${fid()}`,
      facilityId,
      status: "pending",
      distanceKm: place?.distanceKm ?? 0,
      etaMin: place?.etaMin ?? 0,
      sentAt: now.toISOString(),
      expiresAt: expires,
      delivery: {
        channel,
        state: "queued",
        queuedAt: now.toISOString(),
        realMessageSent: false,
        detail:
          channel === "simulated_sms"
            ? "Simulated SMS fallback. No real SMS was sent."
            : "Queued on the simulated realtime channel.",
      },
    };
    referral.offers.push(offer);
    notify(db, {
      referralId: referral.id,
      facilityId,
      channel,
      state: "queued",
      title: `Incoming ${CATEGORY_LABEL[referral.category]} referral`,
      body: `${facilityName(db, referral.originFacilityId)} is requesting a bed. This is a simulated alert.`,
    });
  });
  const previous = referral.status;
  referral.status = "BROADCASTING";
  referral.delivery = "queued";
  touch(referral);
  appendEvent(db, {
    type: "BROADCAST_QUEUED",
    referralId: referral.id,
    actor,
    ctx,
    previousStatus: previous,
    newStatus: referral.status,
    reason,
    meta: { offers: facilityIds.length, fault: referral.broadcastFault ?? "none" },
  });
  notify(db, {
    referralId: referral.id,
    facilityId: referral.originFacilityId,
    channel: "in_app",
    state: "delivered",
    title: "Referral queued",
    body: "The simulated server has the broadcast. It is not shown as sent until the gateway acknowledges it.",
  });
}

function escalate(db: Database, referral: Referral, actor: ActorStamp, ctx: RequestContext | undefined, reason: string) {
  const previous = referral.status;
  for (const offer of referral.offers) {
    if (offer.status === "pending") offer.status = "withdrawn";
  }
  referral.status = "ESCALATED";
  referral.escalationReason = reason;
  referral.demoHold = undefined;
  touch(referral);
  appendEvent(db, {
    type: "ESCALATED",
    referralId: referral.id,
    actor,
    ctx,
    previousStatus: previous,
    newStatus: "ESCALATED",
    reason,
  });
  const dispatch = db.facilities.find((item) => item.type === "dispatch");
  const regional = db.facilities.find((item) => item.type === "admin");
  for (const facilityId of [referral.originFacilityId, dispatch?.id, regional?.id]) {
    if (!facilityId) continue;
    notify(db, {
      referralId: referral.id,
      facilityId,
      channel: "in_app",
      state: "delivered",
      title: "Referral escalated",
      body: `${reason} Escalation ownership is an unresolved operational decision.`,
    });
  }
}

function reroute(db: Database, referral: Referral, actor: ActorStamp, ctx: RequestContext | undefined, reason: string) {
  if (referral.offers.some((offer) => offer.status === "pending" || offer.status === "accepted")) return;
  if (referral.transportId) return;
  const origin = db.facilities.find((item) => item.id === referral.originFacilityId);
  if (!origin) return;
  const ranked = rankFacilities({
    origin,
    facilities: db.facilities,
    beds: db.beds,
    capacity: db.capacity,
    category: referral.category,
    config: db.config,
    now: Date.now(),
  });
  const excluded = new Set(
    referral.offers.filter((offer) => offer.status === "declined" || offer.status === "expired").map((offer) => offer.facilityId),
  );
  const next = ranked.filter((item) => item.eligible && !excluded.has(item.facilityId));
  referral.rerouteCount += 1;
  referral.destinationFacilityId = undefined;
  referral.bedId = undefined;
  appendEvent(db, {
    type: "REROUTED",
    referralId: referral.id,
    actor,
    ctx,
    previousStatus: referral.status,
    newStatus: next.length ? "BROADCASTING" : "ESCALATED",
    reason,
  });
  notify(db, {
    referralId: referral.id,
    facilityId: referral.originFacilityId,
    channel: "in_app",
    state: "delivered",
    title: "Referral rerouted",
    body: reason,
  });
  if (!next.length) {
    escalate(db, referral, actor, ctx, "No further facility accepted the referral.");
    return;
  }
  const limit = referral.broadcastMode === "parallel" ? db.config.parallelOfferLimit : 1;
  const chosen = next.slice(0, limit);
  const distances = new Map(chosen.map((item) => [item.facilityId, item]));
  addOffers(
    db,
    referral,
    chosen.map((item) => item.facilityId),
    distances,
    actor,
    ctx,
    reason,
  );
}

function releaseBedRecord(db: Database, referral: Referral, actor: ActorStamp, ctx: RequestContext | undefined, reason: string) {
  const bed = db.beds.find((item) => item.id === referral.bedId);
  if (bed && bed.lock?.referralId === referral.id) {
    bed.status = "available";
    bed.lock = undefined;
  }
  referral.bedId = undefined;
  referral.bedReleaseReason = reason;
  appendEvent(db, {
    type: "BED_RELEASED",
    referralId: referral.id,
    actor,
    ctx,
    previousStatus: referral.status,
    newStatus: referral.status,
    reason,
  });
}

function advanceDeliveries(db: Database, now: number) {
  for (const referral of db.referrals) {
    let changed = false;
    for (const offer of referral.offers) {
      if (offer.status === "withdrawn" || offer.status === "declined") continue;
      const queuedAt = new Date(offer.delivery.queuedAt).getTime();
      const sentAt = offer.delivery.sentAt ? new Date(offer.delivery.sentAt).getTime() : 0;
      const sms = offer.delivery.channel === "simulated_sms";
      const fail = referral.broadcastFault === "gateway_failure";
      if (offer.delivery.state === "queued" && fail && now - queuedAt > 800) {
        offer.delivery.state = "failed";
        offer.delivery.detail = "Simulated gateway failure. No message was sent.";
        changed = true;
        appendEvent(db, {
          type: "BROADCAST_FAILED",
          referralId: referral.id,
          actor: systemActor(offer.facilityId, facilityName(db, offer.facilityId)),
          previousStatus: referral.status,
          newStatus: referral.status,
          reason: "Simulated gateway failure",
          meta: { facilityId: offer.facilityId },
        });
      } else if (offer.delivery.state === "queued" && now - queuedAt > (sms ? 1800 : 700)) {
        offer.delivery.state = "sent";
        offer.delivery.sentAt = new Date(now).toISOString();
        offer.delivery.detail = sms
          ? "Simulated SMS gateway acknowledged the message. No real SMS was sent."
          : "Simulated server acknowledged the offer.";
        changed = true;
        appendEvent(db, {
          type: "BROADCAST_SENT",
          referralId: referral.id,
          actor: systemActor(offer.facilityId, facilityName(db, offer.facilityId)),
          previousStatus: referral.status,
          newStatus: referral.status,
          meta: { facilityId: offer.facilityId, channel: offer.delivery.channel },
        });
      } else if (offer.delivery.state === "sent" && sentAt && now - sentAt > (sms ? 2200 : 800)) {
        offer.delivery.state = "delivered";
        offer.delivery.deliveredAt = new Date(now).toISOString();
        offer.delivery.detail = sms
          ? "Simulated SMS marked delivered. No real SMS was sent."
          : "Simulated hospital channel received the offer.";
        changed = true;
        appendEvent(db, {
          type: "BROADCAST_DELIVERED",
          referralId: referral.id,
          actor: systemActor(offer.facilityId, facilityName(db, offer.facilityId)),
          previousStatus: referral.status,
          newStatus: referral.status === "BROADCASTING" ? "AWAITING_ACCEPTANCE" : referral.status,
          meta: { facilityId: offer.facilityId, channel: offer.delivery.channel },
        });
        const hospitalNote = db.notifications.find(
          (item) => item.referralId === referral.id && item.facilityId === offer.facilityId && item.state === "queued",
        );
        if (hospitalNote) {
          hospitalNote.state = "delivered";
        }
      }
    }
    if (!referral.offers.length) continue;
    const before = referral.delivery;
    aggregateDelivery(referral);
    const pendingDelivery = referral.offers.some((offer) => offer.delivery.state === "queued" || offer.delivery.state === "sent");
    if (referral.status === "BROADCASTING" && !pendingDelivery && referral.delivery === "delivered") {
      referral.status = "AWAITING_ACCEPTANCE";
      changed = true;
    }
    if (referral.status === "BROADCASTING" && referral.delivery === "failed") {
      const actor = systemActor(referral.originFacilityId, facilityName(db, referral.originFacilityId));
      notify(db, {
        referralId: referral.id,
        facilityId: referral.originFacilityId,
        channel: "in_app",
        state: "delivered",
        title: "Broadcast failed",
        body: "The simulated gateway did not acknowledge the referral. It was not sent. Retry when you are ready.",
      });
      appendEvent(db, {
        type: "BROADCAST_FAILED",
        referralId: referral.id,
        actor,
        previousStatus: "BROADCASTING",
        newStatus: "PREPARING",
        reason: "Simulated gateway failure",
      });
      referral.status = "PREPARING";
      changed = true;
    }
    if (changed || before !== referral.delivery) touch(referral);
  }
}

function expireOffers(db: Database, now: number) {
  for (const referral of db.referrals) {
    if (referral.status !== "AWAITING_ACCEPTANCE" && referral.status !== "BROADCASTING") continue;
    let expired = false;
    for (const offer of referral.offers) {
      if (offer.status === "pending" && new Date(offer.expiresAt).getTime() <= now && offer.delivery.state === "delivered") {
        offer.status = "expired";
        expired = true;
        appendEvent(db, {
          type: "OFFER_EXPIRED",
          referralId: referral.id,
          actor: systemActor(offer.facilityId, facilityName(db, offer.facilityId)),
          previousStatus: referral.status,
          newStatus: referral.status,
          reason: "Acceptance window elapsed",
          meta: { facilityId: offer.facilityId },
        });
        notify(db, {
          referralId: referral.id,
          facilityId: referral.originFacilityId,
          channel: "in_app",
          state: "delivered",
          title: "Offer expired",
          body: `${facilityName(db, offer.facilityId)} did not accept in time. The referral details stay intact.`,
        });
      }
    }
    if (!expired) continue;
    if (referral.offers.some((offer) => offer.status === "pending")) {
      touch(referral);
      continue;
    }
    reroute(
      db,
      referral,
      systemActor(referral.originFacilityId, facilityName(db, referral.originFacilityId)),
      undefined,
      "Acceptance window elapsed",
    );
  }
}

function safetySweep(db: Database, now: number) {
  const warnLead = db.config.safetyWarningMinutes * 60_000;
  for (const bed of db.beds) {
    if (bed.status !== "locked" || !bed.lock) continue;
    const referral = db.referrals.find((item) => item.id === bed.lock?.referralId);
    if (!referral) continue;
    const expires = new Date(bed.lock.expiresAt).getTime();
    const actor = systemActor(bed.facilityId, facilityName(db, bed.facilityId));
    if (!bed.lock.warned && now >= expires - warnLead) {
      bed.lock.warned = true;
      appendEvent(db, {
        type: "BED_RELEASE_WARNING",
        referralId: referral.id,
        actor,
        previousStatus: referral.status,
        newStatus: referral.status,
        reason: "Safety hold is nearing its limit",
      });
      notify(db, {
        referralId: referral.id,
        facilityId: referral.originFacilityId,
        channel: "in_app",
        state: "delivered",
        title: "Bed hold will be released",
        body: `${facilityName(db, bed.facilityId)} will release ${bed.label} if arrival is not confirmed. A reservation is not a guarantee of clinical suitability.`,
      });
      touch(referral);
    }
    if (now < expires) continue;
    const reason = "Safety timeout released the bed reservation";
    releaseBedRecord(db, referral, actor, undefined, reason);
    notify(db, {
      referralId: referral.id,
      facilityId: referral.originFacilityId,
      channel: "in_app",
      state: "delivered",
      title: "Bed reservation released",
      body: reason,
    });
    notify(db, {
      referralId: referral.id,
      facilityId: bed.facilityId,
      channel: "in_app",
      state: "delivered",
      title: "Bed reservation released",
      body: `${bed.label} is free again after the safety timeout.`,
    });
    if (!referral.transportId && ["ACCEPTED", "TRANSPORT_ASSIGNED"].includes(referral.status)) {
      const accepted = referral.offers.find((offer) => offer.status === "accepted");
      if (accepted) accepted.status = "expired";
      reroute(db, referral, actor, undefined, reason);
    } else {
      touch(referral);
    }
  }
}

function escalationSweep(db: Database, now: number) {
  for (const referral of db.referrals) {
    if (!referral.escalationDeadline) continue;
    if (referral.status !== "AWAITING_ACCEPTANCE" && referral.status !== "BROADCASTING") continue;
    if (new Date(referral.escalationDeadline).getTime() > now) continue;
    escalate(
      db,
      referral,
      systemActor(referral.originFacilityId, facilityName(db, referral.originFacilityId)),
      undefined,
      "No facility accepted within the escalation window",
    );
  }
}

function armDemo(db: Database) {
  const now = Date.now();
  for (const referral of db.referrals) {
    if (referral.demoHold !== "incoming") continue;
    if (!armed(referral.id)) continue;
    const expires = new Date(now + db.config.acceptanceWindowSeconds * 1000).toISOString();
    referral.acceptanceDeadline = expires;
    referral.escalationDeadline = new Date(now + 15 * 60_000).toISOString();
    for (const offer of referral.offers) {
      if (offer.status !== "pending") continue;
      offer.expiresAt = expires;
      offer.delivery.state = "delivered";
      offer.delivery.sentAt = offer.delivery.sentAt ?? new Date(now).toISOString();
      offer.delivery.deliveredAt = offer.delivery.deliveredAt ?? new Date(now).toISOString();
    }
    referral.delivery = "delivered";
    if (referral.status === "BROADCASTING") referral.status = "AWAITING_ACCEPTANCE";
  }
}

export function processTimers(db: Database) {
  armDemo(db);
  const now = Date.now();
  advanceDeliveries(db, now);
  expireOffers(db, now);
  escalationSweep(db, now);
  safetySweep(db, now);
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function optionalNumber(value: unknown, min: number, max: number, label: string) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ApiError(400, "INVALID", `${label} must be between ${min} and ${max}.`);
  }
  return Math.round(number);
}

export function upsertReferral(db: Database, user: User, ctx: RequestContext, body: Record<string, unknown>) {
  if (user.role !== "clinic") throw new ApiError(403, "FORBIDDEN", "Only a clinic account can draft a referral.");
  const id = cleanText(body.id, 80);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
    throw new ApiError(400, "INVALID", "A client referral id is required.");
  }
  const existing = db.referrals.find((item) => item.id === id);
  if (existing) {
    if (existing.originFacilityId !== user.facilityId) throw new ApiError(403, "FORBIDDEN", "This draft belongs to another facility.");
    if (existing.status !== "PREPARING") return presentReferral(db, user, existing);
  }
  const patient = (body.patient ?? {}) as Record<string, unknown>;
  const category = cleanText(body.category, 40) as Category;
  const categories = ["obstetric", "trauma", "icu", "blood", "respiratory", "cardiac", "other"];
  if (!categories.includes(category)) throw new ApiError(400, "INVALID", "Choose a referral category.");
  const sex = cleanText(patient.sex, 20);
  if (!["female", "male", "other", "unknown"].includes(sex)) throw new ApiError(400, "INVALID", "Record sex.");
  const age = optionalNumber(patient.age, 0, 120, "Age");
  if (age == null) throw new ApiError(400, "INVALID", "Record age.");
  const hospitalNumber = cleanText(patient.hospitalNumber, 32);
  if (hospitalNumber.length < 2) throw new ApiError(400, "INVALID", "Record the hospital number used at your facility.");
  const diagnosis = cleanText(body.diagnosis, 180);
  if (diagnosis.length < 2) throw new ApiError(400, "INVALID", "Record the suspected diagnosis.");
  const now = new Date().toISOString();
  const referral: Referral = existing ?? {
    id,
    status: "PREPARING",
    delivery: "draft",
    category,
    originFacilityId: user.facilityId,
    patient: {
      hospitalNumber,
      age,
      ageUnit: patient.ageUnit === "months" ? "months" : "years",
      sex: sex as Referral["patient"]["sex"],
      name: cleanText(patient.name, 80) || undefined,
    },
    diagnosis,
    notes: cleanText(body.notes, 500),
    allergies: cleanText(body.allergies, 180) || "None known",
    interventions: Array.isArray(body.interventions) ? body.interventions.map((item) => cleanText(item, 40)).filter(Boolean).slice(0, 12) : [],
    vitals: [],
    offers: [],
    prep: [],
    rerouteCount: 0,
    createdAt: now,
    createdBy: user.id,
    updatedAt: now,
  };
  referral.category = category;
  referral.patient = {
    hospitalNumber,
    age,
    ageUnit: patient.ageUnit === "months" ? "months" : "years",
    sex: sex as Referral["patient"]["sex"],
    name: cleanText(patient.name, 80) || undefined,
  };
  referral.diagnosis = diagnosis;
  referral.notes = cleanText(body.notes, 500);
  referral.allergies = cleanText(body.allergies, 180) || "None known";
  referral.interventions = Array.isArray(body.interventions)
    ? body.interventions.map((item) => cleanText(item, 40)).filter(Boolean).slice(0, 12)
    : [];
  if (Array.isArray(body.vitals)) {
    const kept: Vital[] = [];
    for (const raw of body.vitals.slice(0, 12)) {
      const row = raw as Record<string, unknown>;
      const existingVital = referral.vitals.find((item) => item.id === row.id);
      if (existingVital) {
        kept.push(existingVital);
        continue;
      }
      const systolic = optionalNumber(row.systolic, 40, 260, "Systolic blood pressure");
      const diastolic = optionalNumber(row.diastolic, 20, 180, "Diastolic blood pressure");
      const pulse = optionalNumber(row.pulse, 20, 260, "Pulse");
      const spo2 = optionalNumber(row.spo2, 40, 100, "SpO₂");
      const avpu = cleanText(row.avpu, 1).toUpperCase();
      if (!systolic && !diastolic && !pulse && !spo2 && !avpu) continue;
      kept.push({
        id: `vit_${fid()}`,
        systolic,
        diastolic,
        pulse,
        spo2,
        avpu: (avpu || undefined) as Avpu | undefined,
        note: cleanText(row.note, 160) || undefined,
        context: "pre_transfer",
        deviceTime: ctx.deviceTime,
        serverTime: now,
        recordedBy: actorFrom(user, db),
      });
    }
    if (kept.length) referral.vitals = kept;
  }
  referral.updatedAt = now;
  if (!existing) {
    db.referrals.unshift(referral);
    appendEvent(db, {
      type: "REFERRAL_CREATED",
      referralId: referral.id,
      actor: actorFrom(user, db),
      ctx,
      previousStatus: null,
      newStatus: "PREPARING",
    });
  } else {
    appendEvent(db, {
      type: "REFERRAL_UPDATED",
      referralId: referral.id,
      actor: actorFrom(user, db),
      ctx,
      previousStatus: "PREPARING",
      newStatus: "PREPARING",
    });
  }
  touch(referral);
  return presentReferral(db, user, referral);
}

export function broadcastReferral(
  db: Database,
  user: User,
  ctx: RequestContext,
  id: string,
  body: Record<string, unknown>,
) {
  if (user.role !== "clinic") throw new ApiError(403, "FORBIDDEN", "Only the referring clinic can broadcast.");
  assertPin(db, user, ctx);
  const referral = mustReferral(db, id);
  assertAccess(db, user, referral);
  if (referral.status !== "PREPARING" && referral.status !== "ESCALATED") {
    throw new ApiError(409, "INVALID_STATE", "This referral can no longer be broadcast.");
  }
  const mode: BroadcastMode = body.mode === "parallel" ? "parallel" : "single";
  const origin = db.facilities.find((item) => item.id === referral.originFacilityId);
  if (!origin) throw new ApiError(400, "INVALID", "Originating facility is missing.");
  if (!referral.vitals.length) throw new ApiError(400, "INVALID", "Record at least one set of vitals before broadcasting.");
  referral.broadcastMode = mode;
  referral.broadcastFault =
    ctx.connectivity === "degraded" || ctx.connectivity === "gateway_failure" ? ctx.connectivity : "none";
  if (referral.status === "ESCALATED") {
    referral.escalationDeadline = undefined;
    referral.escalationReason = undefined;
  }
  referral.escalationDeadline = new Date(Date.now() + db.config.escalationWindowSeconds * 1000).toISOString();
  const ranked = rankFacilities({
    origin,
    facilities: db.facilities,
    beds: db.beds,
    capacity: db.capacity,
    category: referral.category,
    config: db.config,
    now: Date.now(),
  });
  const eligible = ranked.filter((item) => item.eligible);
  const limit = mode === "parallel" ? db.config.parallelOfferLimit : 1;
  const chosen = eligible.slice(0, limit);
  if (!chosen.length) {
    escalate(db, referral, actorFrom(user, db), ctx, "No eligible facility with verified capacity");
    return { referral: presentReferral(db, user, referral), ranked };
  }
  addOffers(
    db,
    referral,
    chosen.map((item) => item.facilityId),
    new Map(chosen.map((item) => [item.facilityId, item])),
    actorFrom(user, db),
    ctx,
  );
  return { referral: presentReferral(db, user, referral), ranked };
}

export function previewRouting(db: Database, user: User, id: string, mode: BroadcastMode) {
  const referral = mustReferral(db, id);
  assertAccess(db, user, referral);
  const origin = db.facilities.find((item) => item.id === referral.originFacilityId);
  if (!origin) throw new ApiError(400, "INVALID", "Originating facility is missing.");
  const ranked = rankFacilities({
    origin,
    facilities: db.facilities,
    beds: db.beds,
    capacity: db.capacity,
    category: referral.category,
    config: db.config,
    now: Date.now(),
  });
  const limit = mode === "parallel" ? db.config.parallelOfferLimit : 1;
  return {
    mode,
    ranked,
    selected: ranked.filter((item) => item.eligible).slice(0, limit).map((item) => item.facilityId),
    note: "Final destinations are chosen when the server accepts the broadcast. Predictions are not used.",
  };
}

export function addVitals(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  const referral = mustReferral(db, id);
  assertAccess(db, user, referral);
  if (user.role === "admin") throw new ApiError(403, "FORBIDDEN", "Admin accounts do not record vitals.");
  if (["COMPLETED", "CANCELLED"].includes(referral.status)) {
    throw new ApiError(409, "INVALID_STATE", "This referral is closed.");
  }
  const systolic = optionalNumber(body.systolic, 40, 260, "Systolic blood pressure");
  const diastolic = optionalNumber(body.diastolic, 20, 180, "Diastolic blood pressure");
  const pulse = optionalNumber(body.pulse, 20, 260, "Pulse");
  const spo2 = optionalNumber(body.spo2, 40, 100, "SpO₂");
  const avpu = cleanText(body.avpu, 1).toUpperCase();
  if (!systolic && !diastolic && !pulse && !spo2 && !avpu) {
    throw new ApiError(400, "INVALID", "Record at least one vital sign.");
  }
  if (avpu && !["A", "V", "P", "U"].includes(avpu)) throw new ApiError(400, "INVALID", "AVPU must be A, V, P, or U.");
  const context: VitalContext =
    user.role === "transport" ? "en_route" : user.role === "hospital" ? "receiving" : referral.status === "EN_ROUTE" ? "en_route" : "pre_transfer";
  const vital: Vital = {
    id: `vit_${fid()}`,
    systolic,
    diastolic,
    pulse,
    spo2,
    avpu: (avpu || undefined) as Avpu | undefined,
    note: cleanText(body.note, 160) || undefined,
    context,
    deviceTime: ctx.deviceTime,
    serverTime: new Date().toISOString(),
    recordedBy: actorFrom(user, db),
  };
  referral.vitals.push(vital);
  touch(referral);
  appendEvent(db, {
    type: "VITALS_RECORDED",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: referral.status,
    newStatus: referral.status,
    meta: { context },
  });
  if (referral.destinationFacilityId && context === "en_route") {
    notify(db, {
      referralId: referral.id,
      facilityId: referral.destinationFacilityId,
      channel: "in_app",
      state: "delivered",
      title: "En-route vitals",
      body: "The crew recorded a new set of vitals.",
    });
  }
  return presentReferral(db, user, referral);
}

export function cancelReferral(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "clinic") throw new ApiError(403, "FORBIDDEN", "Only the referring clinic can cancel.");
  assertPin(db, user, ctx);
  const referral = mustReferral(db, id);
  assertAccess(db, user, referral);
  if (["COMPLETED", "CANCELLED", "ARRIVED"].includes(referral.status)) {
    throw new ApiError(409, "INVALID_STATE", "This referral can no longer be cancelled.");
  }
  const reason = cleanText(body.reason, 180);
  if (reason.length < 3) throw new ApiError(400, "INVALID", "A cancellation reason is required.");
  const previous = referral.status;
  if (referral.bedId) releaseBedRecord(db, referral, actorFrom(user, db), ctx, `Clinic cancelled: ${reason}`);
  for (const offer of referral.offers) {
    if (offer.status === "pending") offer.status = "withdrawn";
  }
  referral.status = "CANCELLED";
  referral.cancelReason = reason;
  referral.demoHold = undefined;
  touch(referral);
  appendEvent(db, {
    type: "CANCELLED",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: previous,
    newStatus: "CANCELLED",
    reason,
  });
  const targets = new Set<string>([referral.destinationFacilityId ?? "", ...referral.offers.map((offer) => offer.facilityId)]);
  for (const facilityId of targets) {
    if (!facilityId) continue;
    notify(db, {
      referralId: referral.id,
      facilityId,
      channel: "in_app",
      state: "delivered",
      title: "Referral cancelled",
      body: `${facilityName(db, referral.originFacilityId)} cancelled the referral. ${reason}`,
    });
  }
  return presentReferral(db, user, referral);
}

export function acceptReferral(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "hospital") throw new ApiError(403, "FORBIDDEN", "Only the receiving hospital can accept.");
  assertPin(db, user, ctx);
  const referral = mustReferral(db, id);
  const offer = referral.offers.find((item) => item.facilityId === user.facilityId && item.status === "pending");
  if (!offer) throw new ApiError(409, "INVALID_STATE", "There is no open offer for your facility.");
  if (offer.delivery.state !== "delivered") {
    throw new ApiError(409, "NOT_DELIVERED", "The offer is not marked delivered yet.");
  }
  if (new Date(offer.expiresAt).getTime() <= Date.now()) {
    offer.status = "expired";
    appendEvent(db, {
      type: "OFFER_EXPIRED",
      referralId: referral.id,
      actor: actorFrom(user, db),
      ctx,
      previousStatus: referral.status,
      newStatus: referral.status,
      reason: "Acceptance window elapsed",
    });
    reroute(db, referral, systemActor(user.facilityId, facilityName(db, user.facilityId)), ctx, "Acceptance window elapsed");
    throw new ApiError(409, "OFFER_EXPIRED", "The acceptance window closed. The offer was released.");
  }
  const bedId = cleanText(body.bedId, 80);
  const bed = db.beds.find((item) => item.id === bedId && item.facilityId === user.facilityId);
  if (!bed || bed.status !== "available") {
    throw new ApiError(409, "BED_UNAVAILABLE", "That bed is no longer free. Choose another.");
  }
  const previous = referral.status;
  const now = new Date();
  bed.status = "locked";
  bed.lock = {
    id: `lock_${fid()}`,
    referralId: referral.id,
    lockedBy: user.id,
    lockedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + db.config.safetyTimeoutMinutes * 60_000).toISOString(),
    warned: false,
  };
  offer.status = "accepted";
  for (const other of referral.offers) {
    if (other.id !== offer.id && other.status === "pending") {
      other.status = "withdrawn";
      appendEvent(db, {
        type: "OFFER_WITHDRAWN",
        referralId: referral.id,
        actor: actorFrom(user, db),
        ctx,
        previousStatus: previous,
        newStatus: "ACCEPTED",
        reason: "Another facility accepted first",
        meta: { facilityId: other.facilityId },
      });
      notify(db, {
        referralId: referral.id,
        facilityId: other.facilityId,
        channel: "in_app",
        state: "delivered",
        title: "Offer withdrawn",
        body: "Another hospital accepted this referral.",
      });
    }
  }
  referral.destinationFacilityId = user.facilityId;
  referral.bedId = bed.id;
  referral.prep = prepFor(referral.category);
  referral.status = "ACCEPTED";
  referral.demoHold = undefined;
  const started = db.events.find((event) => event.referralId === referral.id && event.type === "BROADCAST_QUEUED");
  if (started) {
    referral.referralToAcceptanceSeconds = Math.max(
      0,
      Math.round((now.getTime() - new Date(started.serverTime).getTime()) / 1000),
    );
  }
  touch(referral);
  appendEvent(db, {
    type: "OFFER_ACCEPTED",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: previous,
    newStatus: "ACCEPTED",
    meta: { bed: bed.label, facilityId: user.facilityId },
  });
  appendEvent(db, {
    type: "BED_LOCKED",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: "ACCEPTED",
    newStatus: "ACCEPTED",
    meta: { bed: bed.label },
  });
  notify(db, {
    referralId: referral.id,
    facilityId: referral.originFacilityId,
    channel: "in_app",
    state: "delivered",
    title: "Hospital accepted",
    body: `${facilityName(db, user.facilityId)} reserved ${bed.label}. This does not replace triage on arrival.`,
  });
  return presentReferral(db, user, referral);
}

export function declineReferral(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "hospital") throw new ApiError(403, "FORBIDDEN", "Only the receiving hospital can decline.");
  assertPin(db, user, ctx);
  const referral = mustReferral(db, id);
  const offer = referral.offers.find((item) => item.facilityId === user.facilityId && item.status === "pending");
  if (!offer) throw new ApiError(409, "INVALID_STATE", "There is no open offer for your facility.");
  const reason = cleanText(body.reason, 180);
  if (reason.length < 3) throw new ApiError(400, "INVALID", "A decline reason is required.");
  const previous = referral.status;
  offer.status = "declined";
  offer.declineReason = reason;
  appendEvent(db, {
    type: "OFFER_DECLINED",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: previous,
    newStatus: previous,
    reason,
    meta: { facilityId: user.facilityId },
  });
  notify(db, {
    referralId: referral.id,
    facilityId: referral.originFacilityId,
    channel: "in_app",
    state: "delivered",
    title: "Hospital declined",
    body: `${facilityName(db, user.facilityId)} declined: ${reason}`,
  });
  if (!referral.offers.some((item) => item.status === "pending")) {
    reroute(db, referral, actorFrom(user, db), ctx, `${facilityName(db, user.facilityId)} declined: ${reason}`);
  } else {
    touch(referral);
  }
  return presentReferral(db, user, referral);
}

export function releaseBed(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "hospital") throw new ApiError(403, "FORBIDDEN", "Only the receiving hospital can release a bed.");
  assertPin(db, user, ctx);
  const referral = mustReferral(db, id);
  if (referral.destinationFacilityId !== user.facilityId) {
    throw new ApiError(403, "FORBIDDEN", "Only the hospital holding the bed can release it.");
  }
  const reason = cleanText(body.reason, 180);
  if (reason.length < 3) throw new ApiError(400, "INVALID", "A release reason is required.");
  if (!referral.bedId) throw new ApiError(409, "INVALID_STATE", "No bed is reserved.");
  releaseBedRecord(db, referral, actorFrom(user, db), ctx, reason);
  notify(db, {
    referralId: referral.id,
    facilityId: referral.originFacilityId,
    channel: "in_app",
    state: "delivered",
    title: "Bed released",
    body: `${facilityName(db, user.facilityId)} released the reservation. ${reason}`,
  });
  if (reason === "Patient will not arrive") {
    const previous = referral.status;
    referral.status = "CANCELLED";
    referral.cancelReason = reason;
    touch(referral);
    appendEvent(db, {
      type: "CANCELLED",
      referralId: referral.id,
      actor: actorFrom(user, db),
      ctx,
      previousStatus: previous,
      newStatus: "CANCELLED",
      reason,
    });
    return presentReferral(db, user, referral);
  }
  if (!referral.transportId) {
    const accepted = referral.offers.find((offer) => offer.status === "accepted" && offer.facilityId === user.facilityId);
    if (accepted) accepted.status = "declined";
    if (accepted) accepted.declineReason = reason;
    referral.destinationFacilityId = undefined;
    reroute(db, referral, actorFrom(user, db), ctx, reason);
  } else {
    touch(referral);
  }
  return presentReferral(db, user, referral);
}

export function acknowledgePrep(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "hospital") throw new ApiError(403, "FORBIDDEN", "Only the receiving team can acknowledge preparation.");
  const referral = mustReferral(db, id);
  if (referral.destinationFacilityId !== user.facilityId) throw new ApiError(403, "FORBIDDEN", "This referral is not coming to your facility.");
  const key = cleanText(body.key, 20);
  const item = referral.prep.find((prep) => prep.key === key);
  if (!item) throw new ApiError(404, "NOT_FOUND", "Preparation item not found.");
  if (item.acknowledgedAt) return presentReferral(db, user, referral);
  item.acknowledgedAt = new Date().toISOString();
  item.acknowledgedBy = actorFrom(user, db);
  touch(referral);
  appendEvent(db, {
    type: "PREP_ACK",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: referral.status,
    newStatus: referral.status,
    meta: { item: item.label },
  });
  return presentReferral(db, user, referral);
}

export function confirmHandover(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "hospital") throw new ApiError(403, "FORBIDDEN", "Only the receiving clinician can confirm handover.");
  assertPin(db, user, ctx);
  const referral = mustReferral(db, id);
  if (referral.destinationFacilityId !== user.facilityId) throw new ApiError(403, "FORBIDDEN", "This patient is not assigned to your facility.");
  if (referral.status !== "ARRIVED") throw new ApiError(409, "INVALID_STATE", "Confirm handover after the crew records arrival.");
  const bedId = cleanText(body.bedId, 80) || referral.bedId || "";
  const bed = db.beds.find((item) => item.id === bedId && item.facilityId === user.facilityId);
  if (!bed) throw new ApiError(400, "INVALID", "Choose the bed used for handover.");
  if (bed.status === "locked" && bed.lock?.referralId !== referral.id) {
    throw new ApiError(409, "BED_UNAVAILABLE", "That bed is reserved for someone else.");
  }
  if (bed.status === "occupied" && referral.bedId !== bed.id) {
    throw new ApiError(409, "BED_UNAVAILABLE", "That bed is already occupied.");
  }
  bed.status = "occupied";
  bed.lock = undefined;
  referral.bedId = bed.id;
  referral.handoverAt = new Date().toISOString();
  referral.handoverBy = actorFrom(user, db);
  if (referral.arrivedAt) {
    referral.doorToBedSeconds = Math.max(
      0,
      Math.round((new Date(referral.handoverAt).getTime() - new Date(referral.arrivedAt).getTime()) / 1000),
    );
  }
  const previous = referral.status;
  referral.status = "COMPLETED";
  touch(referral);
  appendEvent(db, {
    type: "HANDOVER_CONFIRMED",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: previous,
    newStatus: "COMPLETED",
    meta: { bed: bed.label },
  });
  notify(db, {
    referralId: referral.id,
    facilityId: referral.originFacilityId,
    channel: "in_app",
    state: "delivered",
    title: "Handover complete",
    body: `${user.name} confirmed handover to ${bed.label}.`,
  });
  return presentReferral(db, user, referral);
}

export function recordView(db: Database, user: User, ctx: RequestContext, id: string) {
  const referral = mustReferral(db, id);
  assertAccess(db, user, referral);
  const recent = db.events.find((event) => {
    if (event.type !== "DETAIL_VIEWED" || event.referralId !== id || event.actorId !== user.id) return false;
    if (event.deviceId !== ctx.deviceId) return false;
    return Date.now() - new Date(event.serverTime).getTime() < 15_000;
  });
  if (!recent) {
    appendEvent(db, {
      type: "DETAIL_VIEWED",
      referralId: id,
      actor: actorFrom(user, db),
      ctx,
      previousStatus: referral.status,
      newStatus: referral.status,
      meta: {
        scope: user.role === "transport" ? "transport_minimum" : "clinical",
        patientName: user.role === "transport" ? null : referral.patient.name ?? null,
        hospitalNumber: user.role === "transport" ? null : referral.patient.hospitalNumber,
      },
    });
  }
  return presentReferral(db, user, referral);
}

export function escalateReferral(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "clinic" && user.role !== "admin") {
    throw new ApiError(403, "FORBIDDEN", "Only the clinic or a regional admin can escalate.");
  }
  assertPin(db, user, ctx);
  const referral = mustReferral(db, id);
  if (user.role === "clinic") assertAccess(db, user, referral);
  if (!["AWAITING_ACCEPTANCE", "BROADCASTING", "PREPARING"].includes(referral.status)) {
    throw new ApiError(409, "INVALID_STATE", "This referral is already past escalation.");
  }
  const reason = cleanText(body.reason, 180) || "Clinic requested regional dispatch support";
  escalate(db, referral, actorFrom(user, db), ctx, reason);
  return presentReferral(db, user, referral);
}

const TRANSPORT_ORDER: TransportStatus[] = ["requested", "accepted", "at_clinic", "onboard", "en_route", "arrived"];

export function createTransport(db: Database, user: User, ctx: RequestContext, body: Record<string, unknown>) {
  const allowed =
    user.role === "clinic" ||
    user.role === "hospital" ||
    (user.role === "transport" && isDispatcher(user));
  if (!allowed) throw new ApiError(403, "FORBIDDEN", "You cannot create a transport for this account.");
  const referral = mustReferral(db, cleanText(body.referralId, 80));
  if (user.role !== "transport") assertAccess(db, user, referral);
  if (!referral.destinationFacilityId || !referral.bedId || !["ACCEPTED", "TRANSPORT_ASSIGNED"].includes(referral.status)) {
    throw new ApiError(409, "INVALID_STATE", "Assign transport only after a hospital and bed are accepted.");
  }
  const existing = db.transports.find((item) => item.referralId === referral.id);
  if (existing) return presentTransport(db, user, existing);
  const destination = referral.destinationFacilityId;
  const offer = referral.offers.find((item) => item.facilityId === destination && item.status === "accepted");
  const now = new Date().toISOString();
  const transport: Transport = {
    id: `trn_${fid()}`,
    referralId: referral.id,
    originFacilityId: referral.originFacilityId,
    destinationFacilityId: destination,
    status: "requested",
    createdAt: now,
    createdBy: user.id,
    updatedAt: now,
    etaMin: offer?.etaMin ?? 20,
  };
  db.transports.unshift(transport);
  referral.transportId = transport.id;
  const previous = referral.status;
  referral.status = "TRANSPORT_ASSIGNED";
  touch(referral);
  queueWs({
    id: `ws_${fid()}`,
    type: "transport.updated",
    serverTime: now,
    referralId: referral.id,
    facilityIds: [referral.originFacilityId, destination],
    status: referral.status,
  });
  appendEvent(db, {
    type: "TRANSPORT_CREATED",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: previous,
    newStatus: "TRANSPORT_ASSIGNED",
    meta: { destination: facilityName(db, destination) },
  });
  notify(db, {
    referralId: referral.id,
    facilityId: db.facilities.find((item) => item.type === "dispatch")?.id,
    channel: "in_app",
    state: "delivered",
    title: "Transport requested",
    body: `Destination is fixed: ${facilityName(db, destination)}.`,
  });
  return presentTransport(db, user, transport);
}

export function updateTransport(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "transport" && user.role !== "hospital") {
    throw new ApiError(403, "FORBIDDEN", "Crew or the receiving hospital confirm these steps.");
  }
  const transport = db.transports.find((item) => item.id === id);
  if (!transport) throw new ApiError(404, "NOT_FOUND", "Transport not found.");
  if (user.role === "transport" && !isDispatcher(user) && transport.crewUserId && transport.crewUserId !== user.id) {
    throw new ApiError(403, "FORBIDDEN", "This assignment belongs to another crew.");
  }
  const referral = mustReferral(db, transport.referralId);
  const next = cleanText(body.status, 40) as TransportStatus;
  if (!TRANSPORT_ORDER.includes(next)) throw new ApiError(400, "INVALID", "Unknown transport status.");
  const currentIndex = TRANSPORT_ORDER.indexOf(transport.status);
  const nextIndex = TRANSPORT_ORDER.indexOf(next);
  if (nextIndex !== currentIndex + 1) {
    throw new ApiError(409, "INVALID_STATE", "Update the transport one step at a time.");
  }
  if (next === "accepted") {
    transport.crewUserId = user.role === "transport" ? user.id : transport.crewUserId;
  }
  if (user.role === "hospital" && next !== "arrived") {
    throw new ApiError(403, "FORBIDDEN", "The hospital confirms arrival only after the crew is on site, or the crew records it.");
  }
  transport.status = next;
  transport.updatedAt = new Date().toISOString();
  transport.note = cleanText(body.note, 180) || transport.note;
  const previous = referral.status;
  if (next === "onboard" || next === "en_route") referral.status = "EN_ROUTE";
  if (next === "arrived") {
    referral.status = "ARRIVED";
    referral.arrivedAt = transport.updatedAt;
  }
  touch(referral);
  appendEvent(db, {
    type: next === "arrived" ? "ARRIVAL_CONFIRMED" : "TRANSPORT_STATUS",
    referralId: referral.id,
    actor: actorFrom(user, db),
    ctx,
    previousStatus: previous,
    newStatus: referral.status,
    meta: { transportStatus: next },
    reason: transport.note,
  });
  if (next === "en_route" || next === "arrived" || next === "onboard") {
    notify(db, {
      referralId: referral.id,
      facilityId: transport.destinationFacilityId,
      channel: "in_app",
      state: "delivered",
      title: next === "arrived" ? "Ambulance arrived" : "Transport update",
      body:
        next === "arrived"
          ? "The crew confirmed arrival. Complete handover to record door-to-bed time."
          : `Transport is now ${next.replaceAll("_", " ")}.`,
    });
  }
  return presentTransport(db, user, transport);
}

export function getCapacity(db: Database, user: User, facilityId: string) {
  if (user.role !== "hospital" && user.role !== "admin") {
    throw new ApiError(403, "FORBIDDEN", "Only a hospital or admin account can read capacity.");
  }
  if (user.role === "hospital" && user.facilityId !== facilityId) {
    throw new ApiError(403, "FORBIDDEN", "You can read capacity only for your own facility.");
  }
  const facility = db.facilities.find((item) => item.id === facilityId && item.type === "hospital");
  if (!facility) throw new ApiError(404, "NOT_FOUND", "Hospital not found.");
  return {
    facility,
    capacity: db.capacity.find((item) => item.facilityId === facilityId) ?? null,
    beds: db.beds.filter((bed) => bed.facilityId === facilityId),
  };
}

export function updateCapacity(db: Database, user: User, ctx: RequestContext, facilityId: string, body: Record<string, unknown>) {
  if (user.role !== "hospital" && user.role !== "admin") {
    throw new ApiError(403, "FORBIDDEN", "Only a hospital or admin account can update capacity.");
  }
  if (user.role === "hospital" && user.facilityId !== facilityId) {
    throw new ApiError(403, "FORBIDDEN", "You can update capacity only for your own facility.");
  }
  const facility = db.facilities.find((item) => item.id === facilityId && item.type === "hospital");
  if (!facility) throw new ApiError(404, "NOT_FOUND", "Hospital not found.");
  let record = db.capacity.find((item) => item.facilityId === facilityId);
  if (!record) {
    record = {
      facilityId,
      oxygenAvailable: true,
      bloodUnits: 0,
      theatreAvailable: false,
      notes: "",
      updatedBy: user.id,
      updatedByName: user.name,
      updatedAt: new Date().toISOString(),
    };
    db.capacity.push(record);
  }
  record.oxygenAvailable = Boolean(body.oxygenAvailable);
  record.bloodUnits = optionalNumber(body.bloodUnits, 0, 200, "Blood units") ?? 0;
  record.theatreAvailable = Boolean(body.theatreAvailable);
  record.notes = cleanText(body.notes, 240);
  record.updatedBy = user.id;
  record.updatedByName = user.name;
  record.updatedAt = new Date().toISOString();
  record.predictionNote = "No prediction model is connected. Routing uses this confirmed record only.";
  const updates = Array.isArray(body.bedUpdates) ? body.bedUpdates : [];
  for (const update of updates) {
    const row = update as Record<string, unknown>;
    const bed = db.beds.find((item) => item.id === cleanText(row.id, 80) && item.facilityId === facilityId);
    if (!bed) continue;
    const status = cleanText(row.status, 40);
    if (!["available", "occupied", "out_of_service"].includes(status)) continue;
    if (bed.status === "locked") {
      throw new ApiError(409, "BED_LOCKED", `${bed.label} is reserved and cannot be edited until the hold is released.`);
    }
    bed.status = status as Bed["status"];
    bed.lock = undefined;
  }
  appendEvent(db, {
    type: "CAPACITY_UPDATED",
    actor: actorFrom(user, db),
    ctx,
    reason: record.notes || undefined,
    meta: { facilityId, bloodUnits: record.bloodUnits },
  });
  queueWs({
    id: `ws_${fid()}`,
    type: "capacity.updated",
    serverTime: record.updatedAt,
    facilityIds: [facilityId],
  });
  return { facility, capacity: record, beds: db.beds.filter((bed) => bed.facilityId === facilityId) };
}

export function listReferrals(db: Database, user: User) {
  return db.referrals.filter((referral) => canAccess(db, user, referral)).map((referral) => presentReferral(db, user, referral));
}

export function getReferral(db: Database, user: User, id: string) {
  const referral = mustReferral(db, id);
  assertAccess(db, user, referral);
  return presentReferral(db, user, referral);
}

function presentTransport(db: Database, user: User, transport: Transport): TransportView {
  const referral = mustReferral(db, transport.referralId);
  if (user.role === "transport" && !isDispatcher(user) && transport.crewUserId && transport.crewUserId !== user.id) {
    throw new ApiError(403, "FORBIDDEN", "This assignment belongs to another crew.");
  }
  if (user.role === "clinic" && referral.originFacilityId !== user.facilityId) {
    throw new ApiError(403, "FORBIDDEN", "This transport is outside your facility.");
  }
  if (user.role === "hospital" && referral.destinationFacilityId !== user.facilityId && referral.originFacilityId !== user.facilityId) {
    throw new ApiError(403, "FORBIDDEN", "This transport is outside your facility.");
  }
  const latest = referral.vitals[referral.vitals.length - 1];
  return {
    ...transport,
    summary: {
      category: referral.category,
      age: referral.patient.age,
      ageUnit: referral.patient.ageUnit,
      sex: referral.patient.sex,
      avpu: latest?.avpu,
      spo2: latest?.spo2,
      pulse: latest?.pulse,
      systolic: latest?.systolic,
      diastolic: latest?.diastolic,
      allergies: referral.allergies,
      diagnosis: referral.diagnosis,
      originName: facilityName(db, transport.originFacilityId),
      destinationName: facilityName(db, transport.destinationFacilityId),
      referralStatus: referral.status,
    },
  };
}

export function listTransports(db: Database, user: User) {
  return db.transports
    .filter((transport) => {
      if (user.role === "admin" || isDispatcher(user)) return true;
      if (user.role === "transport") return !transport.crewUserId || transport.crewUserId === user.id;
      if (user.role === "clinic") return transport.originFacilityId === user.facilityId;
      if (user.role === "hospital") return transport.destinationFacilityId === user.facilityId;
      return false;
    })
    .map((transport) => presentTransport(db, user, transport));
}

export function listNotifications(db: Database, user: User) {
  return db.notifications.filter((item) => item.facilityId === user.facilityId || item.userId === user.id).slice(0, 40);
}

export function markNotification(db: Database, user: User, id: string) {
  const item = db.notifications.find((note) => note.id === id);
  if (!item || (item.facilityId !== user.facilityId && item.userId !== user.id)) {
    throw new ApiError(404, "NOT_FOUND", "Notification not found.");
  }
  item.read = true;
  return item;
}

export function listAudit(db: Database, user: User, referralId?: string) {
  if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Audit review is limited to the super admin.");
  const events = referralId ? db.events.filter((event) => event.referralId === referralId) : db.events;
  return events.slice().reverse();
}

export function analytics(db: Database) {
  const referrals = db.referrals;
  const completed = referrals.filter((item) => item.status === "COMPLETED");
  const acceptances = referrals
    .map((item) => item.referralToAcceptanceSeconds)
    .filter((item): item is number => typeof item === "number");
  const doors = referrals.map((item) => item.doorToBedSeconds).filter((item): item is number => typeof item === "number");
  const avg = (values: number[]) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);
  const byStatus = Object.fromEntries(
    ["PREPARING", "BROADCASTING", "AWAITING_ACCEPTANCE", "ACCEPTED", "TRANSPORT_ASSIGNED", "EN_ROUTE", "ARRIVED", "COMPLETED", "CANCELLED", "ESCALATED"].map(
      (status) => [status, referrals.filter((item) => item.status === status).length],
    ),
  );
  const rerouted = db.events.filter((event) => event.type === "REROUTED").length;
  return {
    simulated: true,
    referrals: referrals.length,
    completed: completed.length,
    rerouted,
    escalated: referrals.filter((item) => item.status === "ESCALATED").length,
    cancelled: referrals.filter((item) => item.status === "CANCELLED").length,
    averageReferralToAcceptanceSeconds: avg(acceptances),
    averageDoorToBedSeconds: avg(doors),
    byStatus,
    byCategory: Object.fromEntries(
      ["obstetric", "trauma", "icu", "blood", "respiratory", "cardiac", "other"].map((category) => [
        category,
        referrals.filter((item) => item.category === category).length,
      ]),
    ),
  };
}

export function applySync(db: Database, user: User, ctx: RequestContext, operations: Record<string, unknown>[]) {
  if (user.role !== "clinic") throw new ApiError(403, "FORBIDDEN", "Offline sync is for clinic drafts.");
  const results = [];
  for (const operation of operations.slice(0, 20)) {
    const opId = cleanText(operation.opId, 80);
    const kind = cleanText(operation.kind, 40);
    const referralId = cleanText(operation.referralId, 80);
    const body = (operation.body ?? {}) as Record<string, unknown>;
    if (!opId) {
      results.push({ opId, status: "error", message: "Missing operation id." });
      continue;
    }
    if (db.appliedOps[opId]) {
      const referral = db.referrals.find((item) => item.id === referralId);
      results.push({ opId, status: "duplicate", referral: referral ? presentReferral(db, user, referral) : undefined });
      continue;
    }
    try {
      let referral;
      if (kind === "upsert") referral = upsertReferral(db, user, ctx, { ...body, id: referralId });
      else if (kind === "broadcast") referral = broadcastReferral(db, user, ctx, referralId, body).referral;
      else if (kind === "vitals") referral = addVitals(db, user, ctx, referralId, body);
      else if (kind === "cancel") referral = cancelReferral(db, user, ctx, referralId, body);
      else throw new ApiError(400, "INVALID", "Unknown sync operation.");
      db.appliedOps[opId] = new Date().toISOString();
      results.push({ opId, status: "applied", referral });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Sync failed.";
      results.push({ opId, status: "error", message });
    }
  }
  return { results };
}

export function createFacility(db: Database, user: User, ctx: RequestContext, body: Record<string, unknown>) {
  if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only a super admin can add facilities.");
  const name = cleanText(body.name, 80);
  if (name.length < 3) throw new ApiError(400, "INVALID", "Facility name is required.");
  const type = cleanText(body.type, 20);
  if (!["clinic", "hospital", "dispatch", "admin"].includes(type)) throw new ApiError(400, "INVALID", "Unknown facility type.");
  const facility: Facility = {
    id: `fac_${fid()}`,
    name,
    shortName: cleanText(body.shortName, 40) || name,
    type: type as Facility["type"],
    region: cleanText(body.region, 40) || "Kaskazi Coast",
    lat: Number(body.lat) || -4.05,
    lng: Number(body.lng) || 39.66,
    capabilities: Array.isArray(body.capabilities) ? (body.capabilities.filter((item) => typeof item === "string") as Facility["capabilities"]) : [],
    phone: cleanText(body.phone, 20),
    participating: body.participating !== false,
  };
  db.facilities.push(facility);
  if (facility.type === "hospital") {
    db.capacity.push({
      facilityId: facility.id,
      oxygenAvailable: facility.capabilities.includes("oxygen"),
      bloodUnits: 0,
      theatreAvailable: facility.capabilities.includes("theatre"),
      notes: "New facility. Capacity not yet confirmed.",
      updatedBy: user.id,
      updatedByName: user.name,
      updatedAt: new Date(0).toISOString(),
      predictionNote: "No prediction model is connected.",
    });
    for (let index = 1; index <= 2; index += 1) {
      db.beds.push({ id: `bed_${fid()}`, facilityId: facility.id, label: `Bay ${index}`, kind: "bay", status: "available" });
    }
  }
  appendEvent(db, {
    type: "FACILITY_UPDATED",
    actor: actorFrom(user, db),
    ctx,
    meta: { facilityId: facility.id, name: facility.name },
  });
  return facility;
}

export function updateFacility(db: Database, user: User, ctx: RequestContext, id: string, body: Record<string, unknown>) {
  if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only a super admin can edit facilities.");
  const facility = db.facilities.find((item) => item.id === id);
  if (!facility) throw new ApiError(404, "NOT_FOUND", "Facility not found.");
  if (typeof body.participating === "boolean") facility.participating = body.participating;
  if (body.name) facility.name = cleanText(body.name, 80);
  appendEvent(db, {
    type: "FACILITY_UPDATED",
    actor: actorFrom(user, db),
    ctx,
    meta: { facilityId: facility.id, participating: facility.participating },
  });
  return facility;
}

export function createUser(db: Database, user: User, ctx: RequestContext, body: Record<string, unknown>) {
  if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only a super admin can add users.");
  const facility = db.facilities.find((item) => item.id === cleanText(body.facilityId, 80));
  if (!facility) throw new ApiError(400, "INVALID", "Choose a facility.");
  const pin = cleanText(body.pin, 8);
  if (!/^\d{4}$/.test(pin)) throw new ApiError(400, "INVALID", "PIN must be 4 digits.");
  const created: User = {
    id: `usr_${fid()}`,
    name: cleanText(body.name, 80),
    role: cleanText(body.role, 20) as User["role"],
    subrole: cleanText(body.subrole, 40) as User["subrole"],
    registrationNumber: cleanText(body.registrationNumber, 40) || "UNVERIFIED",
    facilityId: facility.id,
    phone: cleanText(body.phone, 20),
    email: cleanText(body.email, 80),
    pin,
  };
  if (!created.name || !created.phone) throw new ApiError(400, "INVALID", "Name and phone are required.");
  if (!["clinic", "hospital", "transport", "admin"].includes(created.role)) {
    throw new ApiError(400, "INVALID", "Unknown role.");
  }
  db.users.push(created);
  appendEvent(db, {
    type: "USER_CREATED",
    actor: actorFrom(user, db),
    ctx,
    meta: { userId: created.id, role: created.role },
  });
  return publicUser(created);
}

export function updateConfig(db: Database, user: User, ctx: RequestContext, body: Record<string, unknown>) {
  if (user.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only a super admin can change settings.");
  const next = db.config;
  const windowSeconds = optionalNumber(body.acceptanceWindowSeconds, 20, 600, "Acceptance window");
  const escalation = optionalNumber(body.escalationWindowSeconds, 60, 3600, "Escalation window");
  const safety = optionalNumber(body.safetyTimeoutMinutes, 5, 240, "Safety timeout");
  const warning = optionalNumber(body.safetyWarningMinutes, 1, 60, "Safety warning");
  const fresh = optionalNumber(body.capacityFreshMinutes, 15, 1440, "Capacity freshness");
  if (windowSeconds != null) next.acceptanceWindowSeconds = windowSeconds;
  if (escalation != null) next.escalationWindowSeconds = escalation;
  if (safety != null) next.safetyTimeoutMinutes = safety;
  if (warning != null) next.safetyWarningMinutes = warning;
  if (fresh != null) next.capacityFreshMinutes = fresh;
  if (body.defaultBroadcastMode === "single" || body.defaultBroadcastMode === "parallel") {
    next.defaultBroadcastMode = body.defaultBroadcastMode;
  }
  appendEvent(db, {
    type: "FACILITY_UPDATED",
    actor: actorFrom(user, db),
    ctx,
    reason: "System settings updated",
  });
  return next;
}

export function directory(db: Database, user: User) {
  return {
    user: publicUser(user),
    facility: db.facilities.find((item) => item.id === user.facilityId),
    facilities: db.facilities,
    config: db.config,
    users: user.role === "admin" ? db.users.map(publicUser) : undefined,
  };
}

export function sessionUser(db: Database, token?: string) {
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  return db.users.find((item) => item.id === session.userId) ?? null;
}

export function subroleLabel(user: User) {
  return SUBROLE_LABEL[user.subrole];
}

export type { AuditEvent };
