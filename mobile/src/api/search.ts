import { api } from "./client";

export type MatchKind = "exact" | "partial";

export type BirdSearchHit = {
  id: string;
  band_id: string | null;
  display_code: string | null;
  shed_id: string;
  shed_name: string | null;
  shed_code: string | null;
  flock_id: string;
  batch_code: string;
  breed: string | null;
  lifecycle_status: string;
  is_active: boolean;
  match_kind: MatchKind | string;
};

export type BatchSearchHit = {
  id: string;
  batch_code: string;
  breed: string | null;
  shed_id: string;
  shed_name: string | null;
  shed_code: string | null;
  current_count: number;
  status: string;
  match_kind: MatchKind | string;
};

export type ShedSearchHit = {
  id: string;
  name: string;
  code: string;
  organization_name: string | null;
  manager_names: string[];
  is_active: boolean;
  total_live_birds: number;
  match_kind: MatchKind | string;
};

export type SearchSection<T> = {
  total: number;
  exact_count: number;
  items: T[];
  error: string | null;
};

export type GlobalSearchResult = {
  query: string;
  limit: number;
  birds: SearchSection<BirdSearchHit> | null;
  batches: SearchSection<BatchSearchHit> | null;
  sheds: SearchSection<ShedSearchHit> | null;
};

export async function globalSearch(opts: {
  q: string;
  limit?: number;
  include_inactive?: boolean;
  types?: string;
}): Promise<GlobalSearchResult> {
  const { data } = await api.get<GlobalSearchResult>("/search", {
    params: {
      q: opts.q,
      limit: opts.limit ?? 10,
      include_inactive: opts.include_inactive ?? true,
      types: opts.types ?? "birds,sheds",
    },
  });
  return data;
}
