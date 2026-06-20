import { NextResponse, type NextRequest } from "next/server";
import { isQuarantined } from "@/server/config/features";

// Defense-in-depth for the pilot quarantine. The primary, styled gate is each
// route's own `notFound()` guard; this blocks the request at the edge before it
// reaches the route, covering any future nested route under these segments that
// forgets its guard. A bare 404 here is fine — it's the outer layer; the inner
// route guard renders the styled not-found if the matcher ever misses.

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/portal/passport") && isQuarantined("passport")) {
    return new NextResponse(null, { status: 404 });
  }
  // The `listings` quarantine covers the whole marketplace loop: the supply side
  // (/portal/listings) and its operator surface (/enquiries, /viewings).
  if (
    (pathname.startsWith("/portal/listings") ||
      pathname.startsWith("/enquiries") ||
      pathname.startsWith("/viewings")) &&
    isQuarantined("listings")
  ) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/portal/passport/:path*",
    "/portal/listings/:path*",
    "/enquiries/:path*",
    "/viewings/:path*",
  ],
};
