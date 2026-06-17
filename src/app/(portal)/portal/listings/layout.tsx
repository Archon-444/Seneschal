import { notFound } from "next/navigation";
import { isQuarantined } from "@/server/config/features";

// Pilot quarantine (see QUARANTINE.md). Guarding at the segment layout covers
// /portal/listings and the nested /portal/listings/[id] (and any future child)
// in one place — the styled inner gate; middleware.ts is the edge outer gate.
export default function ListingsSegmentLayout({ children }: { children: React.ReactNode }) {
  if (isQuarantined("listings")) notFound();
  return <>{children}</>;
}
