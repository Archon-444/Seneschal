import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireCtx } from "@/server/auth/request";
import { logoutAction } from "../(auth)/login/actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/onboarding/new", label: "Onboard tenancy" },
  { href: "/properties", label: "Properties" },
  { href: "/clients", label: "Clients" },
  { href: "/contacts", label: "Contacts" },
  { href: "/calendar", label: "Calendar" },
  { href: "/payments", label: "Payments" },
  { href: "/vault", label: "Document vault" },
  { href: "/imports", label: "Import & extract" },
  { href: "/proofs", label: "Proof requests" },
  { href: "/evidence", label: "Evidence" },
  { href: "/risk", label: "Risk flags" },
  { href: "/reports", label: "Reports" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let workspaceName = "";
  try {
    const ctx = await requireCtx();
    const { getWorkspaceName } = await import("@/server/services/workspace");
    workspaceName = await getWorkspaceName(ctx);
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ivory-300 bg-navy-900 text-ivory-100">
        <div className="border-b border-navy-700 px-5 py-5">
          <Link href="/dashboard" className="font-display text-2xl text-ivory-50">
            Seneschal
          </Link>
          <div className="mt-1 truncate text-xs text-navy-300">{workspaceName}</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded px-3 py-1.5 text-sm text-ivory-200 hover:bg-navy-800 hover:text-ivory-50"
            >
              {item.label}
            </Link>
          ))}
          {user.isStaff && (
            <Link
              href="/admin"
              className="mt-4 block rounded px-3 py-1.5 text-sm text-gold-300 hover:bg-navy-800"
            >
              Staff console
            </Link>
          )}
        </nav>
        <div className="border-t border-navy-700 px-5 py-4 text-xs">
          <div className="truncate text-ivory-200">{user.email}</div>
          <form action={logoutAction}>
            <button className="mt-1 text-navy-300 hover:text-ivory-100">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
