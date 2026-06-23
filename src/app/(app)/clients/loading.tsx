import { SkeletonPage, SkeletonTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkeletonPage kpis={false}>
      <SkeletonTable rows={6} />
    </SkeletonPage>
  );
}
