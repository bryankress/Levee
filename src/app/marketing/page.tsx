import type { Metadata } from "next";
import { MarketingSearch } from "./MarketingSearch";
import styles from "./marketing.module.css";

export const metadata: Metadata = {
  title: "Real-time river gauge monitoring",
};

export default function MarketingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.brand}>Levee Buddy</div>
        <h1 className={styles.headline}>Know before the river does.</h1>
        <p className={styles.sub}>
          Levee Buddy watches USGS stream gauges near your levee around the clock and alerts your
          team by text or email the moment conditions cross a threshold you set.
        </p>
      </header>

      <section className={styles.searchSection}>
        <h2 className={styles.searchHeading}>Find the gauges near you</h2>
        <p className={styles.searchSub}>
          Enter a ZIP code to see the real USGS stream gauges within 100 miles, pulled live from
          the National Water Information System.
        </p>
        <MarketingSearch />
      </section>

      <footer className={styles.footer}>
        <a href="/login">Already have an account? Sign in.</a>
      </footer>
    </div>
  );
}
