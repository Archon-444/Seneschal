import { SkeletonKpiRow, SkeletonLine, SkeletonTable, SkeletonTimeline } from "@/components/Skeleton";

// Shape-matches the real dashboard (two KPI tiers, then Upcoming timeline
// beside the risk-flag table) so the loading state doesn't reflow on arrival.
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <SkeletonLine className="w-24 !h-3" />
        <SkeletonLine className="w-64 !h-7" />
      </div>
      <SkeletonKpiRow />
      <SkeletonKpiRow />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <SkeletonLine className="w-32 !h-5" />
          <SkeletonTimeline />
        </div>
        <div className="space-y-3">
          <SkeletonLine className="w-32 !h-5" />
          <SkeletonTable rows={5} cols={3} />
        </div>
      </div>
    </div>
  );
}
