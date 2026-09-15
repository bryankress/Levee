import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { extractSubdomain } from "@/server/tenancy/subdomain";

// Proxy defaults to the Node.js runtime as of Next.js 16, so a direct Prisma
// lookup here is fine - no Edge-runtime workaround needed for the org lookup.
export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const subdomain = extractSubdomain(host);

  if (!subdomain) {
    // Apex/www/bare-localhost: there's no org to resolve, so "/" is the
    // marketing homepage, not the portal. Everything else (e.g. /login's
    // no-org notice, /signup) is left alone.
    if (request.nextUrl.pathname === "/") {
      return NextResponse.rewrite(new URL("/marketing", request.url));
    }
    return NextResponse.next();
  }

  const org = await prisma.organization.findUnique({ where: { subdomain } });
  if (!org) {
    return new NextResponse("No levee district found at this address.", { status: 404 });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-org-id", org.id);
  requestHeaders.set("x-org-subdomain", org.subdomain);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
