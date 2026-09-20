"use client";

import { useActionState } from "react";
import { addDocumentTypeAction, removeDocumentTypeAction, type DocumentTypeActionState } from "./actions";
import styles from "./settings.module.css";

const initialState: DocumentTypeActionState = {};

export function DocumentTypesForm({ docTypes }: { docTypes: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addDocumentTypeAction, initialState);

  return (
    <div className={styles.section}>
      <h2>Document types</h2>
      <p className={styles.sectionHint}>
        What officials can file a document under on the Documents page. Removing one here only hides it from
        future uploads - documents already filed under it keep their label.
      </p>

      {docTypes.length === 0 ? (
        <p className={styles.sectionHint}>No document types yet - add one below.</p>
      ) : (
        <div className={styles.typeChips}>
          {docTypes.map((docType) => (
            <form key={docType.id} action={removeDocumentTypeAction.bind(null, docType.id)} className={styles.typeChip}>
              <span>{docType.name}</span>
              <button type="submit" className={styles.typeChipRemove} aria-label={`Remove ${docType.name}`}>
                ×
              </button>
            </form>
          ))}
        </div>
      )}

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}
      <form action={formAction} className={styles.addTypeRow}>
        <input name="name" type="text" placeholder="e.g. Inspection report" required />
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Adding…" : "Add type"}
        </button>
      </form>
    </div>
  );
}
