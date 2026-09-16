"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SensorStreamRelation } from "@/server/discovery/sensorSearch";
import { searchSensorsAction, type MarketingSensor, type SearchState } from "./actions";
import { MAX_SEARCH_RADIUS_MILES, MIN_SEARCH_RADIUS_MILES } from "./searchConfig";
import styles from "./marketing.module.css";

const initialState: SearchState = {};

// The map-zoom slider's tightest view, independent of however wide the
// actual search radius is - "zoom into the cluster" without re-searching.
const MIN_VIEW_RADIUS_MILES = 10;

// The server's own hard cap is much higher (see SEARCH_TIMEOUT_MS in
// actions.ts) - this is just about not leaving the visitor staring at
// "Searching..." with zero feedback on an ordinarily-slower-than-usual
// request, well before anything has actually gone wrong.
const SLOW_SEARCH_MS = 8_000;

const RELATION_LABEL: Record<SensorStreamRelation, string> = {
  UPSTREAM: "Upstream",
  DOWNSTREAM: "Downstream",
};

function relationColor(relation: SensorStreamRelation | undefined): string {
  if (relation === "UPSTREAM") return "var(--brass)";
  if (relation === "DOWNSTREAM") return "var(--accent)";
  return "var(--ink-soft)";
}

/** A magnifying glass orbiting a small circle - the counter-rotation on the icon itself keeps it upright while it revolves. */
function SearchSpinner() {
  return (
    <span className={styles.spinner} aria-hidden="true">
      <svg viewBox="0 0 24 24" className={styles.spinnerIcon}>
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <line x1="14.8" y1="14.8" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// Standard Web Mercator tile math (the same projection every slippy map -
// Leaflet, Google Maps, OSM's own tile server - uses), so markers computed
// here line up pixel-for-pixel with the real OpenStreetMap tiles underneath.
const TILE_SIZE = 256;
const EQUATOR_CIRCUMFERENCE_METERS = 40_075_016.686;
const MILES_TO_METERS = 1609.34;
// The logical coordinate space the map is laid out in; actual rendered size
// is controlled by CSS (percentage-based positioning throughout), so this
// only affects how many tiles get fetched and the zoom-level math below.
const MAP_SIZE = 840; // 3x the original 280px radial diagram, per request

function lonToWorldX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToWorldY(lat: number, zoom: number): number {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * TILE_SIZE * 2 ** zoom;
}

function metersPerPixel(lat: number, zoom: number): number {
  return (EQUATOR_CIRCUMFERENCE_METERS * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom);
}

/** Picks a zoom level where the given radius, doubled for the full diameter plus padding, fits within MAP_SIZE. */
function zoomForRadius(centerLat: number, radiusMiles: number): number {
  const radiusMeters = radiusMiles * MILES_TO_METERS;
  const targetMetersPerPixel = (radiusMeters * 2.3) / MAP_SIZE;
  const zoom = Math.log2(metersPerPixel(centerLat, 0) / targetMetersPerPixel);
  return Math.min(15, Math.max(2, Math.floor(zoom)));
}

export function MarketingSearch() {
  const [state, formAction, pending] = useActionState(searchSensorsAction, initialState);
  const [selected, setSelected] = useState<Map<string, MarketingSensor>>(new Map());
  const [isSlow, setIsSlow] = useState(false);
  // The vertical slider's own live value - kept separate from state.radiusMiles
  // (the radius the *currently displayed* results actually used) so dragging
  // moves smoothly and a re-search only fires once the drag is released.
  const [sliderRadius, setSliderRadius] = useState(MIN_SEARCH_RADIUS_MILES);
  // The horizontal slider's view - a pure map-zoom, never sent to the server.
  const [viewRadiusMiles, setViewRadiusMiles] = useState(MIN_SEARCH_RADIUS_MILES);
  // Tracks the last search result the sliders were synced against - "adjust
  // state during render" (React's own recommended pattern for this, see
  // https://react.dev/learn/you-might-not-need-an-effect) rather than an
  // effect, since this is deriving state from a prop/state change, not
  // synchronizing with anything external.
  const [lastSynced, setLastSynced] = useState<{ zip?: string; radiusMiles?: number }>({});
  const router = useRouter();

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setIsSlow(true), SLOW_SEARCH_MS);
    return () => {
      clearTimeout(timer);
      setIsSlow(false);
    };
  }, [pending]);

  // Sync the sliders to whatever radius the results actually came back
  // with. The view-zoom slider only snaps back to "fully zoomed out" for a
  // genuinely new ZIP - a radius change on the same ZIP (widening the
  // search) shouldn't yank an already-zoomed-in view back out.
  if (state.radiusMiles !== undefined && (state.zip !== lastSynced.zip || state.radiusMiles !== lastSynced.radiusMiles)) {
    const isNewZip = state.zip !== lastSynced.zip;
    setLastSynced({ zip: state.zip, radiusMiles: state.radiusMiles });
    setSliderRadius(state.radiusMiles);
    if (isNewZip) setViewRadiusMiles(state.radiusMiles);
  }

  const sensors = state.sensors ?? [];
  const radiusMiles = state.radiusMiles ?? MIN_SEARCH_RADIUS_MILES;

  function toggleSensor(sensor: MarketingSensor) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(sensor.siteNo)) {
        next.delete(sensor.siteNo);
      } else {
        next.set(sensor.siteNo, sensor);
      }
      return next;
    });
  }

  function goToSignup() {
    const params = new URLSearchParams();
    if (state.zip) params.set("zip", state.zip);
    params.set("sites", JSON.stringify(Array.from(selected.values())));
    router.push(`/signup?${params.toString()}`);
  }

  function runSearch(zip: string, radius: number) {
    const formData = new FormData();
    formData.set("zip", zip);
    formData.set("radiusMiles", String(radius));
    startTransition(() => formAction(formData));
  }

  function commitRadiusChange() {
    if (!state.zip || sliderRadius === state.radiusMiles) return;
    runSearch(state.zip, sliderRadius);
  }

  const hasMap = sensors.length > 0 && state.centerLat !== undefined && state.centerLon !== undefined;

  return (
    <section className={hasMap ? styles.searchSectionWide : styles.searchSection}>
      <h2 className={styles.searchHeading}>Find the gauges near you</h2>

      <form action={formAction} className={styles.zipForm}>
        <input
          className={styles.zipInput}
          name="zip"
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          placeholder="ZIP code"
          aria-label="ZIP code"
          required
        />
        <input type="hidden" name="radiusMiles" value={sliderRadius} />
        <button className={styles.zipSubmit} type="submit" disabled={pending}>
          {pending ? (
            <>
              <SearchSpinner /> Searching…
            </>
          ) : (
            "Find gauges"
          )}
        </button>
      </form>

      {pending && isSlow && (
        <p className={styles.slowNotice}>
          Still searching — USGS can be slow to respond for some areas. Hang tight…
        </p>
      )}

      {state.error && (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      )}

      {state.sensors && (
        <div className={styles.results}>
          <p className={styles.resultsMeta}>
            {sensors.length === 0
              ? `No active USGS stream gauges within ${radiusMiles} miles of ${state.city}, ${state.state}.`
              : `${sensors.length} active USGS stream gauge${sensors.length === 1 ? "" : "s"} within ${radiusMiles} miles of ${state.city}, ${state.state} — nearest first, live from USGS.`}
          </p>

          {hasMap && (
            <>
              <div className={styles.mapLayout}>
                <div className={styles.radiusSliderCol}>
                  <span className={styles.sliderValue}>{sliderRadius} mi</span>
                  <input
                    className={styles.radiusSlider}
                    type="range"
                    aria-label="Search radius, in miles"
                    min={MIN_SEARCH_RADIUS_MILES}
                    max={MAX_SEARCH_RADIUS_MILES}
                    step={25}
                    value={sliderRadius}
                    onChange={(event) => setSliderRadius(Number(event.target.value))}
                    onMouseUp={commitRadiusChange}
                    onTouchEnd={commitRadiusChange}
                    onKeyUp={commitRadiusChange}
                  />
                  <span className={styles.sliderCaption}>search radius</span>
                </div>

                <div className={styles.mapCol}>
                  <div className={styles.mapWrap}>
                    <GeoMap
                      centerLat={state.centerLat!}
                      centerLon={state.centerLon!}
                      searchRadiusMiles={radiusMiles}
                      viewRadiusMiles={Math.min(viewRadiusMiles, radiusMiles)}
                      sensors={sensors}
                      selected={selected}
                      onToggle={toggleSensor}
                    />
                    {pending && (
                      <div className={styles.mapSearchingOverlay}>
                        <SearchSpinner /> Updating…
                      </div>
                    )}
                  </div>

                  <div className={styles.zoomSliderRow}>
                    <input
                      className={styles.zoomSlider}
                      type="range"
                      aria-label="Map zoom, in miles across"
                      min={MIN_VIEW_RADIUS_MILES}
                      max={radiusMiles}
                      step={5}
                      value={Math.min(viewRadiusMiles, radiusMiles)}
                      onChange={(event) => setViewRadiusMiles(Number(event.target.value))}
                    />
                    <span className={styles.sliderCaption}>
                      map zoom — {Math.min(viewRadiusMiles, radiusMiles)} mi view
                    </span>
                  </div>
                </div>
              </div>

              <ul className={styles.sensorList}>
                {sensors.map((sensor) => (
                  <li key={sensor.siteNo} className={styles.sensorRow}>
                    <label className={styles.sensorLabel}>
                      <input
                        type="checkbox"
                        checked={selected.has(sensor.siteNo)}
                        onChange={() => toggleSensor(sensor)}
                      />
                      <span className={styles.sensorNameCol}>
                        <span className={styles.sensorName}>{sensor.name || sensor.siteNo}</span>
                        {sensor.streamRelation && (
                          <span className={styles.relationTag}>
                            <span className={styles.relationDot} style={{ background: relationColor(sensor.streamRelation) }} />
                            {RELATION_LABEL[sensor.streamRelation]}
                          </span>
                        )}
                      </span>
                      <span className={styles.sensorMeta}>
                        {sensor.distanceMiles.toFixed(1)} mi
                        {sensor.stageFt !== undefined && ` · ${sensor.stageFt.toFixed(1)} ft gage height`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className={styles.tray}>
          <div className={styles.trayText}>
            {selected.size} sensor{selected.size === 1 ? "" : "s"} selected
          </div>
          <button className={styles.traySubmit} type="button" onClick={goToSignup}>
            Sign up to monitor these
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Real OpenStreetMap tiles behind the sensors, not an abstract radial
 * diagram - stitches together whichever standard {z}/{x}/{y} tiles cover a
 * MAP_SIZE x MAP_SIZE viewport centered on the search point, then places
 * markers and the search-radius ring using the same Mercator projection so
 * everything lines up with the map underneath. All positioning is in
 * percentages of the container, so the whole thing scales responsively
 * without recomputing anything on resize.
 */
function GeoMap({
  centerLat,
  centerLon,
  searchRadiusMiles,
  viewRadiusMiles,
  sensors,
  selected,
  onToggle,
}: {
  centerLat: number;
  centerLon: number;
  /** How far the actual search reached - draws the boundary ring, independent of how tightly the map is zoomed. */
  searchRadiusMiles: number;
  /** Pure map framing - how many miles across the visible view spans. Can be tighter than searchRadiusMiles. */
  viewRadiusMiles: number;
  sensors: MarketingSensor[];
  selected: Map<string, MarketingSensor>;
  onToggle: (sensor: MarketingSensor) => void;
}) {
  const zoom = useMemo(() => zoomForRadius(centerLat, viewRadiusMiles), [centerLat, viewRadiusMiles]);

  const centerWorldX = lonToWorldX(centerLon, zoom);
  const centerWorldY = latToWorldY(centerLat, zoom);
  const originX = centerWorldX - MAP_SIZE / 2;
  const originY = centerWorldY - MAP_SIZE / 2;

  const tiles = useMemo(() => {
    const tileCount = 2 ** zoom;
    const firstTileX = Math.floor(originX / TILE_SIZE);
    const firstTileY = Math.floor(originY / TILE_SIZE);
    const lastTileX = Math.floor((originX + MAP_SIZE) / TILE_SIZE);
    const lastTileY = Math.floor((originY + MAP_SIZE) / TILE_SIZE);

    const result: { key: string; leftPct: number; topPct: number; src: string }[] = [];
    for (let ty = firstTileY; ty <= lastTileY; ty++) {
      if (ty < 0 || ty >= tileCount) continue; // no tiles beyond the poles
      for (let tx = firstTileX; tx <= lastTileX; tx++) {
        const wrappedX = ((tx % tileCount) + tileCount) % tileCount; // wrap across the antimeridian
        result.push({
          key: `${zoom}-${tx}-${ty}`,
          leftPct: ((tx * TILE_SIZE - originX) / MAP_SIZE) * 100,
          topPct: ((ty * TILE_SIZE - originY) / MAP_SIZE) * 100,
          src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`,
        });
      }
    }
    return result;
  }, [zoom, originX, originY]);

  const ringRadiusPct = ((searchRadiusMiles * MILES_TO_METERS) / metersPerPixel(centerLat, zoom) / MAP_SIZE) * 100;

  return (
    <div className={styles.geoMap}>
      {tiles.map((tile) => (
        // Raw OSM tiles fetched straight from the visitor's browser - routing them
        // through Next's image optimizer would proxy every tile through this app's server.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tile.key}
          src={tile.src}
          alt=""
          className={styles.geoTile}
          style={{
            left: `${tile.leftPct}%`,
            top: `${tile.topPct}%`,
            width: `${(TILE_SIZE / MAP_SIZE) * 100}%`,
            height: `${(TILE_SIZE / MAP_SIZE) * 100}%`,
          }}
        />
      ))}

      <svg className={styles.geoOverlay} viewBox="0 0 100 100" preserveAspectRatio="none">
        <circle cx={50} cy={50} r={ringRadiusPct} className={styles.geoRing} vectorEffect="non-scaling-stroke" />
      </svg>

      {sensors.map((sensor) => {
        const leftPct = ((lonToWorldX(sensor.lon, zoom) - originX) / MAP_SIZE) * 100;
        const topPct = ((latToWorldY(sensor.lat, zoom) - originY) / MAP_SIZE) * 100;
        const isSelected = selected.has(sensor.siteNo);

        return (
          <button
            key={sensor.siteNo}
            type="button"
            className={isSelected ? styles.geoMarkerSelected : styles.geoMarker}
            style={{ left: `${leftPct}%`, top: `${topPct}%`, background: relationColor(sensor.streamRelation) }}
            onClick={() => onToggle(sensor)}
            aria-pressed={isSelected}
            title={`${sensor.name}${sensor.streamRelation ? ` — ${RELATION_LABEL[sensor.streamRelation]}` : ""} — ${sensor.distanceMiles.toFixed(1)} mi${sensor.stageFt !== undefined ? ` — ${sensor.stageFt.toFixed(1)} ft` : ""}`}
          />
        );
      })}

      <div className={styles.geoAttribution}>© OpenStreetMap contributors</div>
    </div>
  );
}
