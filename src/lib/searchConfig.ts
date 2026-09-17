// Shared between actions.ts (a "use server" module, which can only export
// async functions - these constants can't live there) and every client
// component that renders a radius slider bound to them (the marketing
// search and the portal's "add sensor" search alike).
// A local levee team's first result should be local: 100mi as a starting
// (and minimum) radius routinely pulled in gauges from a neighboring river
// basin with no bearing on their levee. 25mi still expands out to 500mi via
// the slider - this only changes where that slider (and the first search,
// before anyone's touched it) starts.
export const MIN_SEARCH_RADIUS_MILES = 25;
export const MAX_SEARCH_RADIUS_MILES = 500;
