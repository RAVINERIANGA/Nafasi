import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/services/firebase";
import type {
  AuditEvent,
  Bed,
  CapacityRecord,
  Facility,
  Referral,
  Transport,
  User,
} from "@/domain/types";

/**
 * Firestore Service Layer for NAFASI
 * Provides typed read/write and real-time subscriber methods
 * for all clinical and administrative entities.
 */

// ---------------- FACILITIES ----------------
export async function getFirestoreFacilities(): Promise<Facility[]> {
  const col = collection(db, "facilities");
  const snap = await getDocs(col);
  return snap.docs.map((d) => d.data() as Facility);
}

export async function saveFirestoreFacility(facility: Facility): Promise<void> {
  const ref = doc(db, "facilities", facility.id);
  await setDoc(ref, facility, { merge: true });
}

// ---------------- REFERRALS ----------------
export async function getFirestoreReferral(id: string): Promise<Referral | null> {
  const ref = doc(db, "referrals", id);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as Referral) : null;
}

export async function getFirestoreReferralsByFacility(
  facilityId: string,
  role: "clinic" | "hospital"
): Promise<Referral[]> {
  const col = collection(db, "referrals");
  const field = role === "clinic" ? "originFacilityId" : "destinationFacilityId";
  const q = query(col, where(field, "==", facilityId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Referral);
}

export async function saveFirestoreReferral(referral: Referral): Promise<void> {
  const ref = doc(db, "referrals", referral.id);
  await setDoc(ref, { ...referral, updatedAt: new Date().toISOString() }, { merge: true });
}

export function subscribeToReferrals(
  facilityId: string,
  onUpdate: (referrals: Referral[]) => void
) {
  const col = collection(db, "referrals");
  return onSnapshot(col, (snap) => {
    const list = snap.docs
      .map((d) => d.data() as Referral)
      .filter(
        (r) =>
          r.originFacilityId === facilityId ||
          r.destinationFacilityId === facilityId ||
          r.offers.some((o) => o.facilityId === facilityId)
      );
    onUpdate(list);
  });
}

// ---------------- ATOMIC BED LOCKS ----------------
export async function getFirestoreBeds(facilityId: string): Promise<Bed[]> {
  const col = collection(db, "beds");
  const q = query(col, where("facilityId", "==", facilityId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Bed);
}

export async function updateFirestoreBedStatus(
  bedId: string,
  status: Bed["status"],
  lock?: Bed["lock"]
): Promise<void> {
  const ref = doc(db, "beds", bedId);
  await updateDoc(ref, {
    status,
    lock: lock ?? null,
  });
}

// ---------------- AUDIT EVENTS (APPEND-ONLY) ----------------
export async function logFirestoreAuditEvent(event: AuditEvent): Promise<void> {
  const col = collection(db, "audit_events");
  const ref = doc(col, event.id);
  await setDoc(ref, {
    ...event,
    createdAt: serverTimestamp(),
  });
}

export async function getFirestoreAuditEvents(referralId?: string): Promise<AuditEvent[]> {
  const col = collection(db, "audit_events");
  let q = query(col, orderBy("serverTime", "desc"));
  if (referralId) {
    q = query(col, where("referralId", "==", referralId), orderBy("serverTime", "desc"));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AuditEvent);
}

// ---------------- TRANSPORTS ----------------
export async function getFirestoreTransports(): Promise<Transport[]> {
  const col = collection(db, "transports");
  const snap = await getDocs(col);
  return snap.docs.map((d) => d.data() as Transport);
}

export async function updateFirestoreTransportStatus(
  transportId: string,
  status: Transport["status"],
  etaMin?: number
): Promise<void> {
  const ref = doc(db, "transports", transportId);
  const patch: Record<string, unknown> = {
    status,
    updatedAt: new Date().toISOString(),
  };
  if (etaMin !== undefined) patch.etaMin = etaMin;
  await updateDoc(ref, patch);
}
