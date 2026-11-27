import type { Referral, Role, User } from "./types";

export type Action =
  | "create_referral"
  | "broadcast"
  | "cancel"
  | "accept"
  | "decline"
  | "capacity"
  | "create_transport"
  | "update_transport"
  | "handover"
  | "release_bed"
  | "vitals"
  | "prep"
  | "escalate"
  | "audit"
  | "manage_directory"
  | "analytics";

const MATRIX: Record<Role, Action[]> = {
  clinic: ["create_referral", "broadcast", "cancel", "create_transport", "vitals", "escalate"],
  hospital: ["accept", "decline", "capacity", "handover", "release_bed", "vitals", "prep", "create_transport"],
  transport: ["update_transport", "vitals", "create_transport"],
  admin: ["audit", "manage_directory", "analytics", "capacity"],
};

export function can(role: Role, action: Action) {
  return MATRIX[role].includes(action);
}

export function seesPatientName(user: Pick<User, "role">) {
  return user.role === "clinic" || user.role === "hospital" || user.role === "admin";
}

export function homeFor(role: Role) {
  if (role === "clinic") return "/clinic";
  if (role === "hospital") return "/hospital";
  if (role === "transport") return "/transport";
  return "/admin";
}

export function canSeeReferral(user: User, referral: Referral, crewUserId?: string | null, isDispatcher = false) {
  if (user.role === "admin") return true;
  if (user.role === "clinic") return referral.originFacilityId === user.facilityId;
  if (user.role === "hospital") {
    return (
      referral.destinationFacilityId === user.facilityId ||
      referral.offers.some((offer) => offer.facilityId === user.facilityId)
    );
  }
  if (!referral.transportId) return false;
  return isDispatcher || crewUserId == null || crewUserId === user.id;
}
