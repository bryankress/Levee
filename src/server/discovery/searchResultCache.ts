interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// River stage data only updates every 15-60 minutes at the source, so a
// 45-second cache is imperceptible to any real visitor while collapsing
// duplicate USGS/NLDI round trips when several people search the same
// popular ZIP within the same minute - exactly the traffic pattern most
// likely during an actual flood event, when responsiveness matters most.
const TTL_MS = 45_000;

// Per Node process, not shared across horizontally-scaled instances - a
// miss on one instance can still be a fresh hit on another. That's fine
// here: the goal is cutting duplicate load on USGS/NLDI, not guaranteeing
// one single shared cache.
const cache = new Map<string, CacheEntry<unknown>>();

export function getCachedSearch<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function setCachedSearch<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}
