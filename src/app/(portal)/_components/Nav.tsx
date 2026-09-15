"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../portal.module.css";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Home",
    icon: <path d="M3 10l7-6 7 6M5 8.5V17h10V8.5" />,
  },
  {
    href: "/sensors",
    label: "Sensors",
    icon: <path d="M3 15l4-6 4 3 3-7 3 10" />,
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: (
      <>
        <rect x="3" y="4" width="14" height="13" rx="1" />
        <path d="M3 8h14M7 2v4M13 2v4" />
      </>
    ),
  },
  {
    href: "/personnel",
    label: "Personnel",
    icon: (
      <>
        <circle cx="10" cy="7" r="3" />
        <path d="M4 17c0-3 3-5 6-5s6 2 6 5" />
      </>
    ),
  },
  {
    href: "/documents",
    label: "Documents",
    icon: (
      <>
        <path d="M6 2h6l3 3v13H6z" />
        <path d="M12 2v3h3" />
      </>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <>
        <circle cx="10" cy="10" r="2.6" />
        <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.4 1.4M13.6 13.6L15 15M15 5l-1.4 1.4M6.4 13.6L5 15" />
      </>
    ),
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              {item.icon}
            </svg>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
