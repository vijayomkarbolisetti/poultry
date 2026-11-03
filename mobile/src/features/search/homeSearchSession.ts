/**
 * Persists the Home inline search draft across brief navigations
 * (e.g. open bird profile, then return to Home).
 */

let draft = "";

export function getHomeSearchDraft(): string {
  return draft;
}

export function setHomeSearchDraft(value: string): void {
  draft = value;
}

export function clearHomeSearchDraft(): void {
  draft = "";
}
