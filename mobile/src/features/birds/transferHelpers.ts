/** Pure helpers for shed-centric transfer UI (no I/O). */

export type TransferFlockLike = {
  id: string;
  status: string;
  tracking_mode: string;
  hatch_date: string | null;
  estimated_age_days: number | null;
  age_reported_on?: string | null;
  dob_confidence?: string;
  unbanded_count: number;
  current_count: number;
  batch_code?: string;
};

export type TransferBirdLike = {
  id: string;
  flock_id: string;
  hatch_date: string | null;
  estimated_age_days: number | null;
  age_reported_on?: string | null;
  is_active: boolean;
  lifecycle_status: string;
};

export type CohortKey =
  | { kind: "exact"; hatch_date: string }
  | { kind: "estimated"; estimated_age_days: number; age_reported_on: string }
  | { kind: "unknown" };

export function cohortKeyFromAge(opts: {
  hatch_date: string | null;
  estimated_age_days: number | null;
  age_reported_on?: string | null;
}): CohortKey {
  if (opts.hatch_date) return { kind: "exact", hatch_date: opts.hatch_date };
  if (opts.estimated_age_days != null && opts.age_reported_on) {
    return {
      kind: "estimated",
      estimated_age_days: opts.estimated_age_days,
      age_reported_on: opts.age_reported_on,
    };
  }
  return { kind: "unknown" };
}

export function cohortKeysEqual(a: CohortKey, b: CohortKey): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "exact" && b.kind === "exact") return a.hatch_date === b.hatch_date;
  if (a.kind === "estimated" && b.kind === "estimated") {
    return (
      a.estimated_age_days === b.estimated_age_days &&
      a.age_reported_on === b.age_reported_on
    );
  }
  return a.kind === "unknown" && b.kind === "unknown";
}

/** Build API age fields for P5 cohort aliases from a resolved key. */
export function cohortAgePayload(
  key: CohortKey,
):
  | { hatch_date: string }
  | { estimated_age_days: number; age_reported_on: string }
  | null {
  if (key.kind === "exact") return { hatch_date: key.hatch_date };
  if (key.kind === "estimated") {
    return {
      estimated_age_days: key.estimated_age_days,
      age_reported_on: key.age_reported_on,
    };
  }
  return null;
}

export function findMatchingActiveFlock(
  flocks: TransferFlockLike[],
  key: CohortKey,
): TransferFlockLike | null {
  const matches = flocks.filter((f) => {
    if (f.status !== "active") return false;
    return cohortKeysEqual(
      cohortKeyFromAge({
        hatch_date: f.hatch_date,
        estimated_age_days: f.estimated_age_days,
        age_reported_on: f.age_reported_on ?? null,
      }),
      key,
    );
  });
  if (matches.length === 0) return null;
  return matches[0] ?? null;
}

/** Banded selection must share one cohort key or transfer is refused. */
export function resolveBandedSelectionCohort(
  birds: TransferBirdLike[],
  selectedIds: string[],
  flocksById: Map<string, TransferFlockLike>,
): { ok: true; key: CohortKey; birdIds: string[] } | { ok: false; error: string } {
  const selected = birds.filter((b) => selectedIds.includes(b.id));
  if (selected.length === 0) {
    return { ok: false, error: "Select at least one banded bird" };
  }
  for (const b of selected) {
    if (!b.is_active || b.lifecycle_status !== "active") {
      return { ok: false, error: "Only active birds can be transferred" };
    }
  }
  const keys: CohortKey[] = selected.map((b) => {
    if (b.hatch_date || (b.estimated_age_days != null && b.age_reported_on)) {
      return cohortKeyFromAge({
        hatch_date: b.hatch_date,
        estimated_age_days: b.estimated_age_days,
        age_reported_on: b.age_reported_on ?? null,
      });
    }
    const flock = flocksById.get(b.flock_id);
    if (!flock) {
      return { kind: "unknown" };
    }
    return cohortKeyFromAge({
      hatch_date: flock.hatch_date,
      estimated_age_days: flock.estimated_age_days,
      age_reported_on: flock.age_reported_on ?? null,
    });
  });
  const first = keys[0]!;
  if (keys.some((k) => !cohortKeysEqual(k, first))) {
    return {
      ok: false,
      error: "Selected birds have different hatch dates. Transfer one hatch-date group at a time.",
    };
  }
  if (first.kind === "unknown") {
    return {
      ok: false,
      error: "Selected birds have no hatch date, so a destination population cannot be chosen safely.",
    };
  }
  return { ok: true, key: first, birdIds: selected.map((b) => b.id) };
}

export function unbandedSourceOptions(flocks: TransferFlockLike[]): {
  value: string;
  label: string;
  hint: string;
  unbanded_count: number;
  key: CohortKey;
}[] {
  return flocks
    .filter(
      (f) =>
        f.status === "active" &&
        f.tracking_mode !== "individual" &&
        f.unbanded_count > 0,
    )
    .map((f) => {
      const key = cohortKeyFromAge({
        hatch_date: f.hatch_date,
        estimated_age_days: f.estimated_age_days,
        age_reported_on: f.age_reported_on ?? null,
      });
      const age =
        key.kind === "exact"
          ? `Hatch ${key.hatch_date}`
          : key.kind === "estimated"
            ? `~${key.estimated_age_days}d (as of ${key.age_reported_on})`
            : "Age unknown";
      return {
        value: f.id,
        label: `${age} · ${f.unbanded_count} unbanded`,
        hint: `${f.current_count} live`,
        unbanded_count: f.unbanded_count,
        key,
      };
    });
}

export function validateUnbandedTransferQuantity(
  quantity: number,
  available: number,
): string | null {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 1) {
    return "Enter a whole number of at least 1";
  }
  if (quantity > available) {
    return `Quantity exceeds available unbanded birds (${available})`;
  }
  return null;
}
