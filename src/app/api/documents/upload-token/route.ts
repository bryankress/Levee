import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requirePerson } from "@/server/auth/currentPerson";
import { prisma } from "@/server/db/client";

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface UploadClientPayload {
  leveeId: string;
  docTypeId: string;
}

/**
 * The one Route Handler in the app - everything else is a Server Action, but
 * @vercel/blob's client-side `upload()` needs an HTTP endpoint to fetch a
 * short-lived upload token from before it starts streaming bytes straight to
 * Blob storage. `onUploadCompleted` is deliberately a no-op: that webhook
 * isn't reliably delivered against `next dev` without a public tunnel, so
 * the actual Document row is created by the client explicitly calling
 * createDocumentAction right after `upload()` resolves - a path that works
 * the same in dev and prod since it never depends on Vercel calling back
 * into this app.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayloadRaw) => {
        const person = await requirePerson();
        const payload = parseClientPayload(clientPayloadRaw);

        const levee = await prisma.levee.findFirst({ where: { id: payload.leveeId, orgId: person.orgId } });
        if (!levee) throw new Error("Levee not found for this organization.");

        const docType = await prisma.documentType.findFirst({
          where: { id: payload.docTypeId, orgId: person.orgId },
        });
        if (!docType) throw new Error("Document type not found for this organization.");

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload token request failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function parseClientPayload(raw: string | null): UploadClientPayload {
  if (!raw) throw new Error("Missing upload metadata.");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.leveeId !== "string" || typeof parsed.docTypeId !== "string") {
    throw new Error("Invalid upload metadata.");
  }
  return { leveeId: parsed.leveeId, docTypeId: parsed.docTypeId };
}
