import { notFound } from "next/navigation";
import { isQuarantined } from "@/server/config/features";

// Pilot quarantine (see QUARANTINE.md). Guarding at the segment layout covers
// this route and any nested route added later in one place — the styled inner
// gate; middleware.ts is the edge outer gate.
export default function PassportSegmentLayout({ children }: { children: React.ReactNode }) {
  if (isQuarantined("passport")) notFound();
  return <>{children}</>;
}
