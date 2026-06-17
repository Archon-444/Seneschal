import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, requireCtx, homePathFor } from "@/server/auth/request";
import { isPersonaRole } from "@/server/authz";
import { unreadCount } from "@/server/services/notifications";
import { logoutAction } from "../(auth)/login/actions";
import { AppShell } from "@/components/shell/AppShell";
import { NAV } from "@/components/shell/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  let ctx;
  try {
    ctx = await requireCtx();
  } catch {
    redirect("/login");
  }
  // A persona has no operator surface here — send it to /portal (its scoped home).
  // Keeps the redirect deterministic via the single homePathFor resolver.
  if (isPersonaRole(ctx.role)) redirect(homePathFor(ctx.role));

  const { getWorkspaceName } = await import("@/server/services/workspace");
  const [workspaceName, unread] = await Promise.all([getWorkspaceName(ctx), unreadCount(ctx)]);
  const role = ctx.role;

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
