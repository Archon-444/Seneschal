"use client";

import { RouteError } from "@/components/RouteError";

export default function RootError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
