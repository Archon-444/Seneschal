import { notFound } from "next/navigation";
import { isQuarantined } from "@/server/config/features";

// Pilot quarantine (see QUARANTINE.md). Enquiries are the operator side of the deferred
// marketplace loop (listings → enquiry → viewing). The public inflow is already gated, so the
// operator surface fails closed under the same `listings` flag — this is the styled inner gate;
// middleware.ts is the edge outer gate, and the nav entry is omitted (src/components/shell/nav.ts).
export default function EnquiriesSegmentLayout({ children }: { children: React.ReactNode }) {
  if (isQuarantined("listings")) notFound();
  return <>{children}</>;
}
