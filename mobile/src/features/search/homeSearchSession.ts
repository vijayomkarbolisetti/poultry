/**
 * Temporary Home inline search draft. The Home screen clears it whenever it
 * loses focus, so a previous global search cannot reappear after navigation.
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
