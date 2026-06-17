import { redirect } from "next/navigation";
import { requireCtx, homePathFor } from "@/server/auth/request";

export default async function Home() {
  // Resolve the signed-in role and send it to its home (personas → /portal,
  // operators → /dashboard); unauthenticated visitors go to /login.
  let target = "/login";
  try {
    const ctx = await requireCtx();
    target = homePathFor(ctx.role);
  } catch {
    target = "/login";
  }
  redirect(target);
}
