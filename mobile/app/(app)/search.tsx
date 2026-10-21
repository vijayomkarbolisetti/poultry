import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ComponentProps, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { describeApiError } from "../../src/api/client";
import {
  globalSearch,
  type BatchSearchHit,
  type BirdSearchHit,
  type ShedSearchHit,
} from "../../src/api/search";
import { Button } from "../../src/components/ui/Button";
import { HenLoader } from "../../src/components/ui/HenLoader";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import {
  batchSubtitle,
  birdSubtitle,
  classifyGlobalSearch,
  MIN_QUERY_LENGTH,
  normalizeSearchQuery,
  SEARCH_DEBOUNCE_MS,
  shedSubtitle,
} from "../../src/features/search/globalSearchHelpers";
import { safeBack } from "../../src/navigation/safeBack";
import { colors, radius, space } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

type ResultRow =
  | { kind: "header"; title: string; key: string }
  | { kind: "bird"; hit: BirdSearchHit; key: string }
  | { kind: "batch"; hit: BatchSearchHit; key: string }
  | { kind: "shed"; hit: ShedSearchHit; key: string }
  | { kind: "section_error"; message: string; key: string };

export default function GlobalSearchScreen() {
  const { user, ownerAccountId } = useAuth();
  const canBirds = hasPermission(user, ownerAccountId, "bird.view");
  const canBatches = hasPermission(user, ownerAccountId, "flock.view");
  const canSheds = hasPermission(user, ownerAccountId, "shed.view");
  const canSearch = canBirds || canBatches || canSheds;

  const [draft, setDraft] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(normalizeSearchQuery(draft)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  const types = [
    canBirds ? "birds" : null,
    canBatches ? "batches" : null,
    canSheds ? "sheds" : null,
  ]
    .filter(Boolean)
    .join(",");

  const enabled = canSearch && debounced.length >= MIN_QUERY_LENGTH;

  const query = useQuery({
    queryKey: ["global-search", ownerAccountId, debounced, types],
    queryFn: () => globalSearch({ q: debounced, types, limit: 10 }),
    enabled,
    placeholderData: (prev) => (prev?.query === debounced ? prev : undefined),
  });

  const uiState = useMemo(
    () =>
      classifyGlobalSearch({
        query: debounced,
        loading: query.isFetching,
        fetchError: query.isError,
        birdTotal: query.data?.birds?.total ?? 0,
        batchTotal: query.data?.batches?.total ?? 0,
        shedTotal: query.data?.sheds?.total ?? 0,
        birdError: query.data?.birds?.error ?? null,
        batchError: query.data?.batches?.error ?? null,
        shedError: query.data?.sheds?.error ?? null,
        anySection: Boolean(query.data?.birds || query.data?.batches || query.data?.sheds),
      }),
    [debounced, query.isFetching, query.isError, query.data],
  );

  const rows: ResultRow[] = useMemo(() => {
    const data = query.data;
    if (!data) return [];
    const out: ResultRow[] = [];
    if (data.birds) {
      if (data.birds.error) {
        out.push({ kind: "section_error", message: `Birds: ${data.birds.error}`, key: "birds-err" });
      } else if (data.birds.items.length) {
        out.push({ kind: "header", title: "Birds", key: "birds-h" });
        for (const hit of data.birds.items) {
          out.push({ kind: "bird", hit, key: `bird-${hit.id}` });
        }
      }
    }
    if (data.batches) {
      if (data.batches.error) {
        out.push({
          kind: "section_error",
          message: `Batches: ${data.batches.error}`,
          key: "batches-err",
        });
      } else if (data.batches.items.length) {
        out.push({ kind: "header", title: "Batches", key: "batches-h" });
        for (const hit of data.batches.items) {
          out.push({ kind: "batch", hit, key: `batch-${hit.id}` });
        }
      }
    }
    if (data.sheds) {
      if (data.sheds.error) {
        out.push({ kind: "section_error", message: `Sheds: ${data.sheds.error}`, key: "sheds-err" });
      } else if (data.sheds.items.length) {
        out.push({ kind: "header", title: "Sheds", key: "sheds-h" });
        for (const hit of data.sheds.items) {
          out.push({ kind: "shed", hit, key: `shed-${hit.id}` });
        }
      }
    }
    return out;
  }, [query.data]);

  const onOpen = (href: string) => {
    router.push(href as never);
  };

  if (!canSearch) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to search farm records.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  return (
    <Screen style={{ paddingBottom: 0 }}>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={20} color={colors.inkMuted} />
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Search birds, batches, or sheds…"
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Search birds, batches, or sheds"
        />
        {draft.length > 0 ? (
          <Pressable
            onPress={() => setDraft("")}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>

      {uiState === "idle" ? (
        <Text style={styles.meta}>
          Search by band number, batch code, or shed name. Results stay within your farm access.
        </Text>
      ) : null}
      {uiState === "too_short" ? (
        <Text style={styles.meta}>Type at least {MIN_QUERY_LENGTH} characters to search.</Text>
      ) : null}
      {uiState === "loading" && rows.length === 0 ? <HenLoader label="Searching…" /> : null}
      {uiState === "error" ? (
        <View style={styles.card}>
          <Text style={styles.error}>{describeApiError(query.error, "search")}</Text>
          <Button label="Retry" onPress={() => query.refetch()} />
        </View>
      ) : null}
      {uiState === "empty" ? (
        <View style={styles.card}>
          <Text style={styles.name}>No matches</Text>
          <Text style={styles.meta}>Nothing matched “{debounced}” in birds, batches, or sheds.</Text>
        </View>
      ) : null}
      {uiState === "partial_error" ? (
        <View style={[styles.card, styles.warnCard]}>
          <Text style={styles.warnText}>
            Some search results could not be loaded. Showing what is available.
          </Text>
          <Button label="Retry" variant="secondary" onPress={() => query.refetch()} />
        </View>
      ) : null}

      {rows.length > 0 ? (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return <Text style={styles.section}>{item.title}</Text>;
            }
            if (item.kind === "section_error") {
              return (
                <View style={[styles.card, styles.warnCard]}>
                  <Text style={styles.warnText}>{item.message}</Text>
                </View>
              );
            }
            if (item.kind === "bird") {
              return (
                <ResultCard
                  icon="egg-outline"
                  title={item.hit.band_id ?? item.hit.display_code ?? "Bird"}
                  subtitle={birdSubtitle(item.hit)}
                  tag={item.hit.match_kind === "exact" ? "Exact" : "Partial"}
                  onPress={() => onOpen(`/(app)/birds/${item.hit.id}`)}
                />
              );
            }
            if (item.kind === "batch") {
              return (
                <ResultCard
                  icon="layers-outline"
                  title={item.hit.batch_code}
                  subtitle={batchSubtitle(item.hit)}
                  tag={item.hit.match_kind === "exact" ? "Exact" : "Partial"}
                  onPress={() => onOpen(`/(app)/flocks/${item.hit.id}`)}
                />
              );
            }
            return (
              <ResultCard
                icon="business-outline"
                title={item.hit.name}
                subtitle={shedSubtitle(item.hit)}
                tag={item.hit.match_kind === "exact" ? "Exact" : "Partial"}
                onPress={() => onOpen(`/(app)/sheds/${item.hit.id}`)}
              />
            );
          }}
        />
      ) : null}
    </Screen>
  );
}

function ResultCard({
  icon,
  title,
  subtitle,
  tag,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  tag: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{title}</Text>
          <Text style={styles.meta}>{subtitle}</Text>
          <Text style={styles.tag}>{tag}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  input: { flex: 1, color: colors.ink, fontSize: 16, paddingVertical: 4 },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.brandDark,
    marginTop: space.sm,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warnCard: { backgroundColor: "#FFF4E5", borderColor: "#E0C98A" },
  warnText: { color: colors.accent, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontWeight: "800", color: colors.ink, fontSize: 16 },
  meta: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  tag: { color: colors.brand, fontSize: 12, fontWeight: "700", marginTop: 2 },
  error: { color: colors.danger },
});
