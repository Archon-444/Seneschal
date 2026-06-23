import { SkeletonPage, SkeletonTable } from "@/components/Skeleton";

export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonTable rows={6} cols={6} />
    </SkeletonPage>
  );
}
