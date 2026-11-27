"use client";

import { useApp } from "@/services/provider";
import { CapacityEditor } from "@/ui/capacity";
import { DeskFrame } from "@/ui/frame";

export default function Page() {
  const { session } = useApp();
  return (
    <DeskFrame role="hospital">
      <div className="mx-auto max-w-3xl space-y-3">
        <h1 className="font-display text-3xl text-teal-dark">Capacity</h1>
        <p className="text-sm text-ink/70">Confirm oxygen, theatre, blood, and which bays are free. A locked bed stays reserved until the referral releases it.</p>
        {session?.user.role === "hospital" ? <CapacityEditor facilityId={session.facility.id} /> : null}
      </div>
    </DeskFrame>
  );
}
