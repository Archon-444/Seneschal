import { Logo } from "@/components/Logo";
import { ResetForm } from "./ResetForm";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo priority className="mx-auto mb-4 h-20 w-20" />
          <h1 className="font-display text-4xl text-navy-900">Choose a password</h1>
          <p className="mt-2 text-sm text-navy-500">Then you will be signed in to your workspace.</p>
        </div>
        <ResetForm token={token} />
      </div>
    </main>
  );
}
