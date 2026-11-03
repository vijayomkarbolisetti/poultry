import type { CohortKey, TransferBirdLike } from "./transferHelpers";

export type TransferBandedPayload = {
  mode: "banded";
  shedId: string;
  birdIds: string[];
  labels: string[];
  birds: TransferBirdLike[];
};

export type TransferUnbandedPayload = {
  mode: "unbanded";
  shedId: string;
  flockId: string;
  label: string;
  unbandedCount: number;
  key: CohortKey;
};

export type TransferPayload = TransferBandedPayload | TransferUnbandedPayload;

export type TransferSheetResume = {
  destShedId: string | null;
  quantity: string;
  effectiveDate: string;
};

/**
 * In-memory draft so Transfer can pause while Create Shed runs, then resume
 * on the source shed birds screen without duplicating create-shed logic.
 */
export type TransferDraft = TransferSheetResume & {
  payload: TransferPayload;
  /** Set after Create Shed succeeds — preferred destination when resuming. */
  preferDestShedId?: string | null;
};

let draft: TransferDraft | null = null;

export function saveTransferDraft(next: TransferDraft): void {
  draft = next;
}

export function peekTransferDraft(): TransferDraft | null {
  return draft;
}

/** Prefer the newly created shed when the transfer sheet resumes. */
export function markTransferDraftPreferDest(shedId: string): void {
  if (!draft) return;
  draft = { ...draft, preferDestShedId: shedId, destShedId: shedId };
}

export function clearTransferDraft(): void {
  draft = null;
}

/** Read and clear the draft (one-shot resume). */
export function consumeTransferDraft(): TransferDraft | null {
  const next = draft;
  draft = null;
  return next;
}

export function resumeFieldsFromDraft(d: TransferDraft): TransferSheetResume {
  return {
    destShedId: d.preferDestShedId ?? d.destShedId,
    quantity: d.quantity,
    effectiveDate: d.effectiveDate,
  };
}
