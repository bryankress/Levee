"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { searchSensorsByKeywordAction, addSensorsAction } from "./actions";
import type { KeywordSensorMatch } from "@/server/discovery/keywordSearch";
import styles from "./keywordSensorSearch.module.css";

// Matches keywordSearch.ts's own MIN_QUERY_LENGTH - kept in sync here rather
// than imported, since that module is server-only and this is a client
// component; searching below this length would just come back empty anyway.
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

/**
 * The "+ Sensor" flow's keyword field: a direct name search for someone who
 * already knows the station they want (which might be nowhere near their
 * own levee's ZIP), independent of the map-based radius search next to it.
 * USGS matches are addable inline; CWMS matches are shown for visibility
 * only, same "not available to monitor yet" treatment as the map search -
 * no readings integration exists for them.
 */
export function KeywordSensorSearch({ existingSiteNos }: { existingSiteNos: string[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KeywordSensorMatch[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const [isOpen, setIsOpen] = useState(false);
  const [addingSiteNo, setAddingSiteNo] = useState<string | undefined>(undefined);
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const ownedSet = useMemo(() => new Set(existingSiteNos), [existingSiteNos]);
  // Guards against an older, slower request's response overwriting a newer
  // one's - the debounce alone doesn't prevent an in-flight request from
  // resolving out of order.
  const latestRequestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      // No setState here - a too-short query just means showDropdown below
      // stays false, so whatever's currently in results/loading/searchError
      // never renders. Bumping the ref (not state) still invalidates any
      // request already in flight from before the query got this short.
      latestRequestId.current++;
      return;
    }

    const requestId = ++latestRequestId.current;

    const timer = setTimeout(() => {
      setResults(undefined);
      setLoading(true);
      setSearchError(undefined);

      searchSensorsByKeywordAction(trimmed)
        .then((matches) => {
          if (latestRequestId.current !== requestId) return; // a newer query already superseded this one
          setResults(matches);
          setLoading(false);
        })
        .catch(() => {
          if (latestRequestId.current !== requestId) return;
          setSearchError("Search failed. Try again.");
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  function handleAdd(match: KeywordSensorMatch) {
    setAddError(undefined);
    setAddingSiteNo(match.siteNo);
    startTransition(async () => {
      const result = await addSensorsAction([{ siteNo: match.siteNo, name: match.name, lat: match.lat, lon: match.lon }]);
      setAddingSiteNo(undefined);
      if (result.error) setAddError(result.error);
    });
  }

  const showDropdown = isOpen && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className={styles.wrap}>
      <input
        className={styles.input}
        type="text"
        placeholder="Find a sensor by name…"
        aria-label="Find a sensor by name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
      />

      {showDropdown && (
        <div className={styles.dropdown}>
          {loading && <div className={styles.dropdownNotice}>Searching…</div>}
          {!loading && searchError && <div className={styles.dropdownError}>{searchError}</div>}
          {!loading && !searchError && results && results.length === 0 && (
            <div className={styles.dropdownNotice}>No matches found.</div>
          )}
          {!loading &&
            !searchError &&
            results?.map((match) => {
              const isCwms = match.source === "CWMS";
              const isOwned = !isCwms && ownedSet.has(match.siteNo);
              const isAdding = addingSiteNo === match.siteNo && pending;

              return (
                <div key={match.siteNo} className={styles.resultRow}>
                  <div className={styles.resultInfo}>
                    <span className={styles.resultName}>{match.name || match.siteNo}</span>
                    {isCwms && (
                      <span className={styles.resultTag}>
                        USACE{match.officeId ? ` (${match.officeId})` : ""}
                        {match.locationKind ? ` — ${match.locationKind}` : ""} · not available to monitor yet
                      </span>
                    )}
                  </div>
                  {!isCwms && (
                    <button
                      type="button"
                      className={styles.addBtn}
                      disabled={isOwned || isAdding}
                      onMouseDown={(event) => event.preventDefault()} // keeps the input focused so onBlur doesn't close this before the click registers
                      onClick={() => handleAdd(match)}
                    >
                      {isOwned ? "Added" : isAdding ? "Adding…" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          {addError && <div className={styles.dropdownError}>{addError}</div>}
        </div>
      )}
    </div>
  );
}
