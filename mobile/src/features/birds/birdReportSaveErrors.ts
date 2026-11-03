/** Pure helpers for bird report save cancel detection (no native imports). */

export class BirdReportSaveCancelledError extends Error {
  constructor(message = "Save cancelled — no folder was selected.") {
    super(message);
    this.name = "BirdReportSaveCancelledError";
  }
}

export function isBirdReportSaveCancelled(error: unknown): boolean {
  if (error instanceof BirdReportSaveCancelledError) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /cancel/i.test(msg);
}
