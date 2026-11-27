import type {
  Avpu,
  BedKind,
  Category,
  DeliveryState,
  ReferralStatus,
  Role,
  Subrole,
  TransportStatus,
} from "./types";

export const STATUS_LABEL: Record<ReferralStatus, string> = {
  PREPARING: "Preparing",
  BROADCASTING: "Broadcasting",
  AWAITING_ACCEPTANCE: "Awaiting acceptance",
  ACCEPTED: "Accepted",
  TRANSPORT_ASSIGNED: "Transport assigned",
  EN_ROUTE: "En route",
  ARRIVED: "Arrived",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  ESCALATED: "Escalated",
};

export const DELIVERY_LABEL: Record<DeliveryState, string> = {
  draft: "Draft",
  queued: "Queued (not sent)",
  sent: "Sent (server acknowledged)",
  delivered: "Delivered (hospital received)",
  failed: "Failed",
  partial: "Partial delivery",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  obstetric: "Obstetric",
  trauma: "Trauma / surgical",
  icu: "ICU / oxygen",
  blood: "Blood",
  respiratory: "Respiratory",
  cardiac: "Cardiac",
  other: "Other",
};

export const CATEGORY_HINT: Record<Category, string> = {
  obstetric: "Labour, haemorrhage, eclampsia, newborn emergency",
  trauma: "Injury needing surgical or theatre support",
  icu: "Airway, shock, or ventilation likely",
  blood: "Transfusion needed before or on arrival",
  respiratory: "Hypoxia, asthma, pneumonia, distress",
  cardiac: "Chest pain, arrhythmia, shock of cardiac origin",
  other: "Emergency that does not fit the groups above",
};

export const CATEGORY_RESOURCES: Record<Category, string[]> = {
  obstetric: ["Maternity team", "Theatre on standby", "Oxytocin", "Blood"],
  trauma: ["Trauma team", "Theatre", "Blood", "Oxygen"],
  icu: ["ICU bed", "Oxygen", "Senior clinician"],
  blood: ["Blood bank", "IV access", "Emergency bay"],
  respiratory: ["Oxygen", "Senior clinician", "Emergency bay"],
  cardiac: ["Resus bay", "Defibrillator", "Senior clinician"],
  other: ["Emergency bay", "Senior clinician"],
};

export const ROLE_LABEL: Record<Role, string> = {
  clinic: "Clinic",
  hospital: "Hospital",
  transport: "Transport",
  admin: "Super admin",
};

export const SUBROLE_LABEL: Record<Subrole, string> = {
  nurse: "Nurse",
  clinical_officer: "Clinical officer",
  doctor: "Doctor",
  triage_officer: "Triage officer",
  hospital_admin: "Hospital administrator",
  driver: "Driver",
  emt: "EMT",
  dispatcher: "Dispatcher",
  super_admin: "Super admin",
};

export const AVPU_LABEL: Record<Avpu, string> = {
  A: "Alert",
  V: "Voice",
  P: "Pain",
  U: "Unresponsive",
};

export const TRANSPORT_LABEL: Record<TransportStatus, string> = {
  requested: "Requested",
  accepted: "Crew accepted",
  at_clinic: "At referring clinic",
  onboard: "Patient onboard",
  en_route: "En route",
  arrived: "Arrived at hospital",
};

export const BED_KIND_LABEL: Record<BedKind, string> = {
  bay: "Emergency bay",
  bed: "Ward bed",
  maternity: "Maternity bed",
  icu: "ICU bed",
  theatre: "Theatre bay",
};

export const HOME_PATH: Record<Role, string> = {
  clinic: "/clinic",
  hospital: "/hospital",
  transport: "/transport",
  admin: "/admin",
};

export const INTERVENTIONS = [
  "Oxygen",
  "IV fluids",
  "Oxytocin",
  "Magnesium",
  "Tranexamic acid",
  "Antibiotics",
  "Glucose",
  "Adrenaline",
  "Tourniquet",
  "Splint",
  "None yet",
] as const;

export const CANCEL_REASONS = [
  "Patient improved",
  "Family declined transfer",
  "Entered in error",
  "Care arranged outside NAFASI",
] as const;

export const DECLINE_REASONS = [
  "No bed or bay",
  "Required specialty unavailable",
  "Capacity changed",
  "Protecting emergency capacity",
] as const;

export const RELEASE_REASONS = [
  "Cannot provide the required care",
  "Bed needed for a more urgent patient",
  "Patient will not arrive",
] as const;

export function statusPair(status: ReferralStatus) {
  return `${STATUS_LABEL[status]} · ${status}`;
}
