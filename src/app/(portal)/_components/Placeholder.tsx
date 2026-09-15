import Link from "next/link";
import styles from "../portal.module.css";

export function Placeholder({ title }: { title: string }) {
  return (
    <div className={styles.placeholder}>
      <h2>{title}</h2>
      <p>This part of the portal isn&rsquo;t built yet.</p>
      <Link href="/">← Back to home</Link>
    </div>
  );
}
