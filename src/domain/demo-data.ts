import type { Facility, Subrole, User } from "./types";

export const DEMO_OTP = "482913";

export const FACILITY_IDS = {
  rafiki: "fac_rafiki",
  mwanga: "fac_mwanga",
  bahari: "fac_bahari",
  kilima: "fac_kilima",
  pwani: "fac_pwani",
  dispatch: "fac_dispatch",
  regional: "fac_regional",
} as const;

export const USER_IDS = {
  amina: "usr_amina",
  joseph: "usr_joseph",
  grace: "usr_grace",
  peter: "usr_peter",
  halima: "usr_halima",
  lucy: "usr_lucy",
  daniel: "usr_daniel",
  fatuma: "usr_fatuma",
} as const;

export const facilities: Facility[] = [
  {
    id: FACILITY_IDS.rafiki,
    name: "Rafiki Community Clinic",
    shortName: "Rafiki Clinic",
    type: "clinic",
    region: "Kaskazi Coast",
    lat: -4.05,
    lng: 39.62,
    capabilities: [],
    phone: "+254711100221",
    participating: true,
  },
  {
    id: FACILITY_IDS.mwanga,
    name: "Mwanga Health Centre",
    shortName: "Mwanga HC",
    type: "clinic",
    region: "Kaskazi Coast",
    lat: -4.12,
    lng: 39.58,
    capabilities: [],
    phone: "+254711100334",
    participating: true,
  },
  {
    id: FACILITY_IDS.bahari,
    name: "Bahari District Hospital",
    shortName: "Bahari Hospital",
    type: "hospital",
    region: "Kaskazi Coast",
    lat: -4.02,
    lng: 39.67,
    capabilities: ["ed", "maternity", "theatre", "oxygen", "blood_bank"],
    phone: "+254711200110",
    participating: true,
  },
  {
    id: FACILITY_IDS.kilima,
    name: "Kilima County Hospital",
    shortName: "Kilima Hospital",
    type: "hospital",
    region: "Kaskazi Coast",
    lat: -3.96,
    lng: 39.76,
    capabilities: ["ed", "icu", "oxygen", "theatre"],
    phone: "+254711200220",
    participating: true,
  },
  {
    id: FACILITY_IDS.pwani,
    name: "Pwani Regional Hospital",
    shortName: "Pwani Regional",
    type: "hospital",
    region: "Kaskazi Coast",
    lat: -4.08,
    lng: 39.84,
    capabilities: ["ed", "maternity", "theatre", "icu", "oxygen", "blood_bank"],
    phone: "+254711200330",
    participating: true,
  },
  {
    id: FACILITY_IDS.dispatch,
    name: "Kaskazi Ambulance Dispatch",
    shortName: "Dispatch",
    type: "dispatch",
    region: "Kaskazi Coast",
    lat: -4.04,
    lng: 39.66,
    capabilities: [],
    phone: "+254711300100",
    participating: true,
  },
  {
    id: FACILITY_IDS.regional,
    name: "Kaskazi Regional Health Office",
    shortName: "Regional office",
    type: "admin",
    region: "Kaskazi Coast",
    lat: -4.04,
    lng: 39.68,
    capabilities: [],
    phone: "+254711400100",
    participating: true,
  },
];

export const users: User[] = [
  user("usr_amina", "Amina Hassan", "clinic", "nurse", "NCK-20481", FACILITY_IDS.rafiki, "+254711000221", "amina.hassan@rafiki.demo", "2580"),
  user("usr_joseph", "Joseph Otieno", "clinic", "clinical_officer", "COC-11833", FACILITY_IDS.mwanga, "+254711000334", "joseph.otieno@mwanga.demo", "2581"),
  user("usr_grace", "Grace Wanjiku", "hospital", "doctor", "KMPDC-55910", FACILITY_IDS.bahari, "+254711000441", "grace.wanjiku@bahari.demo", "3690"),
  user("usr_peter", "Peter Kamau", "hospital", "triage_officer", "NCK-33012", FACILITY_IDS.kilima, "+254711000552", "peter.kamau@kilima.demo", "3691"),
  user("usr_halima", "Halima Yusuf", "hospital", "hospital_admin", "HADMIN-1044", FACILITY_IDS.pwani, "+254711000663", "halima.yusuf@pwani.demo", "3692"),
  user("usr_lucy", "Lucy Njeri", "transport", "emt", "EMT-7721", FACILITY_IDS.dispatch, "+254711000774", "lucy.njeri@dispatch.demo", "1470"),
  user("usr_daniel", "Daniel Okello", "transport", "dispatcher", "DISP-2208", FACILITY_IDS.dispatch, "+254711000885", "daniel.okello@dispatch.demo", "1471"),
  user("usr_fatuma", "Fatuma Ali", "admin", "super_admin", "RHO-0017", FACILITY_IDS.regional, "+254711000996", "fatuma.ali@health.demo", "0007"),
];

function user(
  id: string,
  name: string,
  role: User["role"],
  subrole: Subrole,
  registrationNumber: string,
  facilityId: string,
  phone: string,
  email: string,
  pin: string,
): User {
  return { id, name, role, subrole, registrationNumber, facilityId, phone, email, pin };
}

export const UNRESOLVED_DECISIONS = [
  {
    id: "registration",
    title: "Registration verification",
    state: "Unresolved",
    detail: "The prototype does not check professional registers. Registration numbers are fictional labels.",
  },
  {
    id: "consent",
    title: "Consent basis",
    state: "Unresolved",
    detail: "No consent model has been chosen for emergency referral data.",
  },
  {
    id: "retention",
    title: "Data retention",
    state: "Unresolved",
    detail: "How long referrals, vitals, and audit events are kept is not decided.",
  },
  {
    id: "legal",
    title: "Legal and regulatory review",
    state: "Not started",
    detail: "Nothing in this prototype is a claim of legal, privacy, or medical-device compliance.",
  },
  {
    id: "adoption",
    title: "Facility adoption",
    state: "Unresolved",
    detail: "Participation can be toggled per facility, but no adoption policy has been agreed.",
  },
  {
    id: "safety",
    title: "Safety timeout",
    state: "Configurable, not validated",
    detail: "The demo releases an unconfirmed reservation after the configured hold. The safe duration is an operational decision.",
  },
  {
    id: "escalation",
    title: "Escalation ownership",
    state: "Unresolved",
    detail: "Escalations notify the sample dispatcher and regional admin. Who must act is not assigned by policy.",
  },
  {
    id: "routing",
    title: "Routing policy",
    state: "Configurable, not validated",
    detail: "Ranking uses category, capabilities, distance, and confirmed capacity. It is not a clinical protocol.",
  },
] as const;
