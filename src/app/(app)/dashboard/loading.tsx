import { SkeletonKpiRow, SkeletonLine, SkeletonTable } from "@/components/Skeleton";

// Shape-matches the real overview (stat strip, next-actions table, then two
// panels side by side) so the loading state doesn't reflow on arrival.
export default function Loading() {
  return (
    <div className="space-y-4">
      <SkeletonLine className="w-40 !h-6" />
      <SkeletonKpiRow count={7} />
      <SkeletonTable rows={6} cols={7} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonTable rows={5} cols={4} />
        <SkeletonTable rows={5} cols={4} />
      </div>
    </div>
  );
}
