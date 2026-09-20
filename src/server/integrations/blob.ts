import { del } from "@vercel/blob";

/**
 * Best-effort delete of an uploaded document's underlying blob. Documents
 * are always uploaded directly from the browser (see the upload-token route
 * handler), so this is the only server-side touch point this integration
 * needs - callers are expected to swallow failures themselves (a storage
 * hiccup shouldn't block removing the Document row, same reasoning as every
 * other best-effort external call in this app).
 */
export async function deleteBlob(url: string): Promise<void> {
  await del(url);
}
