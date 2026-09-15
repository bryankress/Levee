// USGS Water Services - Instantaneous Values and Site Service.
// Public, unauthenticated REST API. Docs: https://waterservices.usgs.gov/docs/instantaneous-values/
const USGS_IV_URL = "https://waterservices.usgs.gov/nwis/iv/";
const USGS_SITE_URL = "https://waterservices.usgs.gov/nwis/site/";

// Sibling federal APIs (e.g. api.weather.gov) document rejecting requests
// with no identifying User-Agent; NWIS doesn't require one as strictly, but
// a generic Node/undici default is exactly the kind of client some
// gov-infrastructure WAFs rate-limit or block, especially from cloud-host IP
// ranges - identifying the app costs nothing and follows the same etiquette.
const USGS_USER_AGENT = "LeveeBuddy/1.0 (+https://leveebuddy.com)";

export const USGS_PARAM_CODES = {
  DISCHARGE_CFS: "00060",
  GAGE_HEIGHT_FT: "00065",
} as const;

export type UsgsParamCode =
  (typeof USGS_PARAM_CODES)[keyof typeof USGS_PARAM_CODES];

export interface UsgsReading {
  siteNo: string;
  paramCode: UsgsParamCode;
  timestamp: string;
  value: number;
  qualifiers: string[];
}

interface UsgsIvResponse {
  value?: {
    timeSeries?: Array<{
      sourceInfo: { siteCode: Array<{ value: string }> };
      variable: { variableCode: Array<{ value: string }> };
      values: Array<{
        value: Array<{ value: string; dateTime: string; qualifiers?: string[] }>;
      }>;
    }>;
  };
}

/**
 * Fetches the latest instantaneous readings for one or more USGS site numbers.
 * Returns one entry per (site, param, timestamp) reading actually present in the response -
 * a stale/offline site simply contributes nothing, rather than throwing.
 */
export async function fetchUsgsInstantaneousValues(
  siteNumbers: string[],
  paramCodes: UsgsParamCode[] = [
    USGS_PARAM_CODES.DISCHARGE_CFS,
    USGS_PARAM_CODES.GAGE_HEIGHT_FT,
  ],
): Promise<UsgsReading[]> {
  if (siteNumbers.length === 0) return [];

  const params = new URLSearchParams({ format: "json", siteStatus: "all" });
  // Appended as a raw string, not via searchParams.set(): URLSearchParams
  // percent-encodes the comma to %2C, and NWIS's legacy backend rejects
  // these list parameters when their commas arrive that way - confirmed by
  // a real HTTP 400 in production. Site numbers and param codes are plain
  // digit strings, so nothing else here needs encoding.
  const url = `${USGS_IV_URL}?${params.toString()}&sites=${siteNumbers.join(",")}&parameterCd=${paramCodes.join(",")}`;

  const res = await fetch(url, { headers: { "User-Agent": USGS_USER_AGENT } });
  // NWIS's real, documented behavior: a query that matches zero readings
  // comes back as HTTP 404, not an empty 200 - not a real failure, and
  // exactly the common case for a small or offline-heavy site list.
  if (res.status === 404) return [];
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(
      `USGS instantaneous-values request failed: ${res.status} ${res.statusText} - ${bodyText.slice(0, 500)}`,
    );
  }

  const body = (await res.json()) as UsgsIvResponse;
  return parseInstantaneousValues(body);
}

function parseInstantaneousValues(body: UsgsIvResponse): UsgsReading[] {
  const readings: UsgsReading[] = [];

  for (const series of body.value?.timeSeries ?? []) {
    const siteNo = series.sourceInfo.siteCode[0]?.value;
    const paramCode = series.variable.variableCode[0]?.value as UsgsParamCode | undefined;
    if (!siteNo || !paramCode) continue;

    for (const block of series.values ?? []) {
      for (const point of block.value ?? []) {
        const value = Number(point.value);
        if (!Number.isFinite(value)) continue;
        readings.push({
          siteNo,
          paramCode,
          timestamp: point.dateTime,
          value,
          qualifiers: point.qualifiers ?? [],
        });
      }
    }
  }

  return readings;
}

export interface UsgsSite {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
}

export interface UsgsBoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Finds stream sites within a bounding box - the zip-to-sensor discovery
 * flow's actual data source. Uses format=rdb rather than JSON: unlike the
 * instantaneous-values service, the site service's JSON support isn't
 * documented with the same confidence, while RDB (tab-delimited, comment
 * lines prefixed with #) has been NWIS's stable native format for decades.
 */
export async function fetchUsgsSitesInBoundingBox(
  bbox: UsgsBoundingBox,
  options: { siteType?: string } = {},
): Promise<UsgsSite[]> {
  const params = new URLSearchParams({
    format: "rdb",
    siteType: options.siteType ?? "ST",
    siteStatus: "active",
    hasDataTypeCd: "iv",
  });
  // Same reason as fetchUsgsInstantaneousValues's sites/parameterCd above:
  // bBox appended raw so its commas stay literal instead of being
  // percent-encoded, which NWIS's backend rejects with a 400.
  const url = `${USGS_SITE_URL}?${params.toString()}&bBox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;

  const res = await fetch(url, { headers: { "User-Agent": USGS_USER_AGENT } });
  // Same NWIS quirk as the instantaneous-values service: zero matching
  // sites comes back as HTTP 404, not an empty 200 - the common case for a
  // ZIP with few or no active stream gauges nearby, not a real failure.
  if (res.status === 404) return [];
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`USGS site-service request failed: ${res.status} ${res.statusText} - ${bodyText.slice(0, 500)}`);
  }

  return parseSitesRdb(await res.text());
}

function parseSitesRdb(text: string): UsgsSite[] {
  const lines = text.split("\n").filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length < 3) return [];

  const headers = lines[0].split("\t");
  const siteNoIdx = headers.indexOf("site_no");
  const nameIdx = headers.indexOf("station_nm");
  const latIdx = headers.indexOf("dec_lat_va");
  const lonIdx = headers.indexOf("dec_long_va");
  if (siteNoIdx === -1 || latIdx === -1 || lonIdx === -1) return [];

  const sites: UsgsSite[] = [];
  // lines[1] is the RDB format-width row (e.g. "5s\t15s\t..."), not data.
  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const siteNo = cols[siteNoIdx];
    const lat = Number(cols[latIdx]);
    const lon = Number(cols[lonIdx]);
    if (!siteNo || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    sites.push({ siteNo, name: cols[nameIdx] ?? "", lat, lon });
  }

  return sites;
}

// The historical_percentile condition type needs USGS's Statistics Service
// (calendar-day percentile distributions). That service's JSON support is
// inconsistent enough in the public docs that a parser here would be a guess
// rather than a verified implementation - deferred until it can be checked
// against a live response instead of assumed.
