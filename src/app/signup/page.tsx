import type { Metadata } from "next";
import { SignupForm } from "./SignupForm";
import styles from "./signup.module.css";

export const metadata: Metadata = {
  title: "Set up your district",
};

export default function SignupPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>Levee Buddy</div>
        <h1 className={styles.heading}>Set up your district</h1>
        <p className={styles.sub}>
          Creates your organization, your first levee, and your admin account. Once you&rsquo;re in, we&rsquo;ll
          automatically find and start tracking the river sensors nearest your levee&rsquo;s ZIP code.
        </p>
        <SignupForm />
      </div>
    </div>
  );
}
