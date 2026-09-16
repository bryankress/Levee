"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { searchSensorsAction, type MarketingSensor, type SearchState } from "@/app/marketing/actions";
import { MAX_SEARCH_RADIUS_MILES, MIN_SEARCH_RADIUS_MILES } from "@/lib/searchConfig";
import type { SensorStreamRelation } from "@/server/discovery/sensorSearch";
import styles from "./sensorSearch.module.css";

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

// Marker size/opacity fade by distance from the search center - nearest
// sensors read as prominent, farthest fade toward the edge of relevance,
// without needing a second color scale on top of the upstream/downstream one.
const NEAR_MARKER_PX = 20;
const FAR_MARKER_PX = 9;
const FAR_MARKER_OPACITY = 0.55;
const SELECTED_MARKER_BOOST_PX = 6;

function distanceFraction(distanceMiles: number, searchRadiusMiles: number): number {
  return Math.min(1, distanceMiles / Math.max(searchRadiusMiles, 1));
}

function markerSizePx(distanceMiles: number, searchRadiusMiles: number, selected: boolean): number {
  const t = distanceFraction(distanceMiles, searchRadiusMiles);
  const base = NEAR_MARKER_PX - t * (NEAR_MARKER_PX - FAR_MARKER_PX);
  return selected ? base + SELECTED_MARKER_BOOST_PX : base;
}

function markerOpacity(distanceMiles: number, searchRadiusMiles: number): number {
  const t = distanceFraction(distanceMiles, searchRadiusMiles);
  return 1 - t * (1 - FAR_MARKER_OPACITY);
}

/**
 * The same triangle USGS's own National Water Dashboard uses to mark
 * streamgages - not an invented glyph, the actual convention for exactly
 * this kind of point on exactly this kind of map.
 */
