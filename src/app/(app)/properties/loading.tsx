import { SkeletonPage, SkeletonTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkeletonPage kpis={false}>
      <SkeletonTable rows={8} cols={5} />
    </SkeletonPage>
  );
}
