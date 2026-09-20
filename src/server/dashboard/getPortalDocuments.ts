import { prisma } from "@/server/db/client";

export interface DocumentRow {
  id: string;
  title: string;
  fileUrl: string;
  docTypeName: string;
  uploaderName: string | null;
  createdAt: Date;
}

export interface PriorYearGroup {
  year: number;
  docs: DocumentRow[];
}

export interface PortalDocumentsData {
  levee: { id: string; name: string; currentDocYear: number } | undefined;
  docTypes: { id: string; name: string }[];
  currentYearDocs: DocumentRow[];
  /** Descending by year - the most recently archived year first. */
  priorYears: PriorYearGroup[];
}

/**
 * The full document roster for one org's (first) levee - same multi-levee
 * simplification as getPortalHome/getPortalSensors. Fetches every document
 * once and splits it in memory by year rather than querying per-year, since
 * an org's total document count is nowhere near large enough to justify N
 * round trips just to let the page expand one prior year at a time.
 */
export async function getPortalDocuments(orgId: string): Promise<PortalDocumentsData> {
  const levee = await prisma.levee.findFirst({ where: { orgId } });
  if (!levee) {
    return { levee: undefined, docTypes: [], currentYearDocs: [], priorYears: [] };
  }

  const [docTypes, documents] = await Promise.all([
    prisma.documentType.findMany({ where: { orgId, enabled: true }, orderBy: { name: "asc" } }),
    prisma.document.findMany({
      where: { leveeId: levee.id },
      include: { docType: true, uploader: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const currentYearDocs: DocumentRow[] = [];
  const priorYearsByYear = new Map<number, DocumentRow[]>();

  for (const doc of documents) {
    const row: DocumentRow = {
      id: doc.id,
      title: doc.title,
      fileUrl: doc.fileUrl,
      docTypeName: doc.docType.name,
      uploaderName: doc.uploader?.name ?? null,
      createdAt: doc.createdAt,
    };

    if (doc.year === levee.currentDocYear) {
      currentYearDocs.push(row);
      continue;
    }

    const group = priorYearsByYear.get(doc.year);
    if (group) group.push(row);
    else priorYearsByYear.set(doc.year, [row]);
  }

  const priorYears = Array.from(priorYearsByYear.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, docs]) => ({ year, docs }));

  return {
    levee: { id: levee.id, name: levee.name, currentDocYear: levee.currentDocYear },
    docTypes: docTypes.map((docType) => ({ id: docType.id, name: docType.name })),
    currentYearDocs,
    priorYears,
  };
}
