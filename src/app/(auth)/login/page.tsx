import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/request";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="font-display text-4xl text-navy-900">Seneschal</h1>
          <p className="mt-2 text-sm text-navy-500">
            Know what is due. Know who owns it. Keep the proof.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
