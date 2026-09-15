import { redirect } from "next/navigation";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
import { Sidebar } from "./_components/Sidebar";
import styles from "./portal.module.css";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const person = await getCurrentPerson();
  if (!person) redirect("/login");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: person.orgId } });

  return (
    <div className={styles.app}>
      <Sidebar org={org} person={person} />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
