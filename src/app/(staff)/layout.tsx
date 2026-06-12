import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/request";
import { logoutAction } from "../(auth)/login/actions";

// Staff route group: requires isStaff only — no workspace membership needed.
// Normal app navigation is deliberately absent; this is the audited side door.

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isStaff) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-gold-500 bg-navy-900 px-8 py-4">
        <Link href="/admin" className="font-display text-xl text-gold-300">
          Seneschal · Staff console
        </Link>
        <div className="flex items-center gap-4 text-xs text-ivory-200">
          <span>{user.email}</span>
          <form action={logoutAction}>
            <button className="text-navy-300 hover:text-ivory-100">Sign out</button>
          </form>
        </div>
      </header>
      <main className="px-8 py-8">{children}</main>
    </div>
  );
}
