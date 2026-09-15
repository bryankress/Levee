import type { Metadata } from "next";
import { MarketingSearch } from "./MarketingSearch";
import styles from "./marketing.module.css";

export const metadata: Metadata = {
  title: "Real-time river gauge monitoring",
};

export default function MarketingPage() {
  return (
    <div className={styles.page}>
      <div className={styles.brand}>Levee Buddy</div>

      <MarketingSearch />

      <footer className={styles.footer}>
        <a href="/login">Already have an account? Sign in.</a>
      </footer>
    </div>
  );
}
