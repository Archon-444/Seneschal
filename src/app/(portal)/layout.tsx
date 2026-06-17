import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, requireCtx, homePathFor } from "@/server/auth/request";
import { isPersonaRole } from "@/server/authz";
import { unreadCount } from "@/server/services/notifications";
import { logoutAction } from "../(auth)/login/actions";
import { AppShell } from "@/components/shell/AppShell";
import { TENANT_NAV, LANDLORD_NAV } from "@/components/shell/nav";

// Self-service persona surface (F0b). Mirrors (app)/layout but admits ONLY the
// TENANT/LANDLORD personas; any operator/staff role is redirected to its own home
// via the single homePathFor resolver, so the two surfaces can never ping-pong.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  let ctx;
  try {
    ctx = await requireCtx();
  } catch {
    redirect("/login");
  }
  if (!isPersonaRole(ctx.role)) redirect(homePathFor(ctx.role));

  const { getWorkspaceName } = await import("@/server/services/workspace");
  const [workspaceName, unread] = await Promise.all([getWorkspaceName(ctx), unreadCount(ctx)]);

  const jar = await cookies();
  const initialCollapsed = jar.get("seneschal_sidebar")?.value === "collapsed";
  const nav = ctx.role === "LANDLORD" ? LANDLORD_NAV : TENANT_NAV;

  return (
    <AppShell
      nav={nav}
      isStaff={user.isStaff}
      workspaceName={workspaceName}
      user={{ name: user.name, email: user.email, role: ctx.role }}
      initialCollapsed={initialCollapsed}
      initialUnread={unread}
      signOut={logoutAction}
    >
      {children}
    </AppShell>
  );
}
