// Shared between actions.ts (a "use server" module, which can only export
// async functions - these constants can't live there) and the client
// component that renders the radius slider bound to them.
export const MIN_SEARCH_RADIUS_MILES = 100;
export const MAX_SEARCH_RADIUS_MILES = 500;
