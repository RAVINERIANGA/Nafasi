/**
 * NAFASI Firestore Database Seeder Script
 *
 * Populates your live Firebase project (nafasi-emergency) with:
 * - Facilities (clinics, hospitals, dispatch command)
 * - Emergency Beds & Bays
 * - Verified Clinician & Admin Users
 * - Real-time Capacity Records
 * - Live Referral Pipeline
 * - Audit Trail Events
 */

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { createSeed } from "../src/server/realtime/seed";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCVdK4DSJ4aBCy12HSB0N9CnrAzNiMkpv8",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "nafasi-emergency.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "nafasi-emergency",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "nafasi-emergency.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "332085145104",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:332085145104:web:20191538aa597700ffa495",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-C27FQLSXGV",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper to remove undefined values since Firestore rejects undefined
function sanitize<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

async function seed() {
  console.log("🌱 Starting NAFASI Firestore Seed into project: nafasi-emergency ...");
  const seedData = createSeed();

  // 1. Facilities
  console.log(`Writing ${seedData.facilities.length} healthcare facilities...`);
  for (const facility of seedData.facilities) {
    await setDoc(doc(db, "facilities", facility.id), sanitize(facility));
  }

  // 2. Beds
  console.log(`Writing ${seedData.beds.length} hospital beds and emergency bays...`);
  for (const bed of seedData.beds) {
    await setDoc(doc(db, "beds", bed.id), sanitize(bed));
  }

  // 3. Clinicians & Admin Accounts
  console.log(`Writing ${seedData.users.length} verified clinician and admin accounts...`);
  for (const user of seedData.users) {
    await setDoc(doc(db, "users", user.id), sanitize(user));
  }

  // 4. Hospital Capacity Records
  console.log(`Writing ${seedData.capacity.length} hospital capacity records...`);
  for (const cap of seedData.capacity) {
    await setDoc(doc(db, "capacity", cap.facilityId), sanitize(cap));
  }

  // 5. Initial Referrals
  console.log(`Writing ${seedData.referrals.length} emergency referrals...`);
  for (const ref of seedData.referrals) {
    await setDoc(doc(db, "referrals", ref.id), sanitize(ref));
  }

  // 6. Transports
  console.log(`Writing ${seedData.transports.length} ambulance transports...`);
  for (const t of seedData.transports) {
    await setDoc(doc(db, "transports", t.id), sanitize(t));
  }

  // 7. Audit Events
  console.log(`Writing ${seedData.events.length} immutable audit events...`);
  for (const ev of seedData.events) {
    await setDoc(doc(db, "audit_events", ev.id), sanitize(ev));
  }

  // 8. Regional Configuration
  console.log("Writing system timers configuration...");
  await setDoc(doc(db, "system_config", "regional_defaults"), sanitize(seedData.config));

  console.log("🎉 SUCCESS: All NAFASI data is now live in your Google Firebase Firestore database!");
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
