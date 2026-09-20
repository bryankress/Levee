import type { Metadata } from "next";
import { LeveeSeal } from "@/components/brand/LeveeMark";
import styles from "./marketing.module.css";

const DESCRIPTION = "Real-time river sensor monitoring for levee districts - sign up and we'll find your sensors for you.";

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

      <div className={styles.brand}>
        <LeveeSeal className={styles.brandIcon} />
        <h1 className={styles.brandName}>Levee Buddy</h1>
      </div>

      <div className={styles.actions}>
        <a className={styles.primaryAction} href="/signup">
          Create account
        </a>
        <a className={styles.secondaryAction} href="/login">
          Log in
        </a>
      </div>
    </div>
  );
}
