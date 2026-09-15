import type { Metadata } from "next";
import { ROOT_DOMAIN } from "@/server/tenancy/subdomain";
import { SignupForm } from "./SignupForm";
import styles from "./signup.module.css";

export const metadata: Metadata = {
  title: "Set up your district",
};

interface SelectedSensor {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles?: number;
  streamRelation?: "UPSTREAM" | "DOWNSTREAM";
}

function parseSelectedSensors(raw: string | string[] | undefined): SelectedSensor[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SelectedSensor =>
        !!entry && typeof entry.siteNo === "string" && typeof entry.lat === "number" && typeof entry.lon === "number",
    );
  } catch {
    return [];
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ zip?: string | string[]; sites?: string | string[] }>;
}) {
  const params = await searchParams;
  const zip = typeof params.zip === "string" ? params.zip : undefined;
  const sensors = parseSelectedSensors(params.sites);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>Levee Buddy</div>
        <h1 className={styles.heading}>Set up your district</h1>
        <p className={styles.sub}>
          Creates your organization, your first levee, your admin account, and starts tracking any
          sensors you selected — everything you need to sign in and start monitoring.
        </p>
        <SignupForm rootDomain={ROOT_DOMAIN} zip={zip} sensors={sensors} />
      </div>
    </div>
  );
}
