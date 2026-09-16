// Shared between actions.ts (a "use server" module, which can only export
// async functions - these constants can't live there) and every client
// component that renders a radius slider bound to them (the marketing
// search and the portal's "add sensor" search alike).
export const MIN_SEARCH_RADIUS_MILES = 100;
export const MAX_SEARCH_RADIUS_MILES = 500;
