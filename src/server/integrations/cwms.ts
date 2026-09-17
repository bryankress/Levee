// USACE Corps Water Management System (CWMS) Data API - office catalog and
// location discovery. Public, unauthenticated REST API for reads (confirmed
// live). Docs: https://github.com/USACE/cwms-data-api
//
// The API's own hosted docs (cwms-data-api.readthedocs.io) and Swagger UI
// (cwms-data.usace.army.mil/cwms-data/swagger-ui.html) both return an SPA
// shell rather than a machine-readable spec when fetched directly, and
// *.usace.army.mil is blocked from the dev sandbox that wrote this file -
// every shape below is confirmed instead against real production responses
// (three districts - NWDM, SWT, MVR - and the full offices catalog) pulled
// via Render's shell, not the SPA's own docs.
const CWMS_BASE_URL = "https://cwms-data.usace.army.mil/cwms-data";

export interface CwmsOffice {
  name: string;
  longName: string;
  /** "DIS" = an actual operating district (the real water-management offices) - confirmed against the full live offices list, distinct from "MSC"/"MSCR" (division/region), "FOA" (research labs), "HQ", and "UNK" (meta entries like "All CWMS Offices"). */
  type: string;
  reportsTo: string;
}

export interface CwmsLocation {
  officeId: string;
  name: string;
  publicName: string | undefined;
  description: string | undefined;
  lat: number;
  lon: number;
  /** e.g. "PROJECT" (a lock/dam/reservoir control point), "SITE" (could be a plain river gauge or a basin-level aggregate - no reliable way to tell those apart from this field alone), "EMBANKMENT" (the dam structure itself). Not exhaustively confirmed - shown as-is rather than translated into a guessed meaning. */
  locationKind: string | undefined;
  state: string | undefined;
  county: string | undefined;
}

export async function fetchCwmsOffices(signal?: AbortSignal): Promise<CwmsOffice[]> {
  const res = await fetch(`${CWMS_BASE_URL}/offices`, { signal });
  if (!res.ok) {
    throw new Error(`CWMS offices request failed: ${res.status} ${res.statusText}`);
  }
  return parseOffices(await res.json());
}

/**
 * Fetches one district office's location catalog. Confirmed live across
 * three real districts: every office's list mixes genuine river/reservoir
 * sites (real coordinates, a descriptive name) with placeholder/incomplete
 * rows (no coordinates, state "00", "Unknown County") - present in every
 * one of the three districts sampled, so parseLocations drops any entry
 * missing real coordinates rather than trying to otherwise identify them.
 */
export async function fetchCwmsLocations(officeId: string, signal?: AbortSignal): Promise<CwmsLocation[]> {
  const res = await fetch(`${CWMS_BASE_URL}/locations?office=${encodeURIComponent(officeId)}`, { signal });
  if (!res.ok) {
    throw new Error(`CWMS locations request failed for office ${officeId}: ${res.status} ${res.statusText}`);
  }
  return parseLocations(await res.json());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOffices(body: any): CwmsOffice[] {
  if (!Array.isArray(body)) return [];

  const offices: CwmsOffice[] = [];
  for (const entry of body) {
    if (typeof entry?.name !== "string" || typeof entry?.type !== "string") continue;
    offices.push({
      name: entry.name,
      longName: typeof entry["long-name"] === "string" ? entry["long-name"] : entry.name,
      type: entry.type,
      reportsTo: typeof entry["reports-to"] === "string" ? entry["reports-to"] : "",
    });
  }
  return offices;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLocations(body: any): CwmsLocation[] {
  if (!Array.isArray(body)) return [];

  const locations: CwmsLocation[] = [];
  for (const entry of body) {
    const lat = entry?.latitude;
    const lon = entry?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (typeof entry?.["office-id"] !== "string" || typeof entry?.name !== "string") continue;

    locations.push({
      officeId: entry["office-id"],
      name: entry.name,
      publicName: typeof entry["public-name"] === "string" ? entry["public-name"] : undefined,
      description: typeof entry.description === "string" ? entry.description : undefined,
      lat,
      lon,
      locationKind: typeof entry["location-kind"] === "string" ? entry["location-kind"] : undefined,
      state: typeof entry["state-initial"] === "string" ? entry["state-initial"] : undefined,
      county: typeof entry["county-name"] === "string" ? entry["county-name"] : undefined,
    });
  }
  return locations;
}
