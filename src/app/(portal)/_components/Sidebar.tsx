import type { Person } from "@/generated/prisma/client";
import { LeveeMark } from "@/components/brand/LeveeMark";
import { Nav } from "./Nav";
import styles from "../portal.module.css";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Sidebar({
  org,
  person,
}: {
  org: { name: string; subdomain: string };
  person: Person;
}) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>
        <LeveeMark />
        <span>Levee Buddy</span>
      </div>

      <Nav />

      <div className={styles.sidebarSpacer} />

      <div className={styles.orgInfo}>
        <div className={styles.name}>{org.name}</div>
        <div className={styles.sub}>{org.subdomain}.leveebuddy.com</div>
      </div>

      <div className={styles.user}>
        <div className={styles.avatar}>{initials(person.name)}</div>
        <div>
          <div className={styles.who}>{person.name}</div>
          <div className={styles.role}>{person.role === "ADMIN" ? "Admin" : "Member"}</div>
        </div>
      </div>
    </div>
  );
}
