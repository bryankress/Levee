"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { createDocumentAction } from "./actions";
import styles from "./documents.module.css";

interface UploadDocumentFormProps {
  leveeId: string;
  docTypes: { id: string; name: string }[];
}

const LAST_TYPE_KEY_PREFIX = "leveebuddy:lastDocType:";

/**
 * Deliberately accepts a whole batch of files at once - the archival use
 * case is "digitize a box of old paper," not "upload one document." Every
 * selected file gets its own Document row under the one doc type chosen for
 * the batch; each file's own name becomes its title unless exactly one file
 * is selected and a custom title is typed.
 *
 * The type <select> is uncontrolled (defaultValue, read via ref at submit
 * time) specifically so its initial value can come from localStorage - a
 * browser-only API a server-rendered value can't see - without React
 * treating that server/client difference as a hydration mismatch the way it
 * would for a controlled `value`.
 */
export function UploadDocumentForm({ leveeId, docTypes }: UploadDocumentFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typeSelectRef = useRef<HTMLSelectElement>(null);
  const lastTypeKey = `${LAST_TYPE_KEY_PREFIX}${leveeId}`;

  const [title, setTitle] = useState("");
  const [fileCount, setFileCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  if (docTypes.length === 0) {
    return (
      <div className={styles.uploadForm}>
        <h2>Upload documents</h2>
        <p className={styles.hint}>
          No document types are set up yet - add at least one from Settings before uploading.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = fileInputRef.current?.files;
    const docTypeId = typeSelectRef.current?.value;
    if (!files || files.length === 0) {
      setError("Choose at least one file to upload.");
      return;
    }
    if (!docTypeId) {
      setError("Choose a document type.");
      return;
    }

    setPending(true);
    setError(undefined);

    let failureCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`Uploading ${i + 1} of ${files.length}…`);

      try {
        const blob = await upload(`documents/${leveeId}/${file.name}`, file, {
          access: "public",
          handleUploadUrl: "/api/documents/upload-token",
          clientPayload: JSON.stringify({ leveeId, docTypeId }),
        });

        const fileTitle = files.length === 1 && title.trim() ? title.trim() : stripExtension(file.name);
        const result = await createDocumentAction({ leveeId, docTypeId, title: fileTitle, fileUrl: blob.url });
        if (result.error) failureCount++;
      } catch {
        failureCount++;
      }
    }

    setProgress(undefined);
    setPending(false);

    if (failureCount > 0) {
      setError(
        failureCount === files.length
          ? "Upload failed - nothing was saved."
          : `${failureCount} of ${files.length} file(s) failed to upload.`,
      );
    }

    try {
      window.localStorage.setItem(lastTypeKey, docTypeId);
    } catch {
      // localStorage unavailable - not worth failing the upload over.
    }
    setTitle("");
    setFileCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.refresh();
  }

  return (
    <form className={styles.uploadForm} onSubmit={handleSubmit}>
      <h2>Upload documents</h2>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="docFiles">File(s)</label>
          <input
            id="docFiles"
            ref={fileInputRef}
            type="file"
            multiple
            required
            accept=".pdf,.png,.jpg,.jpeg,.heic,.tiff,.doc,.docx"
            onChange={(e) => setFileCount(e.target.files?.length ?? 0)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="docType">Type</label>
          <select id="docType" ref={typeSelectRef} defaultValue={readLastDocType(lastTypeKey, docTypes)}>
            {docTypes.map((docType) => (
              <option key={docType.id} value={docType.id}>
                {docType.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="docTitle">
            Title <span className={styles.hint}>(optional{fileCount > 1 ? " - ignored for multiple files" : ""})</span>
          </label>
          <input
            id="docTitle"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Defaults to the file name"
            disabled={fileCount > 1}
          />
        </div>
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </button>
        {progress && <span className={styles.pendingNote}>{progress}</span>}
      </div>
    </form>
  );
}

/**
 * Only ever called during render to compute an uncontrolled defaultValue -
 * safe to differ between server and client since defaultValue isn't part of
 * React's hydration comparison.
 */
function readLastDocType(key: string, docTypes: { id: string }[]): string {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && docTypes.some((docType) => docType.id === stored)) return stored;
    } catch {
      // localStorage unavailable - fall through to the default.
    }
  }
  return docTypes[0]?.id ?? "";
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(0, idx) : filename;
}
