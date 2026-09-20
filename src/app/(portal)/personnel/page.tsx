import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { getPortalPersonnel, type PersonnelRow } from "@/server/dashboard/getPortalPersonnel";
import { PLAN_LABEL } from "@/lib/plans";
import { PersonnelForm } from "./PersonnelForm";
import { removePersonAction, updateDocumentPermissionAction, updateRoleAction } from "./actions";
import portalStyles from "../portal.module.css";
import styles from "./personnel.module.css";

export const metadata: Metadata = { title: "Personnel" };

export default async function PersonnelPage() {
  const person = await getCurrentPerson();
  if (!person) return null; // the layout already redirects; this satisfies the type checker

  const { roster, adminCount, plan, contactCap } = await getPortalPersonnel(person.orgId);
  const isAdmin = person.role === "ADMIN";
  const atCap = contactCap !== null && roster.length >= contactCap;

  return (
    <div>
      <div className={portalStyles.pageHeader}>
        <div>
          <h1>Personnel</h1>
          <div className={portalStyles.meta}>
            {roster.length} on the roster
            {contactCap !== null && ` of ${contactCap} (${PLAN_LABEL[plan]} plan)`}
          </div>
        </div>
      </div>

      {isAdmin && atCap && (
        <div className={portalStyles.alert}>
          <div className={portalStyles.stripe} />
          <div>
            The <b>{PLAN_LABEL[plan]}</b> plan is limited to {contactCap} contacts. Remove someone, or{" "}
            <Link href="/settings">upgrade from Settings</Link> to add more.
          </div>
        </div>
      )}

      {isAdmin && !atCap && <PersonnelForm />}

      <div className={portalStyles.panel}>
        <div className={portalStyles.tableScroll}>
          <table className={portalStyles.sensors}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Role</th>
                <th>SMS consent</th>
                <th>Portal access</th>
                <th>Delete docs</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => (
                <PersonnelRowView
                  key={row.id}
                  row={row}
                  isAdmin={isAdmin}
                  isSelf={row.id === person.id}
                  adminCount={adminCount}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PersonnelRowView({
  row,
  isAdmin,
  isSelf,
  adminCount,
}: {
  row: PersonnelRow;
  isAdmin: boolean;
  isSelf: boolean;
  adminCount: number;
}) {
  // The last remaining admin can't be demoted or removed - the roster always
  // needs someone able to manage it.
  const isLastAdmin = row.role === "ADMIN" && adminCount <= 1;
  const canEdit = isAdmin && !isSelf && !isLastAdmin;

  return (
    <tr>
      <td>
        {row.name}
        {isSelf && <span className={styles.you}>YOU</span>}
      </td>
      <td className={portalStyles.updated}>{row.email}</td>
      <td className={portalStyles.updated}>{row.phone ?? "—"}</td>
      <td>
        {canEdit ? (
          <form action={updateRoleAction} className={styles.roleForm}>
            <input type="hidden" name="personId" value={row.id} />
            <select name="role" defaultValue={row.role} className={styles.roleSelect}>
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button type="submit" className={styles.saveRoleBtn}>
              Save
            </button>
          </form>
        ) : (
          <span>{row.role === "ADMIN" ? "Admin" : "Member"}</span>
        )}
      </td>
      <td>
        <span className={row.smsConsentAt ? styles.consentYes : styles.consentNo}>
          {row.smsConsentAt ? "Yes" : "No"}
        </span>
      </td>
      <td>
        <span className={row.hasPortalAccess ? styles.accessYes : styles.accessNo}>
          {row.hasPortalAccess ? "Can sign in" : "Roster only"}
        </span>
      </td>
      <td>
        {row.role === "ADMIN" ? (
          <span className={portalStyles.updated}>Always</span>
        ) : isAdmin ? (
          <form action={updateDocumentPermissionAction} className={styles.roleForm}>
            <input type="hidden" name="personId" value={row.id} />
            <label className={styles.checkboxRow}>
              <input type="checkbox" name="canDeleteDocuments" defaultChecked={row.canDeleteDocuments} />
            </label>
            <button type="submit" className={styles.saveRoleBtn}>
              Save
            </button>
          </form>
        ) : (
          <span className={row.canDeleteDocuments ? styles.accessYes : styles.accessNo}>
            {row.canDeleteDocuments ? "Yes" : "No"}
          </span>
        )}
      </td>
      {isAdmin && (
        <td>
          {!isSelf && !isLastAdmin && (
            <form action={removePersonAction.bind(null, row.id)}>
              <button type="submit" className={styles.removeBtn}>
                Remove
              </button>
            </form>
          )}
        </td>
      )}
    </tr>
  );
}
