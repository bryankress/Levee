import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
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
        <p className={styles.notice}>
          This address doesn&rsquo;t have a levee district portal. Check the subdomain in the URL, or contact your
          district administrator for the right link.
        </p>
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
