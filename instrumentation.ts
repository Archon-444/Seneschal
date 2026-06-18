// Next.js calls `register()` once per Node.js runtime cold start, before any
// request is served. This is the right gate for H6's production env hard-fail:
// build-time fires too early (Vercel injects runtime env separately) and a
// first-request check leaves a window where a misconfigured deploy serves
// traffic with the wrong adapter wired up.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateProductionEnv } = await import("./src/server/config/env");
  validateProductionEnv();
}
