/** Shared domain model and API shapes. Simulated data only. */

export const REFERRAL_STATUSES = [
  "PREPARING",
  "BROADCASTING",
  "AWAITING_ACCEPTANCE",
  "ACCEPTED",
  "TRANSPORT_ASSIGNED",
  "EN_ROUTE",
  "ARRIVED",
  "COMPLETED",
  "CANCELLED",
  "ESCALATED",
] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const DELIVERY_STATES = [
  "draft",
  "queued",
  "sent",
  "delivered",
  "failed",
  "partial",
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const CATEGORIES = [
  "obstetric",
  "trauma",
  "icu",
  "blood",
  "respiratory",
  "cardiac",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Role = "clinic" | "hospital" | "transport" | "admin";

export type Subrole =
  | "nurse"
  | "clinical_officer"
  | "doctor"
  | "triage_officer"
  | "hospital_admin"
  | "driver"
  | "emt"
  | "dispatcher"
  | "super_admin";

export type FacilityType = "clinic" | "hospital" | "dispatch" | "admin";

export type Capability =
  | "ed"
  | "maternity"
  | "theatre"
  | "icu"
  | "oxygen"
  | "blood_bank";

export type BedKind = "bay" | "bed" | "maternity" | "icu" | "theatre";

export type BedStatus = "available" | "locked" | "occupied" | "out_of_service";

export type Sex = "female" | "male" | "other" | "unknown";

export type Avpu = "A" | "V" | "P" | "U";

export type BroadcastMode = "single" | "parallel";

export type ConnectivityMode = "online" | "degraded" | "gateway_failure" | "offline";

export type OfferStatus = "pending" | "accepted" | "declined" | "expired" | "withdrawn";

export type Channel = "realtime" | "simulated_sms";

export type TransportStatus =
  | "requested"
  | "accepted"
  | "at_clinic"
  | "onboard"
  | "en_route"
  | "arrived";

export type VitalContext = "pre_transfer" | "en_route" | "receiving";

export type PrepKey = "team" | "blood" | "theatre" | "oxygen";

export interface ActorStamp {
  id: string;
  name: string;
  role: Role | "system";
  subrole: string;
  registrationNumber: string;
  facilityId: string;
  facilityName: string;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  subrole: Subrole;
  registrationNumber: string;
  facilityId: string;
  phone: string;
  email: string;
  /** Simulated demo PIN. Production would store a hash. */
  pin: string;
}

export interface PublicUser {
  id: string;
  name: string;
  role: Role;
  subrole: Subrole;
  registrationNumber: string;
  facilityId: string;
  phone: string;
  email: string;
}

export interface Facility {
  id: string;
  name: string;
  shortName: string;
  type: FacilityType;
  region: string;
  lat: number;
  lng: number;
  capabilities: Capability[];
  phone: string;
  participating: boolean;
}

export interface BedLock {
  id: string;
  referralId: string;
  lockedBy: string;
  lockedAt: string;
  expiresAt: string;
  warned: boolean;
}

export interface Bed {
  id: string;
  facilityId: string;
  label: string;
  kind: BedKind;
  status: BedStatus;
  lock?: BedLock;
}

export interface CapacityRecord {
  facilityId: string;
  oxygenAvailable: boolean;
  bloodUnits: number;
  theatreAvailable: boolean;
  notes: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
  /** Optional illustrated prediction. Never used for routing. */
  predictionNote?: string;
}

export interface Patient {
  hospitalNumber: string;
  age: number;
  ageUnit: "years" | "months";
  sex: Sex;
  name?: string;
}

export interface Vital {
  id: string;
  systolic?: number;
  diastolic?: number;
  pulse?: number;
  spo2?: number;
  avpu?: Avpu;
  note?: string;
  context: VitalContext;
  deviceTime: string;
  serverTime: string;
  recordedBy: ActorStamp;
}

export interface OfferDelivery {
  channel: Channel;
  state: "queued" | "sent" | "delivered" | "failed";
  queuedAt: string;
  sentAt?: string;
  deliveredAt?: string;
  /** Always false. The gateway is simulated. */
  realMessageSent: false;
  detail: string;
}

export interface Offer {
  id: string;
  facilityId: string;
  status: OfferStatus;
  distanceKm: number;
  etaMin: number;
  sentAt: string;
  expiresAt: string;
  declineReason?: string;
  delivery: OfferDelivery;
}

export interface PrepItem {
  key: PrepKey;
  label: string;
  required: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: ActorStamp;
}

export interface Referral {
  id: string;
  status: ReferralStatus;
  delivery: DeliveryState;
  category: Category;
  originFacilityId: string;
  destinationFacilityId?: string;
  patient: Patient;
  diagnosis: string;
  notes: string;
  allergies: string;
  interventions: string[];
  vitals: Vital[];
  offers: Offer[];
  bedId?: string;
  transportId?: string;
  prep: PrepItem[];
  broadcastMode?: BroadcastMode;
  broadcastFault?: "none" | "degraded" | "gateway_failure";
  acceptanceDeadline?: string;
  escalationDeadline?: string;
  arrivedAt?: string;
  handoverAt?: string;
  handoverBy?: ActorStamp;
  doorToBedSeconds?: number;
  referralToAcceptanceSeconds?: number;
  rerouteCount: number;
  cancelReason?: string;
  escalationReason?: string;
  bedReleaseReason?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  demoHold?: "incoming";
}

export interface Transport {
  id: string;
  referralId: string;
  originFacilityId: string;
  destinationFacilityId: string;
  crewUserId?: string;
  status: TransportStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  etaMin: number;
  note?: string;
}

export type AuditType =
  | "LOGIN"
  | "LOGOUT"
  | "PIN_STEP_UP"
  | "REFERRAL_CREATED"
  | "REFERRAL_UPDATED"
  | "BROADCAST_QUEUED"
  | "BROADCAST_SENT"
  | "BROADCAST_DELIVERED"
  | "BROADCAST_FAILED"
  | "DETAIL_VIEWED"
  | "OFFER_ACCEPTED"
  | "OFFER_DECLINED"
  | "OFFER_EXPIRED"
  | "OFFER_WITHDRAWN"
  | "BED_LOCKED"
  | "BED_RELEASE_WARNING"
  | "BED_RELEASED"
  | "TRANSPORT_CREATED"
  | "TRANSPORT_STATUS"
  | "PREP_ACK"
  | "VITALS_RECORDED"
  | "ARRIVAL_CONFIRMED"
  | "HANDOVER_CONFIRMED"
  | "CANCELLED"
  | "ESCALATED"
  | "REROUTED"
  | "CAPACITY_UPDATED"
  | "USER_CREATED"
  | "FACILITY_UPDATED";

export interface AuditEvent {
  id: string;
  referralId?: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  registrationNumber: string;
  facilityId: string;
  facilityName: string;
  deviceId: string;
  deviceLabel: string;
  type: AuditType;
  previousStatus?: ReferralStatus | null;
  newStatus?: ReferralStatus | null;
  deviceTime: string;
  serverTime: string;
  reason?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface AppNotification {
  id: string;
  referralId?: string;
  facilityId?: string;
  userId?: string;
  title: string;
  body: string;
  channel: Channel | "in_app";
  state: "queued" | "sent" | "delivered" | "failed";
  createdAt: string;
  read: boolean;
  realMessageSent: false;
}

export interface SystemConfig {
  acceptanceWindowSeconds: number;
  escalationWindowSeconds: number;
  safetyTimeoutMinutes: number;
  safetyWarningMinutes: number;
  capacityFreshMinutes: number;
  defaultBroadcastMode: BroadcastMode;
  parallelOfferLimit: number;
  seedVersion: number;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  deviceId: string;
}

export interface PinGrant {
  token: string;
  userId: string;
  purpose: "login" | "step_up";
  expiresAt: string;
}

export interface OtpChallenge {
  id: string;
  userId: string;
  code: string;
  expiresAt: string;
  pendingToken?: string;
}

export interface SyncOperation {
  opId: string;
  kind: "upsert" | "broadcast" | "vitals" | "cancel";
  referralId: string;
  body: Record<string, unknown>;
  deviceTime: string;
}

export interface Database {
  seedVersion: number;
  users: User[];
  facilities: Facility[];
  beds: Bed[];
  capacity: CapacityRecord[];
  referrals: Referral[];
  transports: Transport[];
  events: AuditEvent[];
  notifications: AppNotification[];
  sessions: Session[];
  pinGrants: PinGrant[];
  challenges: OtpChallenge[];
  appliedOps: Record<string, string>;
  config: SystemConfig;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface RankedFacility {
  facilityId: string;
  name: string;
  eligible: boolean;
  reasons: string[];
  distanceKm: number;
  etaMin: number;
  score: number;
  capacityStale: boolean;
  availableBeds: number;
}

export interface TransportSummary {
  category: Category;
  age: number;
  ageUnit: "years" | "months";
  sex: Sex;
  avpu?: Avpu;
  spo2?: number;
  pulse?: number;
  systolic?: number;
  diastolic?: number;
  allergies: string;
  diagnosis: string;
  originName: string;
  destinationName: string;
  referralStatus: ReferralStatus;
}

export interface TransportView extends Transport {
  summary: TransportSummary;
}

export const WS_EVENT_TYPES = [
  "referral.updated",
  "notification.updated",
  "capacity.updated",
  "transport.updated",
  "audit.appended",
] as const;

export type WsEventType = (typeof WS_EVENT_TYPES)[number];

/** Production WebSocket payload. The prototype delivers the same shape over SSE. */
export interface WsEvent {
  id: string;
  type: WsEventType;
  serverTime: string;
  referralId?: string;
  facilityIds: string[];
  status?: ReferralStatus;
}
