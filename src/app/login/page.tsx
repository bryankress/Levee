import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
import { ROOT_DOMAIN } from "@/server/tenancy/subdomain";
import { FindPortalForm } from "./FindPortalForm";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const headerList = await headers();
  const orgId = headerList.get("x-org-id");

  if (!orgId) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <div className={styles.brand}>Levee Buddy</div>
          <h1 className={styles.heading}>Find your district</h1>
          <p className={styles.sub}>Enter your levee district&rsquo;s name or your email to go to its sign-in page.</p>
          <FindPortalForm rootDomain={ROOT_DOMAIN} />
          <p className={styles.notice}>
            Don&rsquo;t know it? Contact your district administrator, or <Link href="/">sign up a new district</Link>.
          </p>
        </div>
      </div>
    );
  }

  const person = await getCurrentPerson();
  if (person) redirect("/");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>Levee Buddy</div>
        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.sub}>{org.name}&rsquo;s portal</p>
        <LoginForm orgId={orgId} />
      </div>
    </div>
  );
}
