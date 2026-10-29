/**
 * Inline birds + sheds results for the Home screen search bar.
 * Reuses globalSearch API + classify helpers (same auth as dedicated Search).
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ComponentProps, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { describeApiError } from "../../api/client";
import {
  globalSearch,
  type BirdSearchHit,
  type ShedSearchHit,
} from "../../api/search";
import { Button } from "../../components/ui/Button";
import { HenLoader } from "../../components/ui/HenLoader";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../auth/permissions";
import {
  birdSubtitle,
  classifyGlobalSearch,
  MIN_QUERY_LENGTH,
  normalizeSearchQuery,
  SEARCH_DEBOUNCE_MS,
  shedSubtitle,
} from "./globalSearchHelpers";
import { setHomeSearchDraft } from "./homeSearchSession";

type IconName = ComponentProps<typeof Ionicons>["name"];

type Props = {
  draft: string;
  /** Soft mint Home palette tokens */
  colors: {
    white: string;
    primaryText: string;
    secondaryText: string;
    subtleBorder: string;
    accentGreen: string;
    forest: string;
  };
};

export function HomeInlineSearchPanel({ draft, colors: c }: Props) {
  const { user, ownerAccountId } = useAuth();
  const canBirds = hasPermission(user, ownerAccountId, "bird.view");
  const canSheds = hasPermission(user, ownerAccountId, "shed.view");
  const [debounced, setDebounced] = useState(() => normalizeSearchQuery(draft));

  useEffect(() => {
    const t = setTimeout(() => {
      const next = normalizeSearchQuery(draft);
      setDebounced(next);
      setHomeSearchDraft(draft);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  const types = [canBirds ? "birds" : null, canSheds ? "sheds" : null].filter(Boolean).join(",");
  const enabled = (canBirds || canSheds) && debounced.length >= MIN_QUERY_LENGTH;

  const query = useQuery({
    queryKey: ["home-inline-search", ownerAccountId, debounced, types],
    queryFn: () => globalSearch({ q: debounced, types, limit: 10 }),
    enabled,
    // Keep previous only when the query string matches — avoids stale overwrite flash.
    placeholderData: (prev) => (prev?.query === debounced ? prev : undefined),
  });

  const uiState = useMemo(
    () =>
      classifyGlobalSearch({
        query: debounced,
        loading: query.isFetching,
        fetchError: query.isError,
        birdTotal: query.data?.birds?.total ?? 0,
        batchTotal: 0,
        shedTotal: query.data?.sheds?.total ?? 0,
        birdError: query.data?.birds?.error ?? null,
        batchError: null,
        shedError: query.data?.sheds?.error ?? null,
        anySection: Boolean(query.data?.birds || query.data?.sheds),
      }),
    [debounced, query.isFetching, query.isError, query.data],
  );

  const openBird = (hit: BirdSearchHit) => {
    setHomeSearchDraft(draft);
    router.push({
      pathname: "/(app)/birds/[id]",
      params: { id: hit.id, fromHome: "1" },
    });
  };

  const openShed = (hit: ShedSearchHit) => {
    setHomeSearchDraft(draft);
    router.push({
      pathname: "/(app)/sheds/[id]/birds",
      params: { id: hit.id },
    });
  };

  if (uiState === "too_short") {
    return (
      <Text style={[styles.meta, { color: c.secondaryText }]}>
        Type at least {MIN_QUERY_LENGTH} characters to search.
      </Text>
    );
  }

  if (uiState === "loading" && !query.data) {
    return <HenLoader label="Searching…" />;
  }

  if (uiState === "error") {
    return (
      <View style={[styles.card, { backgroundColor: c.white, borderColor: c.subtleBorder }]}>
        <Text style={styles.error}>{describeApiError(query.error, "search")}</Text>
        <Button label="Retry" onPress={() => void query.refetch()} />
      </View>
    );
  }

  if (uiState === "empty") {
    return (
      <View style={[styles.card, { backgroundColor: c.white, borderColor: c.subtleBorder }]}>
        <Ionicons name="search-outline" size={28} color={c.accentGreen} style={{ alignSelf: "center" }} />
        <Text style={[styles.emptyTitle, { color: c.primaryText }]}>No matches</Text>
        <Text style={[styles.meta, { color: c.secondaryText, textAlign: "center" }]}>
          Nothing matched “{debounced}” in birds or sheds.
        </Text>
      </View>
    );
  }

  const birds = query.data?.birds;
  const sheds = query.data?.sheds;

  return (
    <View style={styles.wrap}>
      {uiState === "partial_error" ? (
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.warnText}>
            Some search results could not be loaded. Showing what is available.
          </Text>
          <Button label="Retry" variant="secondary" onPress={() => void query.refetch()} />
        </View>
      ) : null}

      {uiState === "loading" ? (
        <Text style={[styles.meta, { color: c.secondaryText }]}>Updating results…</Text>
      ) : null}

      {birds && !birds.error && birds.items.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.forest }]}>Birds</Text>
          {birds.items.map((hit) => (
            <ResultRow
              key={`bird-${hit.id}`}
              icon="egg-outline"
              title={hit.band_id ?? hit.display_code ?? "Bird"}
              subtitle={birdSubtitle(hit)}
              tag={hit.match_kind === "exact" ? "Exact" : "Partial"}
              onPress={() => openBird(hit)}
              c={c}
            />
          ))}
        </View>
      ) : null}
      {birds?.error ? (
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.warnText}>Birds: {birds.error}</Text>
        </View>
      ) : null}

      {sheds && !sheds.error && sheds.items.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.forest }]}>Sheds</Text>
          {sheds.items.map((hit) => (
            <ResultRow
              key={`shed-${hit.id}`}
              icon="business-outline"
              title={hit.name}
              subtitle={shedSubtitle(hit)}
              tag={hit.match_kind === "exact" ? "Exact" : "Partial"}
              onPress={() => openShed(hit)}
              c={c}
            />
          ))}
        </View>
      ) : null}
      {sheds?.error ? (
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.warnText}>Sheds: {sheds.error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ResultRow({
  icon,
  title,
  subtitle,
  tag,
  onPress,
  c,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  tag: string;
  onPress: () => void;
  c: Props["colors"];
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [
        styles.resultCard,
        { backgroundColor: c.white, borderColor: c.subtleBorder },
        pressed && { opacity: 0.88 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: "#E8F8F0" }]}>
        <Ionicons name={icon} size={18} color={c.accentGreen} />
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={[styles.name, { color: c.primaryText }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.meta, { color: c.secondaryText }]} numberOfLines={2}>
          {subtitle}
        </Text>
        <Text style={[styles.tag, { color: c.accentGreen }]}>{tag}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#9AA8A1" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, marginBottom: 8 },
  section: { gap: 8 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontWeight: "800", fontSize: 15 },
  meta: { fontSize: 13, lineHeight: 18 },
  tag: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  emptyTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  warnCard: { backgroundColor: "#FFF4E5", borderColor: "#E0C98A" },
  warnText: { color: "#B45309", fontWeight: "600", fontSize: 13 },
  error: { color: "#DC2626", fontWeight: "600" },
});
