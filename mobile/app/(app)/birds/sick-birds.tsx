import Ionicons from "@expo/vector-icons/Ionicons";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  getSicknessSummary,
  listSickness,
  type SicknessRecord,
} from "../../../src/api/sickness";
import { listSheds } from "../../../src/api/sheds";
import { describeApiError } from "../../../src/api/client";
import {
  RecoverSicknessSheet,
  type RecoverSicknessTarget,
} from "../../../src/components/birds/RecoverSicknessSheet";
import { SicknessFilterSheet } from "../../../src/components/birds/SicknessFilterSheet";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { ImmersiveHeroHeader } from "../../../src/components/ui/ImmersiveHeroHeader";
import { Screen } from "../../../src/components/ui/Screen";
import { ShedFilterSheet } from "../../../src/components/sheds/ShedFilterSheet";
import { formatDisplayDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  DEFAULT_SICKNESS_FILTERS,
  activeFilterCount,
  type SicknessFilterState,
} from "../../../src/features/sickness/sicknessFilters";
import {
  followUpLabel,
  formatSymptomsSummary,
  severityLabel,
  sicknessStatusLabel,
} from "../../../src/features/sickness/sicknessHelpers";
import {
  ALL_SHEDS_ID,
  buildShedFilterOptions,
  shedFilterLabel,
} from "../../../src/features/sheds/shedFilterHelpers";
import { useResetSearchOnContextChange } from "../../../src/features/search/searchLifecycle";
import { useTransientSearchQuery } from "../../../src/features/search/useTransientSearchQuery";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { heroArt } from "../../../src/theme/media";
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

