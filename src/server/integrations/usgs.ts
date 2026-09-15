// USGS Water Services - Instantaneous Values.
// Public, unauthenticated REST API. Docs: https://waterservices.usgs.gov/docs/instantaneous-values/
const USGS_IV_URL = "https://waterservices.usgs.gov/nwis/iv/";

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

  const url = new URL(USGS_IV_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("sites", siteNumbers.join(","));
  url.searchParams.set("parameterCd", paramCodes.join(","));
  url.searchParams.set("siteStatus", "all");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`USGS instantaneous-values request failed: ${res.status} ${res.statusText}`);
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

// The historical_percentile condition type needs USGS's Statistics Service
// (calendar-day percentile distributions). That service's JSON support is
// inconsistent enough in the public docs that a parser here would be a guess
// rather than a verified implementation - deferred until it can be checked
// against a live response instead of assumed.
