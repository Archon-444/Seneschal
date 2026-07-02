import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/request";
import { logoutAction } from "../(auth)/login/actions";

// Platform-operator route group: requires isPlatformAdmin only — no workspace membership.
// Normal app navigation is deliberately absent; this is the audited operator plane.

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.isPlatformAdmin) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-navy-900 focus:shadow-md"
      >
        Skip to content
      </a>
      <header className="flex items-center justify-between border-b border-gold-500 bg-navy-900 px-8 py-4">
        <Link href="/admin" className="font-display text-xl text-gold-300">
          Seneschal · Platform console
        </Link>
        <div className="flex items-center gap-4 text-xs text-ivory-200">
          <span>{user.email}</span>
          <form action={logoutAction}>
            <button className="text-navy-300 hover:text-ivory-100">Sign out</button>
          </form>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="px-8 py-8 outline-none">
        {children}
      </main>
    </div>
  );
}
