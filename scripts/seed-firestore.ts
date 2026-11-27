/**
 * NAFASI Firestore Database Seeder Script
 *
 * Populates Firestore with facilities, initial beds, users,
 * capacity records, and sample emergency referrals.
 *
 * Run with:
 * npx tsx scripts/seed-firestore.ts
 */

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, writeBatch } from "firebase/firestore";
import { facilities, users } from "../src/domain/demo-data";
import { createSeed } from "../src/server/realtime/seed";

// Load configuration from environment or demo defaults
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "nafasi-demo.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "nafasi-demo",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "nafasi-demo.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
};

const app = initializeApp(config);
const db = getFirestore(app);

async function seed() {
  console.log("🌱 Starting NAFASI Firestore Seed...");
  const seedData = createSeed();

  // 1. Facilities
  console.log(`Writing ${seedData.facilities.length} facilities...`);
  for (const facility of seedData.facilities) {
    await setDoc(doc(db, "facilities", facility.id), facility);
  }

  // 2. Beds
  console.log(`Writing ${seedData.beds.length} beds and emergency bays...`);
  for (const bed of seedData.beds) {
    await setDoc(doc(db, "beds", bed.id), bed);
  }

  // 3. Verified Clinician & Admin Users
  console.log(`Writing ${seedData.users.length} accounts...`);
  for (const user of seedData.users) {
    await setDoc(doc(db, "users", user.id), user);
  }

  // 4. Initial Capacity Records
  console.log(`Writing ${seedData.capacity.length} capacity records...`);
  for (const cap of seedData.capacity) {
    await setDoc(doc(db, "capacity", cap.facilityId), cap);
  }

  // 5. Initial Sample Referrals
  console.log(`Writing ${seedData.referrals.length} referrals...`);
  for (const ref of seedData.referrals) {
    await setDoc(doc(db, "referrals", ref.id), ref);
  }

  // 6. Transports
  console.log(`Writing ${seedData.transports.length} transports...`);
  for (const t of seedData.transports) {
    await setDoc(doc(db, "transports", t.id), t);
  }

  // 7. Audit Events
  console.log(`Writing ${seedData.events.length} initial audit events...`);
  for (const ev of seedData.events) {
    await setDoc(doc(db, "audit_events", ev.id), ev);
  }

  // 8. System Config
  console.log("Writing system timers configuration...");
  await setDoc(doc(db, "system_config", "regional_defaults"), seedData.config);

  console.log("✅ Firestore seeding completed successfully!");
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
