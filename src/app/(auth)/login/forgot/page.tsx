import { redirect } from "next/navigation";
import { currentUser, homePathFor, requireCtx } from "@/server/auth/request";
import { Logo } from "@/components/Logo";
import { ForgotForm } from "./ForgotForm";

export default async function ForgotPasswordPage() {
  const user = await currentUser();
  if (user?.isPlatformAdmin) redirect("/admin");
  if (user) {
    let target: string | null = null;
    try {
      const ctx = await requireCtx();
      target = homePathFor(ctx.role);
    } catch {
      // Signed-in without a membership — send them back to the sign-in boundary.
    }
    redirect(target ?? "/login");
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo priority className="mx-auto mb-4 h-20 w-20" />
          <h1 className="font-display text-4xl text-navy-900">Reset password</h1>
          <p className="mt-2 text-sm text-navy-500">Staff sign-in for your workspace.</p>
        </div>
        <ForgotForm />
      </div>
    </main>
  );
}
