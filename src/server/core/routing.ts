import { distanceKm, etaMinutes } from "@/domain/format";
import type {
  Bed,
  CapacityRecord,
  Category,
  Facility,
  RankedFacility,
  SystemConfig,
} from "@/domain/types";

const NEED: Record<
  Category,
  { capabilities: Facility["capabilities"]; oxygen?: boolean; theatre?: boolean; blood?: boolean; bed: Bed["kind"][] }
> = {
  obstetric: { capabilities: ["maternity"], theatre: true, blood: true, bed: ["maternity", "bay"] },
  trauma: { capabilities: ["theatre", "ed"], theatre: true, blood: true, bed: ["theatre", "bay"] },
  icu: { capabilities: ["icu", "oxygen"], oxygen: true, bed: ["icu"] },
  blood: { capabilities: ["blood_bank"], blood: true, bed: ["bay", "bed"] },
  respiratory: { capabilities: ["oxygen", "ed"], oxygen: true, bed: ["bay", "icu"] },
  cardiac: { capabilities: ["ed"], oxygen: true, bed: ["bay", "icu"] },
  other: { capabilities: ["ed"], bed: ["bay", "bed"] },
};

export function rankFacilities(input: {
  origin: Facility;
  facilities: Facility[];
  beds: Bed[];
  capacity: CapacityRecord[];
  category: Category;
  config: SystemConfig;
  now: number;
}): RankedFacility[] {
  const need = NEED[input.category];
  return input.facilities
    .filter((facility) => facility.type === "hospital")
    .map((facility) => {
      const cap = input.capacity.find((row) => row.facilityId === facility.id);
      const ownBeds = input.beds.filter((bed) => bed.facilityId === facility.id);
      const matching = ownBeds.filter(
        (bed) => need.bed.includes(bed.kind) && bed.status === "available",
      );
      const reasons: string[] = [];
      let eligible = true;
      if (!facility.participating) {
        eligible = false;
        reasons.push("Facility is not participating");
      }
      const missing = need.capabilities.filter((item) => !facility.capabilities.includes(item));
      if (missing.length) {
        eligible = false;
        reasons.push(`Missing capability: ${missing.join(", ")}`);
      } else {
        reasons.push("Required capabilities are listed");
      }
      const stale = !cap || input.now - new Date(cap.updatedAt).getTime() > input.config.capacityFreshMinutes * 60_000;
      if (!cap) {
        eligible = false;
        reasons.push("No confirmed capacity record");
      } else if (stale) {
        reasons.push("Confirmed capacity is stale");
      } else {
        reasons.push("Capacity was confirmed recently");
      }
      if (need.oxygen && cap && !cap.oxygenAvailable) {
        eligible = false;
        reasons.push("Oxygen is marked unavailable");
      }
      if (need.theatre && cap && !cap.theatreAvailable) {
        eligible = false;
        reasons.push("Theatre is marked unavailable");
      }
      if (need.blood && cap && cap.bloodUnits <= 0 && !facility.capabilities.includes("blood_bank")) {
        eligible = false;
        reasons.push("No blood units confirmed");
      }
      if (matching.length === 0) {
        eligible = false;
        reasons.push("No matching bed or bay is free");
      } else {
        reasons.push(`${matching.length} matching bed${matching.length === 1 ? "" : "s"} free`);
      }
      const km = distanceKm(input.origin, facility);
      let score = 0;
      if (eligible) score += 80;
      if (!stale && cap) score += 25;
      else score -= 20;
      score += matching.length * 8;
      score -= km;
      return {
        facilityId: facility.id,
        name: facility.name,
        eligible,
        reasons,
        distanceKm: Math.round(km * 10) / 10,
        etaMin: etaMinutes(km),
        score: Math.round(score * 10) / 10,
        capacityStale: stale,
        availableBeds: matching.length,
      };
    })
    .sort((a, b) => b.score - a.score);
}
