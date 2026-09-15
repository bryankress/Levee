import zipcodes from "zipcodes";
import type { LatLon } from "./geo";

export interface ZipCentroid extends LatLon {
  zip: string;
  city: string;
  state: string;
}

/** US ZIP centroid lookup, offline - no external geocoding call on the hot path. */
export function lookupZipCentroid(zip: string): ZipCentroid | undefined {
  const entry = zipcodes.lookup(zip);
  if (!entry) return undefined;

  return {
    zip: entry.zip,
    lat: entry.latitude,
    lon: entry.longitude,
    city: entry.city,
    state: entry.state,
  };
}
