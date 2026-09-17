import type { MetadataRoute } from "next";
import { ROOT_DOMAIN } from "@/server/tenancy/subdomain";

// Only the pages that are genuinely public and reachable unauthenticated on
// the apex domain today - no placeholder entries for pages (pricing, how-it-
// works, etc.) that don't exist yet.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${ROOT_DOMAIN}`;

  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/signup`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/login`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
