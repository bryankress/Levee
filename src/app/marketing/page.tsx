import type { Metadata } from "next";
import { MarketingSearch } from "./MarketingSearch";
import styles from "./marketing.module.css";

const DESCRIPTION = "Find nearby USGS river gauges and monitor the ones your levee district depends on.";

export const metadata: Metadata = {
  title: "Real-time river sensor monitoring",
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Levee Buddy — Real-time river sensor monitoring",
    description: DESCRIPTION,
    url: "/",
    images: ["/hero.webp"],
  },
};

// Matches only what this page actually says and does today - no pricing,
// ratings, or review data, since those aren't stable/verified content this
// page shows.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Levee Buddy",
      url: "https://leveebuddy.com",
    },
    {
      "@type": "SoftwareApplication",
      name: "Levee Buddy",
      applicationCategory: "BusinessApplication",
      description: DESCRIPTION,
      url: "https://leveebuddy.com",
    },
  ],
};

export default function MarketingPage() {
  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <div className={styles.brand}>Levee Buddy</div>

      <MarketingSearch />

      <footer className={styles.footer}>
        <a href="/login">Already have an account? Sign in.</a>
      </footer>
    </div>
  );
}
