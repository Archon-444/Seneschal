"use client";

// Catches errors thrown in the root layout itself (where a normal error.tsx
// can't reach). Renders its own document. Still re-throws Next's control-flow
// errors so a redirect/notFound is never swallowed.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const digest = error.digest ?? "";
  if (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  ) {
    throw error;
  }
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f6f3eb",
          color: "#16263f",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: "28rem" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 600 }}>Something didn&apos;t load</p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#6b7385" }}>
            We hit an unexpected error. Your records are safe — try again.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              borderRadius: "0.5rem",
              border: "none",
              backgroundColor: "#16263f",
              color: "#f6f3eb",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
