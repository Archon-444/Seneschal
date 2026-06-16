import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, requireCtx } from "@/server/auth/request";
import { unreadCount } from "@/server/services/notifications";
import { logoutAction } from "../(auth)/login/actions";
import { AppShell } from "@/components/shell/AppShell";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/onboarding/new", label: "Onboard tenancy" },
  { href: "/properties", label: "Properties" },
  { href: "/clients", label: "Clients" },
  { href: "/contacts", label: "Contacts" },
  { href: "/calendar", label: "Calendar" },
  { href: "/renewals", label: "Renewals" },
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
  let role = "";
  let unread = 0;
  try {
    const ctx = await requireCtx();
    const { getWorkspaceName } = await import("@/server/services/workspace");
    [workspaceName, unread] = await Promise.all([getWorkspaceName(ctx), unreadCount(ctx)]);
    role = ctx.role;
  } catch {
    redirect("/login");
  }

  const jar = await cookies();
  const initialCollapsed = jar.get("seneschal_sidebar")?.value === "collapsed";

  return (
    <AppShell
      nav={NAV}
      isStaff={user.isStaff}
      workspaceName={workspaceName}
      user={{ name: user.name, email: user.email, role }}
      initialCollapsed={initialCollapsed}
      initialUnread={unread}
      signOut={logoutAction}
    >
      {children}
    </AppShell>
  );
}
