import type { Metadata } from "next";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { getPortalDocuments } from "@/server/dashboard/getPortalDocuments";
import { DocumentsBoard } from "./DocumentsBoard";
import portalStyles from "../portal.module.css";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const person = await getCurrentPerson();
  if (!person) return null; // the layout already redirects; this satisfies the type checker

  const { levee, docTypes, currentYearDocs, priorYears } = await getPortalDocuments(person.orgId);
  const isAdmin = person.role === "ADMIN";
  const canDelete = isAdmin || person.canDeleteDocuments;

  return (
    <div>
      <div className={portalStyles.pageHeader}>
        <div>
          <h1>Documents</h1>
          {levee && <div className={portalStyles.meta}>{levee.name}</div>}
        </div>
      </div>

      {!levee ? (
        <div className={portalStyles.panel}>
          <div className={portalStyles.panelEmpty}>No levee is set up for this organization yet.</div>
        </div>
      ) : (
        <DocumentsBoard
          leveeId={levee.id}
          currentDocYear={levee.currentDocYear}
          currentYearDocs={currentYearDocs}
          priorYears={priorYears}
          docTypes={docTypes}
          canDelete={canDelete}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
