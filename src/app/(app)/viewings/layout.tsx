import { notFound } from "next/navigation";
import { isQuarantined } from "@/server/config/features";

// Pilot quarantine (see QUARANTINE.md). Viewings are the operator side of the deferred marketplace
// loop (listings → enquiry → viewing) — live service code taken out of the pilot's reachable
// surface under the same `listings` flag. Styled inner gate; middleware.ts is the edge outer gate,
// and the nav entry is omitted (src/components/shell/nav.ts).
export default function ViewingsSegmentLayout({ children }: { children: React.ReactNode }) {
  if (isQuarantined("listings")) notFound();
  return <>{children}</>;
}
