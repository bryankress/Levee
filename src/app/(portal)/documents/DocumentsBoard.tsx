"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/time";
import type { DocumentRow, PriorYearGroup } from "@/server/dashboard/getPortalDocuments";
import { archiveYearAction, deleteDocumentAction } from "./actions";
import { UploadDocumentForm } from "./UploadDocumentForm";
import portalStyles from "../portal.module.css";
import styles from "./documents.module.css";

interface DocumentsBoardProps {
  leveeId: string;
  currentDocYear: number;
  currentYearDocs: DocumentRow[];
  priorYears: PriorYearGroup[];
  docTypes: { id: string; name: string }[];
  canDelete: boolean;
  isAdmin: boolean;
}

export function DocumentsBoard({
  leveeId,
  currentDocYear,
  currentYearDocs,
  priorYears,
  docTypes,
  canDelete,
  isAdmin,
}: DocumentsBoardProps) {
  const [expandedYear, setExpandedYear] = useState<number | undefined>(undefined);
  const expandedGroup = priorYears.find((group) => group.year === expandedYear);

  function handleArchiveSubmit(e: React.FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      `Archive ${currentDocYear}'s documents and start a clean slate for ${currentDocYear + 1}? ` +
        "Nothing is deleted - this year's documents just move into the archive below.",
    );
    if (!confirmed) e.preventDefault();
  }

  if (expandedGroup) {
    return (
      <div className={styles.boardLayout}>
        <div className={`${portalStyles.panel} ${styles.boardMain}`}>
          <div className={styles.expandedHead}>
            <h2>{expandedGroup.year} archive</h2>
            <button type="button" className={styles.closeBtn} onClick={() => setExpandedYear(undefined)}>
              Back to {currentDocYear}
            </button>
          </div>
          <DocumentTable docs={expandedGroup.docs} canDelete={canDelete} />
        </div>

        <YearStrip
          currentDocYear={currentDocYear}
          priorYears={priorYears}
          expandedYear={expandedYear}
          onToggle={setExpandedYear}
        />
      </div>
    );
  }

  return (
    <div className={styles.boardLayout}>
      <div className={styles.boardMain}>
        <UploadDocumentForm leveeId={leveeId} docTypes={docTypes} />

        <div className={portalStyles.panel}>
          <div className={styles.expandedHead}>
            <h2>{currentDocYear}</h2>
            {isAdmin && (
              <form action={archiveYearAction} onSubmit={handleArchiveSubmit}>
                <button type="submit" className={styles.archiveBtn}>
                  Archive {currentDocYear} &amp; start {currentDocYear + 1}
                </button>
              </form>
            )}
          </div>
          <DocumentTable docs={currentYearDocs} canDelete={canDelete} />
        </div>
      </div>

      <YearStrip
        currentDocYear={currentDocYear}
        priorYears={priorYears}
        expandedYear={expandedYear}
        onToggle={setExpandedYear}
      />
    </div>
  );
}

function DocumentTable({ docs, canDelete }: { docs: DocumentRow[]; canDelete: boolean }) {
  if (docs.length === 0) {
    return <div className={portalStyles.panelEmpty}>No documents here yet.</div>;
  }

  return (
    <div className={portalStyles.tableScroll}>
      <table className={portalStyles.sensors}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Uploaded by</th>
            <th>Date</th>
            {canDelete && <th></th>}
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td>
                <a href={doc.fileUrl} target="_blank" rel="noreferrer" className={styles.fileLink}>
                  {doc.title}
                </a>
              </td>
              <td>
                <span className={portalStyles.tagPill}>{doc.docTypeName}</span>
              </td>
              <td className={portalStyles.updated}>{doc.uploaderName ?? "—"}</td>
              <td className={portalStyles.updated}>{formatRelativeTime(doc.createdAt)}</td>
              {canDelete && (
                <td>
                  <form action={deleteDocumentAction.bind(null, doc.id)}>
                    <button type="submit" className={styles.deleteBtn}>
                      Delete
                    </button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YearStrip({
  currentDocYear,
  priorYears,
  expandedYear,
  onToggle,
}: {
  currentDocYear: number;
  priorYears: PriorYearGroup[];
  expandedYear: number | undefined;
  onToggle: (year: number | undefined) => void;
}) {
  if (priorYears.length === 0) {
    return (
      <div className={styles.yearStripEmpty}>
        No archived years yet - documents will appear here after you archive {currentDocYear}.
      </div>
    );
  }

  return (
    <div className={styles.yearStrip}>
      {priorYears.map((group) => {
        const isActive = group.year === expandedYear;
        return (
          <button
            key={group.year}
            type="button"
            className={`${styles.yearTile} ${isActive ? styles.yearTileActive : ""}`}
            onClick={() => onToggle(isActive ? undefined : group.year)}
            aria-expanded={isActive}
          >
            <div className={styles.yearNum}>
              {isActive ? "−" : "+"} {group.year}
            </div>
            <div className={styles.yearCount}>{group.docs.length} doc{group.docs.length === 1 ? "" : "s"}</div>
          </button>
        );
      })}
    </div>
  );
}
