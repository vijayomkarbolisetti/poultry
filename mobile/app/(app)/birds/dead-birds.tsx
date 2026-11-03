import Ionicons from "@expo/vector-icons/Ionicons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { listDeadBirds, type DeadBirdHit } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { BirdListExportSheet } from "../../../src/components/birds/BirdListExportSheet";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { ImmersiveHeroHeader } from "../../../src/components/ui/ImmersiveHeroHeader";
import { Screen } from "../../../src/components/ui/Screen";
import { formatDisplayDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { birdIcons, heroArt } from "../../../src/theme/media";
import { typography } from "../../../src/theme/tokens";

type PeriodKey = "all" | "month" | "quarter";

function periodRange(key: PeriodKey): { from: string | null; to: string | null } {
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (key === "all") return { from: null, to: null };
  if (key === "month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: iso(from), to: iso(today) };
  }
  const from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  return { from: iso(from), to: iso(today) };
}

export default function DeadBirdsScreen() {
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [exportOpen, setExportOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q]);

  const range = useMemo(() => periodRange(period), [period]);

  const list = useInfiniteQuery({
    queryKey: ["dead-birds", ownerAccountId, debouncedQ, period, range.from, range.to],
    enabled: canView,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listDeadBirds({
        q: debouncedQ || undefined,
        diedFrom: range.from,
        diedTo: range.to,
        limit: 20,
        offset: pageParam,
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view dead birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack("/(app)/settings")} />
      </Screen>
    );
  }

  return (
    <Screen edges={["left", "right", "bottom"]} style={{ backgroundColor: birdUi.bg, padding: 0 }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={() => void list.refetch()}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View>
            <ImmersiveHeroHeader
              source={heroArt.home}
              curveFill={birdUi.bg}
              accessibilityLabel="Dead birds farm illustration"
              contentStyle={styles.heroCopy}
            >
              <View style={styles.heroTopRow}>
                <Pressable
                  onPress={() => safeBack("/(app)/settings")}
                  style={styles.backBtn}
                  accessibilityLabel="Back"
                >
                  <Ionicons name="arrow-back" size={22} color={birdUi.text} />
                </Pressable>
                <Pressable
                  onPress={() => setExportOpen(true)}
                  style={styles.downloadBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Download dead birds export"
                >
                  <Ionicons name="download-outline" size={20} color={birdUi.primary} />
                </Pressable>
              </View>
              <View style={styles.heroTitles}>
                <Text style={styles.title}>Dead Birds</Text>
                <Text style={styles.subtitle}>Birds recorded as mortality</Text>
              </View>
            </ImmersiveHeroHeader>

            <View style={styles.headerBody}>
              <View style={styles.countCard} accessibilityLabel={`${total} dead birds`}>
                <View style={[styles.countIcon, { backgroundColor: birdUi.errorPale }]}>
                  <Ionicons name="heart-dislike-outline" size={18} color={birdUi.error} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.countValue}>{total}</Text>
                  <Text style={styles.countLabel}>
                    {total === 1 ? "dead bird" : "dead birds"}
                    {period !== "all" ? " in this period" : ""}
                  </Text>
                </View>
              </View>

              <View style={styles.searchRow}>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={18} color={birdUi.muted} />
                  <TextInput
                    style={styles.searchInput}
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search by Band no or id"
                    placeholderTextColor={birdUi.muted}
                    accessibilityLabel="Search dead birds"
                  />
                </View>
              </View>

              <View style={styles.chips}>
                {(
                  [
                    ["all", "All"],
                    ["month", "This Month"],
                    ["quarter", "Last 3 Months"],
                  ] as const
                ).map(([key, label]) => (
                  <Pressable
                    key={key}
                    onPress={() => setPeriod(key)}
                    style={[styles.chip, period === key && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: period === key }}
                  >
                    <Text style={[styles.chipText, period === key && styles.chipTextOn]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          list.isLoading ? (
            <HenLoader label="Loading dead birds…" />
          ) : list.isError ? (
            <View style={styles.emptyBox}>
              <Text style={styles.error}>{formatDeadBirdsLoadError(list.error)}</Text>
              <Button label="Retry" onPress={() => void list.refetch()} />
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No dead birds yet</Text>
              <Text style={styles.emptyBody}>
                When you record mortality for a banded bird, it appears here with the date and reason.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <DeadCard item={item} />}
      />
      <BirdListExportSheet
        visible={exportOpen}
        kind="dead"
        onClose={() => setExportOpen(false)}
      />
    </Screen>
  );
}

/** Avoid surfacing raw FastAPI UUID path errors if the API route is missing/stale. */
function formatDeadBirdsLoadError(error: unknown): string {
  const raw = describeApiError(error, "load dead birds");
  if (/bird_id|uuid|invalid length/i.test(raw)) {
    return "Could not load dead birds. Pull to refresh, or ask an admin to restart the API.";
  }
  return raw;
}

function DeadCard({ item }: { item: DeadBirdHit }) {
  if (!item?.id) return null;
  const title = item.band_id ?? item.display_code ?? item.id.slice(0, 8);
  const shedLabel = item.shed_name?.trim() || item.shed_code?.trim() || "—";

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: "/(app)/birds/[id]", params: { id: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open profile for ${title}`}
    >
      <View style={styles.cardLeft}>
        <View style={styles.avatar}>
          <Image source={birdIcons.bird} style={styles.avatarImg} resizeMode="cover" />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.band}>{title}</Text>
          {item.breed ? (
            <View style={styles.breedPill}>
              <Text style={styles.breedText}>{item.breed}</Text>
            </View>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            Batch {item.batch_code} · {shedLabel}
          </Text>
          <View style={styles.deadPill}>
            <Ionicons name="heart-dislike" size={12} color="#fff" />
            <Text style={styles.deadPillText}>Dead</Text>
          </View>
        </View>
      </View>

      <View style={styles.cardMid}>
        <InfoRow
          icon="calendar-outline"
          label="Died on"
          value={formatDisplayDate(item.died_on) || item.died_on}
        />
        <InfoRow icon="document-text-outline" label="Reason" value={item.reason?.trim() || "—"} />
        <InfoRow icon="home-outline" label="Shed" value={shedLabel} />
      </View>

      <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color={birdUi.muted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 28, gap: 10 },
  heroCopy: { flexGrow: 1, gap: 10, justifyContent: "space-between" },
  heroTitles: { gap: 2, paddingBottom: 2 },
  headerBody: {
    paddingHorizontal: birdUi.horizontal,
    gap: 8,
    marginBottom: 8,
    marginTop: -4,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  downloadBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.text,
    letterSpacing: -0.3,
  },
  subtitle: { fontSize: typography.sectionTitle.fontSize, color: birdUi.muted },
  countCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  countIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  countValue: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.text,
    lineHeight: 26,
  },
  countLabel: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted },
  searchRow: { marginTop: 4 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: birdUi.text,
    fontWeight: "600",
    paddingVertical: 10,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: birdUi.white,
    borderWidth: 1,
    borderColor: birdUi.border,
  },
  chipOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  chipText: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.text },
  chipTextOn: { color: "#fff" },
  emptyBox: { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.text },
  emptyBody: {
    fontSize: typography.label.fontSize,
    color: birdUi.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  error: { color: birdUi.error, fontWeight: "600", textAlign: "center" },
  card: {
    marginHorizontal: birdUi.horizontal,
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  cardLeft: { flex: 1.1, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  band: { fontSize: typography.button.fontSize, fontWeight: "800", color: birdUi.text },
  breedPill: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF1F0",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  breedText: { fontSize: typography.overline.fontSize, fontWeight: "700", color: birdUi.muted },
  meta: { fontSize: typography.caption.fontSize, color: birdUi.muted },
  deadPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: birdUi.error,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  deadPillText: { color: "#fff", fontSize: typography.overline.fontSize, fontWeight: "800" },
  cardMid: { flex: 1.2, gap: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoLabel: { fontSize: typography.overline.fontSize, color: birdUi.muted, width: 52 },
  infoValue: { flex: 1, fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.text },
});
