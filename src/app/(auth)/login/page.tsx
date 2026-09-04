import { redirect } from "next/navigation";
import { currentUser, homePathFor, requireCtx } from "@/server/auth/request";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const user = await currentUser();
  if (user?.isPlatformAdmin) redirect("/admin");
  if (user) {
    let target: string | null = null;
    try {
      const ctx = await requireCtx();
      target = homePathFor(ctx.role);
    } catch {
      // A signed-in account without a current membership remains at the safe
      // sign-in boundary instead of entering a redirect loop.
    }
    if (target) redirect(target);
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo priority className="mx-auto mb-4 h-20 w-20" />
          <h1 className="text-3xl font-semibold text-navy-900">Seneschal</h1>
          <p className="mt-2 text-sm text-navy-500">
            Know what is due. Know who owns it. Keep the proof.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
