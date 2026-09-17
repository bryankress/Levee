import type { MetadataRoute } from "next";
import { ROOT_DOMAIN } from "@/server/tenancy/subdomain";

// Every (portal) route requires a signed-in session and redirects to /login
// otherwise - nothing there is public content worth a crawler's time, on the
// apex or any tenant subdomain alike (this file is served identically on
// both, since Next has no per-host robots.txt convention here). Disallowing
// them isn't an access control - the portal's own auth already handles that
// - it just keeps crawlers off pages that are never anything but a redirect
// for them.
const PRIVATE_PATHS = ["/calendar", "/documents", "/personnel", "/sensors", "/settings"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_PATHS,
    },
    sitemap: `https://${ROOT_DOMAIN}/sitemap.xml`,
  };
}
