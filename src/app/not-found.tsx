import { Eyebrow, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <Eyebrow>404</Eyebrow>
        <h1 className="font-display text-2xl font-semibold text-navy-900">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          This page doesn&apos;t exist or has moved. If you followed a link here, it may have expired.
        </p>
        <div className="mt-5 flex justify-center">
          <LinkButton href="/dashboard" variant="primary">
            Back to dashboard
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
