"use client";

import { useParams } from "next/navigation";
import { RoutingReview } from "@/ui/routing";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <RoutingReview referralId={params.id} />;
}
