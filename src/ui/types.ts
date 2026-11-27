import type { AuditEvent, Referral } from "@/domain/types";

export type PresentedReferral = Referral & {
  originName: string;
  destinationName?: string;
  timeline: AuditEvent[];
};
