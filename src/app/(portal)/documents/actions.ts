"use server";

import { revalidatePath } from "next/cache";
import { requirePerson, requireRole, ForbiddenError } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";
import { deleteBlob } from "@/server/integrations/blob";

export interface CreateDocumentInput {
  leveeId: string;
  docTypeId: string;
  title: string;
  fileUrl: string;
}

export interface CreateDocumentResult {
  error?: string;
}

/**
 * Called directly by the client right after @vercel/blob's upload() resolves
 * (see UploadDocumentForm) - not form-bound, since the file bytes never pass
 * through this server at all. Re-verifies everything the upload-token route
 * already checked rather than trusting the client-supplied ids a second time.
 */
export async function createDocumentAction(input: CreateDocumentInput): Promise<CreateDocumentResult> {
  const person = await requirePerson();

  const levee = await prisma.levee.findFirst({ where: { id: input.leveeId, orgId: person.orgId } });
  if (!levee) return { error: "Levee not found for this organization." };

  const docType = await prisma.documentType.findFirst({ where: { id: input.docTypeId, orgId: person.orgId } });
  if (!docType) return { error: "Document type not found for this organization." };

  const title = input.title.trim() || "Untitled document";

  await prisma.document.create({
    data: {
      leveeId: levee.id,
      docTypeId: docType.id,
      title,
      fileUrl: input.fileUrl,
      source: "UPLOAD",
      uploadedBy: person.id,
      year: levee.currentDocYear,
    },
  });

  revalidatePath("/documents");
  revalidatePath("/");
  return {};
}

/** Admins can always delete; everyone else needs canDeleteDocuments set on their Personnel record. */
export async function deleteDocumentAction(documentId: string): Promise<void> {
  const person = await requirePerson();
  if (person.role !== "ADMIN" && !person.canDeleteDocuments) {
    throw new ForbiddenError();
  }

  const document = await prisma.document.findFirst({
    where: { id: documentId, levee: { orgId: person.orgId } },
  });
  if (!document) return;

  // Best-effort - a storage hiccup shouldn't block clearing the DB row.
  try {
    await deleteBlob(document.fileUrl);
  } catch {
    // ignored
  }

  await prisma.document.delete({ where: { id: document.id } });
  revalidatePath("/documents");
}

/**
 * Folds the current levee-year's documents into the archive and starts a
 * clean slate - existing documents never move, this just bumps the pointer
 * new uploads and the "current year" view compare against.
 */
export async function archiveYearAction(): Promise<void> {
  const person = await requirePerson();
  requireRole(person, "ADMIN");

  const levee = await prisma.levee.findFirst({ where: { orgId: person.orgId } });
  if (!levee) return;

  await prisma.levee.updateMany({
    where: { id: levee.id, orgId: person.orgId },
    data: { currentDocYear: { increment: 1 } },
  });

  revalidatePath("/documents");
}