export default function SickBirdsScreen() {
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canView = hasPermission(user, ownerAccountId, "sickness.view");
  const canRecover = hasPermission(user, ownerAccountId, "sickness.recover");
  const { query, debouncedQuery, setQuery, clearSearch } = useTransientSearchQuery();
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [filters, setFilters] = useState<SicknessFilterState>(DEFAULT_SICKNESS_FILTERS);
  const [shedId, setShedId] = useState<string>(ALL_SHEDS_ID);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shedOpen, setShedOpen] = useState(false);
  const [recoverTarget, setRecoverTarget] = useState<RecoverSicknessTarget | null>(null);

  const resetContext = useCallback(() => {
    clearSearch();
    setFilters({ ...DEFAULT_SICKNESS_FILTERS });
    setShedId(ALL_SHEDS_ID);
  }, [clearSearch]);
  useResetSearchOnContextChange(ownerAccountId, resetContext);

  const range = useMemo(() => periodRange(period), [period]);

  const summary = useQuery({
    queryKey: ["sickness-summary", ownerAccountId, period, range.from, range.to],
    queryFn: () => getSicknessSummary({ fromDate: range.from, toDate: range.to }),
    enabled: canView,
  });

  const sheds = useQuery({
    queryKey: ["sheds", ownerAccountId],
    queryFn: () => listSheds(),
    enabled: canView,
  });
  const shedOptions = useMemo(
    () => buildShedFilterOptions(sheds.data ?? []),
    [sheds.data],
  );

  const list = useInfiniteQuery({
    queryKey: ["sickness", ownerAccountId, debouncedQuery, filters, shedId],
    enabled: canView,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listSickness({
        q: debouncedQuery || undefined,
        status: filters.status,
        severity: filters.severity,
        shedId: shedId === ALL_SHEDS_ID ? null : shedId,
        sickFrom: filters.sickFrom,
        sickTo: filters.sickTo,
        followUpFrom: filters.followUpFrom,
        followUpTo: filters.followUpTo,
        followUpState: filters.followUpState,
        limit: 20,
        offset: pageParam,
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const summaryData = summary.data;
  const activeFilters = activeFilterCount(filters);

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view sick birds.</Text>
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
        onRefresh={() => {
          void list.refetch();
          void summary.refetch();
        }}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View>
            <ImmersiveHeroHeader
              source={heroArt.home}
              curveFill={birdUi.bg}
              accessibilityLabel="Sick birds farm illustration"
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
                  onPress={() => setFilterOpen(true)}
                  style={styles.roundBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Filter sick birds"
                >
                  <Ionicons name="options-outline" size={20} color={birdUi.primary} />
                  {activeFilters > 0 ? (
                    <View style={styles.filterBadge}>
                      <Text style={styles.filterBadgeText}>{activeFilters}</Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>
              <View style={styles.heroTitles}>
                <Text style={styles.title}>Sick Birds</Text>
                <Text style={styles.subtitle}>Health episodes, follow-ups, and recovery</Text>
              </View>
            </ImmersiveHeroHeader>

            <View style={styles.headerBody}>
              <View style={styles.statsGrid}>
                <StatCard
                  icon="medkit-outline"
                  value={summaryData?.currently_sick_birds ?? 0}
                  label="Sick birds"
                  tone="sick"
                />
                <StatCard
                  icon="pulse-outline"
                  value={summaryData?.active_episodes ?? 0}
                  label="Active episodes"
                  tone="active"
                />
                <StatCard
                  icon="calendar-outline"
                  value={summaryData?.follow_ups_due ?? 0}
                  label="Follow-ups due"
                  tone="due"
                />
                <StatCard
                  icon="alert-circle-outline"
                  value={summaryData?.follow_ups_overdue ?? 0}
                  label="Overdue"
                  tone="overdue"
                />
                <StatCard
                  icon="checkmark-circle-outline"
                  value={summaryData?.recovered_birds ?? 0}
                  label="Recovered"
                  tone="recovered"
                />
              </View>

              <View style={styles.searchRow}>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={18} color={birdUi.muted} />
                  <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search band, breed, batch, or shed"
                    placeholderTextColor={birdUi.muted}
                    accessibilityLabel="Search sick birds"
                  />
                  {query ? (
                    <Pressable onPress={clearSearch} hitSlop={10} accessibilityLabel="Clear search">
                      <Ionicons name="close-circle" size={18} color={birdUi.muted} />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setShedOpen(true)}
                  style={styles.shedBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Filter by shed"
                >
                  <Ionicons name="home-outline" size={17} color={birdUi.primary} />
                  <Text style={styles.shedBtnText} numberOfLines={1}>
                    {shedFilterLabel(shedOptions, shedId)}
                  </Text>
                </Pressable>
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
                    <Text style={[styles.chipText, period === key && styles.chipTextOn]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.reportCard}>
                <View style={styles.reportHeader}>
                  <Text style={styles.reportTitle}>Sick-bird report</Text>
                  <Text style={styles.reportPeriod}>
                    {period === "all"
                      ? "All time"
                      : period === "month"
                        ? "This month"
                        : "Last 3 months"}
                  </Text>
                </View>
                <Text style={styles.reportLine}>
                  {summaryData?.new_unique_birds ?? 0} birds ·{" "}
                  {summaryData?.new_episodes ?? 0} new episodes ·{" "}
                  {summaryData?.recovered_episodes ?? 0} recoveries
                </Text>
                <View style={styles.severityRow}>
                  {(
                    [
                      ["mild", "Mild"],
                      ["moderate", "Moderate"],
                      ["severe", "Severe"],
                    ] as const
                  ).map(([key, label]) => (
                    <View key={key} style={styles.severityStat}>
                      <Text style={styles.severityValue}>
                        {summaryData?.severity_breakdown?.[key] ?? 0}
                      </Text>
                      <Text style={styles.severityLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
                {summaryData?.shed_breakdown?.length ? (
                  <View style={styles.shedBreakdown}>
                    <Text style={styles.breakdownTitle}>By shed</Text>
                    {summaryData.shed_breakdown.slice(0, 6).map((row) => (
                      <View key={row.shed_id} style={styles.breakdownRow}>
                        <Text style={styles.breakdownName} numberOfLines={1}>
                          {row.shed_name || "Shed"}
                        </Text>
                        <Text style={styles.breakdownValue}>
                          {row.active_birds} birds
                          {row.overdue > 0 ? ` · ${row.overdue} overdue` : ""}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {(summaryData?.unresolved_inactive_episodes ?? 0) > 0 ? (
                  <Text style={styles.reportNote}>
                    {summaryData?.unresolved_inactive_episodes} unresolved episode
                    {summaryData?.unresolved_inactive_episodes === 1 ? "" : "s"} on inactive
                    birds; excluded from current counts.
                  </Text>
                ) : null}
              </View>

              <View style={styles.listHeadingRow}>
                <Text style={styles.listHeading}>
                  {total} episode{total === 1 ? "" : "s"}
                </Text>
                {activeFilters > 0 ? (
                  <Pressable onPress={() => setFilters({ ...DEFAULT_SICKNESS_FILTERS })}>
                    <Text style={styles.clearFilters}>Clear filters</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          list.isLoading ? (
            <HenLoader label="Loading sick birds…" />
          ) : list.isError ? (
            <View style={styles.emptyBox}>
              <Text style={styles.error}>{describeApiError(list.error, "load sick birds")}</Text>
              <Button label="Retry" onPress={() => void list.refetch()} />
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No sickness episodes found</Text>
              <Text style={styles.emptyBody}>
                Record sickness from a bird profile or select banded birds in a shed.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <SickCard
            item={item}
            canRecover={canRecover}
            onOpen={() =>
              router.push({ pathname: "/(app)/birds/[id]", params: { id: item.bird_id } })
            }
            onRecover={() =>
              setRecoverTarget({
                recordId: item.id,
                label: item.band_id ?? item.display_code ?? item.bird_id.slice(0, 8),
                sickDate: item.sick_date,
              })
            }
          />
        )}
      />

      <SicknessFilterSheet
        key={filterOpen ? "open" : "closed"}
        visible={filterOpen}
        applied={filters}
        onClose={() => setFilterOpen(false)}
        onApply={setFilters}
      />
      <ShedFilterSheet
        visible={shedOpen}
        onClose={() => setShedOpen(false)}
        options={shedOptions}
        selectedId={shedId}
        onSelect={setShedId}
      />
      <RecoverSicknessSheet
        key={recoverTarget?.recordId ?? "none"}
        visible={!!recoverTarget}
        target={recoverTarget}
        onClose={() => setRecoverTarget(null)}
        onSuccess={() => {
          setRecoverTarget(null);
          void qc.invalidateQueries({ queryKey: ["sickness"] });
          void qc.invalidateQueries({ queryKey: ["sickness-summary"] });
          void qc.invalidateQueries({ queryKey: ["bird-profile"] });
          void qc.invalidateQueries({ queryKey: ["shed-birds"] });
          void summary.refetch();
        }}
      />
    </Screen>
  );
}

function StatCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  label: string;
  tone: "sick" | "active" | "due" | "overdue" | "recovered";
}) {
  const palette = {
    sick: { bg: birdUi.errorPale, fg: birdUi.error },
    active: { bg: birdUi.orangePale, fg: birdUi.orange },
    due: { bg: birdUi.bluePale, fg: birdUi.blue },
    overdue: { bg: birdUi.errorPale, fg: birdUi.error },
    recovered: { bg: birdUi.successBg, fg: birdUi.successText },
  }[tone];
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={icon} size={16} color={palette.fg} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SickCard({
  item,
  canRecover,
  onOpen,
  onRecover,
}: {
  item: SicknessRecord;
  canRecover: boolean;
  onOpen: () => void;
  onRecover: () => void;
}) {
  const title = item.band_id ?? item.display_code ?? item.bird_id.slice(0, 8);
  const currentShed = item.current_shed_name?.trim() || "—";
  const recordedShed = item.recorded_shed_name?.trim();
  const unresolved = item.status === "active" && !item.bird_is_active;
  const severityTone =
    item.severity === "severe"
      ? { bg: birdUi.errorPale, fg: birdUi.error }
      : item.severity === "moderate"
        ? { bg: birdUi.orangePale, fg: birdUi.orange }
        : { bg: birdUi.successBg, fg: birdUi.successText };
  const statusTone =
    item.status === "recovered"
      ? { bg: birdUi.successBg, fg: birdUi.successText }
      : unresolved
        ? { bg: "#EEF1F0", fg: birdUi.muted }
        : { bg: birdUi.errorPale, fg: birdUi.error };
  const followTone =
    item.follow_up_state === "overdue"
      ? { bg: birdUi.errorPale, fg: birdUi.error }
      : item.follow_up_state === "due"
        ? { bg: birdUi.orangePale, fg: birdUi.orange }
        : { bg: birdUi.paleMint, fg: birdUi.primary };

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.cardMain}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open profile for ${title}`}
      >
        <View style={styles.cardLeft}>
          <View style={styles.avatar}>
            <Ionicons name="medkit-outline" size={20} color={birdUi.primary} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={styles.titleRow}>
              <Text style={styles.band}>{title}</Text>
              <View style={[styles.pill, { backgroundColor: statusTone.bg }]}>
                <Text style={[styles.pillText, { color: statusTone.fg }]}>
                  {unresolved ? "Unresolved" : sicknessStatusLabel(item.status)}
                </Text>
              </View>
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {item.breed ? `${item.breed} · ` : ""}Batch {item.batch_code} · {currentShed}
            </Text>
            <Text style={styles.symptoms}>{formatSymptomsSummary(item.symptoms, 110)}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.pill, { backgroundColor: severityTone.bg }]}>
                <Text style={[styles.pillText, { color: severityTone.fg }]}>
                  {severityLabel(item.severity)}
                </Text>
              </View>
              <View style={[styles.pill, { backgroundColor: followTone.bg }]}>
                <Text style={[styles.pillText, { color: followTone.fg }]}>
                  {followUpLabel(item.follow_up_state)}
                </Text>
              </View>
              {recordedShed && recordedShed !== currentShed ? (
                <Text style={styles.recordedShed} numberOfLines={1}>
                  Recorded in {recordedShed}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
        <View style={styles.cardRight}>
          <Text style={styles.dateLabel}>Sick since</Text>
          <Text style={styles.dateValue}>{formatDisplayDate(item.sick_date) || item.sick_date}</Text>
          {item.recovery_date ? (
            <>
              <Text style={styles.dateLabel}>Recovered</Text>
              <Text style={styles.dateValue}>
                {formatDisplayDate(item.recovery_date) || item.recovery_date}
              </Text>
            </>
          ) : null}
          {item.follow_up_date ? (
            <>
              <Text style={styles.dateLabel}>Follow-up</Text>
              <Text style={styles.dateValue}>
                {formatDisplayDate(item.follow_up_date) || item.follow_up_date}
              </Text>
            </>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
      </Pressable>
      {canRecover && item.status === "active" && item.bird_is_active ? (
        <View style={styles.recoverRow}>
          <Button
            label="Mark as recovered"
            variant="secondary"
            onPress={onRecover}
            style={styles.recoverBtn}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 28, gap: 10 },
  heroCopy: { flexGrow: 1, gap: 10, justifyContent: "space-between" },
  heroTitles: { gap: 2, paddingBottom: 2 },
  headerBody: { paddingHorizontal: birdUi.horizontal, gap: 8, marginBottom: 8, marginTop: -4 },
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
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: birdUi.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  title: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.text,
    letterSpacing: -0.3,
  },
  subtitle: { fontSize: typography.sectionTitle.fontSize, color: birdUi.muted },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: {
    width: "31.5%",
    minWidth: 104,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 10,
    gap: 3,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  statValue: { fontSize: 22, fontWeight: "800", color: birdUi.text, lineHeight: 25 },
  statLabel: { fontSize: typography.overline.fontSize, fontWeight: "700", color: birdUi.muted },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  searchBox: {
    flex: 1,
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
  shedBtn: {
    maxWidth: 142,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 10,
    minHeight: 48,
  },
  shedBtnText: { flexShrink: 1, fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.primary },
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
  reportCard: {
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 10,
    marginTop: 4,
  },
  reportHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reportTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text },
  reportPeriod: { fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.muted },
  reportLine: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.text },
  severityRow: { flexDirection: "row", gap: 8 },
  severityStat: {
    flex: 1,
    backgroundColor: birdUi.paleMint,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  severityValue: { fontSize: 18, fontWeight: "800", color: birdUi.text },
  severityLabel: { fontSize: typography.overline.fontSize, fontWeight: "700", color: birdUi.muted },
  shedBreakdown: { gap: 5, borderTopWidth: 1, borderTopColor: birdUi.divider, paddingTop: 8 },
  breakdownTitle: { fontSize: typography.caption.fontSize, fontWeight: "800", color: birdUi.muted },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  breakdownName: { flex: 1, fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.text },
  breakdownValue: { fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.muted },
  reportNote: { fontSize: typography.caption.fontSize, color: birdUi.muted, lineHeight: 16 },
  listHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  listHeading: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text },
  clearFilters: { fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.primary },
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
    gap: 10,
  },
  cardMain: { flexDirection: "row", gap: 10, alignItems: "center" },
  cardLeft: { flex: 1.2, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  band: { fontSize: typography.button.fontSize, fontWeight: "800", color: birdUi.text },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: typography.overline.fontSize, fontWeight: "800" },
  meta: { fontSize: typography.caption.fontSize, color: birdUi.muted },
  symptoms: { fontSize: typography.caption.fontSize, color: birdUi.textSecondary, lineHeight: 15 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 2 },
  recordedShed: { fontSize: typography.overline.fontSize, color: birdUi.muted, flexShrink: 1 },
  cardRight: { minWidth: 92, alignItems: "flex-end", gap: 1 },
  dateLabel: { fontSize: typography.overline.fontSize, color: birdUi.muted, fontWeight: "600" },
  dateValue: { fontSize: typography.caption.fontSize, fontWeight: "800", color: birdUi.text },
  recoverRow: { borderTopWidth: 1, borderTopColor: birdUi.divider, paddingTop: 8 },
  recoverBtn: { minHeight: 44 },
  _unused: { width: 0, height: 0 },
});