function GaugeMarkerIcon({ color, selected }: { color: string; selected: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={styles.markerIcon} aria-hidden="true">
      {selected && (
        <polygon points="12,1 23,21.5 1,21.5" fill="none" stroke="var(--high)" strokeWidth="1.6" strokeLinejoin="round" />
      )}
      <polygon points="12,4 20.5,19.5 3.5,19.5" fill={color} stroke="var(--paper-raised)" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="12" cy="15.8" r="1.3" fill="var(--paper-raised)" />
    </svg>
  );
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

/** An hourglass that continuously flips end over end, for the map's own re-search overlay. */
function TumblingHourglass() {
  return (
    <span className={styles.hourglass} aria-hidden="true">
      <svg viewBox="0 0 24 24" className={styles.hourglassIcon}>
        <path
          d="M6 2.5h12M6 21.5h12M7 2.5c0 5 4.5 6 5 8.5-.5 2.5-5 3.5-5 8.5M17 2.5c0 5-4.5 6-5 8.5.5 2.5 5 3.5 5 8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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

/** The raw (fractional) zoom level for a given radius - no rounding, since this drives a smooth CSS scale rather than picking which tiles to fetch. */
function continuousZoomForRadius(centerLat: number, radiusMiles: number): number {
  const radiusMeters = radiusMiles * MILES_TO_METERS;
  const targetMetersPerPixel = (radiusMeters * 2.3) / MAP_SIZE;
  const zoom = Math.log2(metersPerPixel(centerLat, 0) / targetMetersPerPixel);
  return Math.min(15, Math.max(2, zoom));
}

/** Picks the integer tile zoom level to actually fetch imagery for - floored, since OSM only serves whole zoom levels. */
function zoomForRadius(centerLat: number, radiusMiles: number): number {
  return Math.floor(continuousZoomForRadius(centerLat, radiusMiles));
}

export interface SensorSearchPanelProps {
  /** Text on the submit button while idle - defaults to "Find sensors". */
  submitLabel?: string;
  /** Sensors the visitor has newly picked in this search session - owned by the parent, since what "confirm" does with them differs by context (sign up vs. add to an existing district). */
  selected: Map<string, MarketingSensor>;
  onToggle: (sensor: MarketingSensor) => void;
  /** Site numbers already in the current district's inventory - shown checked and locked rather than as an error, since re-searching an already-covered area is expected. Not part of `selected`. */
  alreadyOwnedSiteNos?: ReadonlySet<string>;
  /** Fires whenever the map/results become visible or hide - the panel owns its own search state, so this is how a parent that sizes itself around "are results showing yet" (e.g. a narrow-vs-wide card) finds out. Safe to pass a useState setter directly. */
  onResultsVisibleChange?: (visible: boolean) => void;
  /** Fires with the ZIP a completed search actually used - the panel owns the zip input, so this is how a parent that wants it (e.g. to carry it into a signup link) gets it. Safe to pass a useState setter directly. */
  onSearchedZipChange?: (zip: string | undefined) => void;
}

export function SensorSearchPanel({
  submitLabel = "Find sensors",
  selected,
  onToggle,
  alreadyOwnedSiteNos,
  onResultsVisibleChange,
  onSearchedZipChange,
}: SensorSearchPanelProps) {
  const [state, formAction, pending] = useActionState(searchSensorsAction, initialState);
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
  // The ZIP field must be controlled - React resets uncontrolled fields in
  // an action-bound <form> back to empty once the action completes, which
  // silently blocked every slider-triggered requestSubmit() behind native
  // "please fill out this field" validation (no error surfaced, no re-search).
  const [zipValue, setZipValue] = useState("");
  // The full list is hidden by default - the map plus its markers already
  // shows the shape of the results; the list is a detail view, not the
  // primary read.
  const [showList, setShowList] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setIsSlow(true), SLOW_SEARCH_MS);
    return () => {
      clearTimeout(timer);
      setIsSlow(false);
    };
  }, [pending]);

  // Recenters the map in the viewport every time a search actually
  // completes with results - useActionState hands back a new `state` object
  // identity on each completed action, so this fires once per finished
  // search (including a slider-triggered re-search), not on every render.
  useEffect(() => {
    if (state.sensors && state.sensors.length > 0) {
      mapWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state]);

  // Sync the sliders to whatever radius the results actually came back
  // with. The view-zoom slider only snaps back to "fully zoomed out" for a
  // genuinely new ZIP - a radius change on the same ZIP (widening the
  // search) shouldn't yank an already-zoomed-in view back out. The list
  // re-collapses only for a genuinely new ZIP too, matching the zoom reset.
  if (state.radiusMiles !== undefined && (state.zip !== lastSynced.zip || state.radiusMiles !== lastSynced.radiusMiles)) {
    const isNewZip = state.zip !== lastSynced.zip;
    setLastSynced({ zip: state.zip, radiusMiles: state.radiusMiles });
    setSliderRadius(state.radiusMiles);
    if (isNewZip) {
      setViewRadiusMiles(state.radiusMiles);
      setShowList(false);
    }
    if (state.zip !== undefined) setZipValue(state.zip);
  }

  // Memoized so its reference is stable across renders when state.sensors
  // hasn't changed - otherwise the `?? []` fallback hands mapSensors' own
  // useMemo a fresh empty array every render, defeating its memoization.
  const sensors = useMemo(() => state.sensors ?? [], [state.sensors]);
  const radiusMiles = state.radiusMiles ?? MIN_SEARCH_RADIUS_MILES;

  // Re-submits the actual <form> (same code path as a normal button click),
  // rather than constructing FormData and invoking the action function
  // directly - useActionState's dispatcher is meant to be driven through a
  // real form submission, and calling it out-of-band was the cause of a
  // real bug (the whole page reset back to its initial state on a slider
  // change, as if it had been freshly navigated to).
  function commitRadiusChange() {
    if (!state.zip || sliderRadius === state.radiusMiles) return;
    formRef.current?.requestSubmit();
  }

  const hasMap = sensors.length > 0 && state.centerLat !== undefined && state.centerLon !== undefined;
  // Downstream sensors already passed the levee, so they add no advance
  // warning here - real upstream/downstream comes from NLDI's river-network
  // navigation (not a guess), so this is a real filter, not a heuristic one.
  // They stay selectable in the full list below; only the map graphic hides them.
  const mapSensors = useMemo(() => sensors.filter((sensor) => sensor.streamRelation !== "DOWNSTREAM"), [sensors]);

  useEffect(() => {
    onResultsVisibleChange?.(hasMap);
  }, [hasMap, onResultsVisibleChange]);

  useEffect(() => {
    onSearchedZipChange?.(state.zip);
  }, [state.zip, onSearchedZipChange]);

  return (
    <>
      <form ref={formRef} action={formAction} className={styles.zipForm}>
        <input
          className={styles.zipInput}
          name="zip"
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          placeholder="ZIP code"
          aria-label="ZIP code"
          value={zipValue}
          onChange={(event) => setZipValue(event.target.value)}
          required
        />
        <input type="hidden" name="radiusMiles" value={sliderRadius} />
        <button className={styles.zipSubmit} type="submit" disabled={pending}>
          {pending ? (
            <>
              <SearchSpinner /> Searching…
            </>
          ) : (
            submitLabel
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
              ? `No active USGS stream sensors within ${radiusMiles} miles of ${state.city}, ${state.state}.`
              : `Live from the USGS, ${sensors.length} active sensor${sensors.length === 1 ? "" : "s"} closest to ${state.city}, ${state.state}.`}
          </p>

          {sensors.length > 0 && (
            <p className={styles.resultsInstruction}>Click to select the sensors that impact your levee.</p>
          )}

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
                  <div className={styles.mapWrap} ref={mapWrapRef}>
                    <div className={styles.mapFadeable} style={{ opacity: pending ? 0.2 : 1 }}>
                      <GeoMap
                        centerLat={state.centerLat!}
                        centerLon={state.centerLon!}
                        searchRadiusMiles={radiusMiles}
                        viewRadiusMiles={Math.min(viewRadiusMiles, radiusMiles)}
                        sensors={mapSensors}
                        selected={selected}
                        alreadyOwnedSiteNos={alreadyOwnedSiteNos}
                        onToggle={onToggle}
                      />
                    </div>
                    {pending && <TumblingHourglass />}
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

              <button type="button" className={styles.listToggle} onClick={() => setShowList((v) => !v)}>
                {showList ? "Hide list ▲" : `Show all ${sensors.length} sensors ▾`}
              </button>

              {showList && (
                <ul className={styles.sensorList}>
                  {sensors.map((sensor) => {
                    const isOwned = alreadyOwnedSiteNos?.has(sensor.siteNo) ?? false;
                    const isChecked = isOwned || selected.has(sensor.siteNo);

                    return (
                      <li key={sensor.siteNo} className={styles.sensorRow}>
                        <label className={isOwned ? `${styles.sensorLabel} ${styles.sensorLabelLocked}` : styles.sensorLabel}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isOwned}
                            onChange={() => onToggle(sensor)}
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
                          {isOwned && <span className={styles.ownedTag}>Already added</span>}
                          <span className={styles.sensorMeta}>
                            {sensor.distanceMiles.toFixed(1)} mi
                            {sensor.stageFt !== undefined && ` · ${sensor.stageFt.toFixed(1)} ft gage height`}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </>
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
// How long the zoom slider has to sit still before new tiles are actually
// fetched for a crossed zoom level - long enough that a fast drag across
// several zoom levels only ever fetches the one it settles on, short enough
// that letting go of the slider still feels immediate.
const TILE_ZOOM_SETTLE_MS = 150;

function GeoMap({
  centerLat,
  centerLon,
  searchRadiusMiles,
  viewRadiusMiles,
  sensors,
  selected,
  alreadyOwnedSiteNos,
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
  alreadyOwnedSiteNos?: ReadonlySet<string>;
  onToggle: (sensor: MarketingSensor) => void;
}) {
  // Only this zoom level's tiles are ever actually fetched - everything else
  // (the slider being dragged, the map appearing to zoom in real time) is a
  // CSS transform on top of whichever tiles are already on screen, so moving
  // the slider never waits on the network. See `liveScale` below.
  const targetTileZoom = zoomForRadius(centerLat, viewRadiusMiles);
  const [tileZoom, setTileZoom] = useState(targetTileZoom);

  useEffect(() => {
    const timer = setTimeout(() => setTileZoom(targetTileZoom), TILE_ZOOM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [targetTileZoom]);

  // The zoom the slider is *actually* asking for right now, fractional and
  // instant - the gap between this and the committed tileZoom is exactly the
  // scale factor that makes the current tiles look like they're at the live
  // zoom, since every element below is positioned relative to the same
  // centered origin at every zoom level (a uniform scale about the box's own
  // center is mathematically identical to recomputing everything at the
  // fractional zoom directly).
  const liveZoom = continuousZoomForRadius(centerLat, viewRadiusMiles);
  const liveScale = 2 ** (liveZoom - tileZoom);

  const centerWorldX = lonToWorldX(centerLon, tileZoom);
  const centerWorldY = latToWorldY(centerLat, tileZoom);
  const originX = centerWorldX - MAP_SIZE / 2;
  const originY = centerWorldY - MAP_SIZE / 2;

  const tiles = useMemo(() => {
    const tileCount = 2 ** tileZoom;
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
          key: `${tileZoom}-${tx}-${ty}`,
          leftPct: ((tx * TILE_SIZE - originX) / MAP_SIZE) * 100,
          topPct: ((ty * TILE_SIZE - originY) / MAP_SIZE) * 100,
          src: `https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${ty}.png`,
        });
      }
    }
    return result;
  }, [tileZoom, originX, originY]);

  const ringRadiusPct = ((searchRadiusMiles * MILES_TO_METERS) / metersPerPixel(centerLat, tileZoom) / MAP_SIZE) * 100;

  return (
    <div className={styles.geoMap}>
      <div className={styles.geoScalable} style={{ transform: `scale(${liveScale})` }}>
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
          const leftPct = ((lonToWorldX(sensor.lon, tileZoom) - originX) / MAP_SIZE) * 100;
          const topPct = ((latToWorldY(sensor.lat, tileZoom) - originY) / MAP_SIZE) * 100;
          const isOwned = alreadyOwnedSiteNos?.has(sensor.siteNo) ?? false;
          const isSelected = isOwned || selected.has(sensor.siteNo);
          const sizePx = markerSizePx(sensor.distanceMiles, searchRadiusMiles, isSelected);

          return (
            <button
              key={sensor.siteNo}
              type="button"
              className={styles.geoMarker}
              disabled={isOwned}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${sizePx}px`,
                height: `${sizePx}px`,
                opacity: markerOpacity(sensor.distanceMiles, searchRadiusMiles),
                zIndex: Math.round(100 - sensor.distanceMiles),
              }}
              onClick={() => onToggle(sensor)}
              aria-pressed={isSelected}
              title={`${sensor.name}${isOwned ? " — already in your inventory" : ""}${sensor.streamRelation ? ` — ${RELATION_LABEL[sensor.streamRelation]}` : ""} — ${sensor.distanceMiles.toFixed(1)} mi${sensor.stageFt !== undefined ? ` — ${sensor.stageFt.toFixed(1)} ft` : ""}`}
            >
              <GaugeMarkerIcon color={relationColor(sensor.streamRelation)} selected={isSelected} />
            </button>
          );
        })}
      </div>

      <div className={styles.geoAttribution}>© OpenStreetMap contributors</div>
    </div>
  );
}
