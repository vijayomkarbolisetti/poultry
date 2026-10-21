/**
 * Expo Router may return search params as `string | string[]`.
 * Passing an array into API paths or React Query keys causes wrong URLs / cache misses
 * (e.g. create shed → detail shows "not found" or another shed's stale cache).
 */
export function firstRouteParam(
  value: string | string[] | undefined | null,
): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim().length > 0);
    return first?.trim() || undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}
