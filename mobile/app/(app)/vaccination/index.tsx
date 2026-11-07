import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { describeApiError } from "../../../src/api/client";
import { listSheds, type ShedListItem } from "../../../src/api/sheds";
import { listScheduledDoses } from "../../../src/api/vaccines";
import { ShedFilterSheet } from "../../../src/components/sheds/ShedFilterSheet";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import {
  IMMERSIVE_HERO_SHEET_OVERLAP,
  ImmersiveHeroHeader,
} from "../../../src/components/ui/ImmersiveHeroHeader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  ALL_SHEDS_ID,
  buildShedFilterOptions,
  shedFilterLabel,
} from "../../../src/features/sheds/shedFilterHelpers";
import {
  byShedToggleLabel,
  hiddenByShedCount,
  shouldShowByShedToggle,
  visibleByShedRows,
} from "../../../src/features/vaccination/byShedSection";
import {
  coverageLine,
  DoseCardModel,
  enrichDoseCards,
  formatDueDateLabel,
  groupDoseCards,
  needsAttentionCards,
  populationHint,
  remainingLine,
  shedOverviewFromCards,
  statusBadgeLabel,
  summaryCounts,
} from "../../../src/features/vaccination/dashboardHelpers";
import { heroArt, media } from "../../../src/theme/media";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { typography } from "../../../src/theme/tokens";


type ShedFilter = "all" | string;

type DashboardPayload = {
  cards: DoseCardModel[];
  sheds: ShedListItem[];
};

async function loadDashboard(shedFilter: ShedFilter): Promise<DashboardPayload> {
  const shedId = shedFilter === "all" ? undefined : shedFilter;
  const [doses, sheds] = await Promise.all([
    listScheduledDoses({ shed_id: shedId, limit: 500 }),
    listSheds().catch(() => [] as ShedListItem[]),
  ]);
  return { cards: enrichDoseCards(doses), sheds };
}

function SummaryCard({
  label,
  count,
  tone,
  icon,
}: {
  label: string;
  count: number;
  tone: "overdue" | "due" | "upcoming" | "review";
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const palette =
    tone === "overdue"
      ? { bg: ui.overdueBg, fg: ui.overdueText, icon: ui.overdueIcon }
      : tone === "due"
        ? { bg: ui.dueBg, fg: ui.dueText, icon: ui.dueIcon }
        : tone === "review"
          ? { bg: ui.reviewBg, fg: ui.reviewText, icon: ui.reviewIcon }
          : { bg: ui.upcomingBg, fg: ui.upcomingText, icon: ui.upcomingIcon };
  return (
    <View style={[styles.summaryCard, { backgroundColor: palette.bg }]}>
      <Ionicons name={icon} size={18} color={palette.icon} />
      <Text style={[styles.summaryCount, { color: palette.fg }]}>{count}</Text>
      <Text style={[styles.summaryLabel, { color: palette.fg }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function MetaRow({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={15} color={ui.mutedSoft} style={styles.metaIcon} />
      <Text style={styles.metaText} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

function DoseCard({
  item,
  primary,
  canRecord,
}: {
  item: DoseCardModel;
  primary?: boolean;
  canRecord: boolean;
}) {
  const badgeTone =
    item.bucket === "overdue"
      ? { bg: ui.overdueBg, fg: ui.overdueText }
      : item.bucket === "due_today"
        ? { bg: ui.dueBg, fg: ui.dueText }
        : item.bucket === "needs_review"
          ? { bg: ui.reviewBg, fg: ui.reviewText }
          : item.bucket === "completed"
            ? { bg: ui.brandSoft, fg: ui.brand }
            : { bg: ui.upcomingBg, fg: ui.upcomingText };

  const dueLine =
    item.bucket === "needs_review" && (!item.due_date || item.needs_review)
      ? item.dose_number > 1
        ? `Hatch date needed · Dose ${item.dose_number}`
        : "Hatch date needed — due date not set"
      : `Due ${formatDueDateLabel(item.due_date)}${item.dose_number > 1 ? ` · Dose ${item.dose_number}` : ""}`;

  const pop = populationHint(item);
  const openDetail = () => router.push(`/(app)/vaccination/${item.id}`);

  return (
    <Pressable style={styles.card} accessibilityRole="button" onPress={openDetail}>
      <View style={styles.cardTop}>
        <Text style={styles.vaccineName} numberOfLines={2}>
          {item.vaccine_name}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: badgeTone.bg }]}>
          <Text style={[styles.statusBadgeText, { color: badgeTone.fg }]}>
            {statusBadgeLabel(item.bucket)}
          </Text>
        </View>
        {!primary ? (
          <Ionicons name="chevron-forward" size={18} color={ui.mutedSoft} style={styles.cardChevron} />
        ) : null}
      </View>

      <MetaRow icon="calendar-outline" text={dueLine} />
      <MetaRow icon="home-outline" text={item.shed_name} />
      <MetaRow icon="people-outline" text={`${coverageLine(item)} · ${remainingLine(item)}`} />
      {pop ? <Text style={styles.popHint}>{pop}</Text> : null}

      <View style={styles.progressRow}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, item.coverage_pct))}%` }]} />
        </View>
        <Text style={styles.progressPct}>{item.coverage_pct}%</Text>
      </View>

      {primary ? (
        <Pressable
          style={styles.reviewBtn}
          accessibilityRole="button"
          accessibilityLabel={canRecord ? "Vaccinate" : "Review dose"}
          onPress={openDetail}
        >
          <Text style={styles.reviewBtnText}>{canRecord ? "Vaccinate" : "Review"}</Text>
          <Ionicons name="chevron-forward" size={16} color={ui.white} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

type ListRow =
  | { type: "shedOverview"; rows: ReturnType<typeof shedOverviewFromCards> }
  | { type: "section"; title: string; countLabel: string }
  | { type: "dose"; dose: DoseCardModel; primary?: boolean };

export default function VaccinationDashboardScreen() {
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "vaccination.view");
  const canRecord = hasPermission(user, ownerAccountId, "vaccination.record");
  const canSheds = hasPermission(user, ownerAccountId, "shed.view");
  const [shedFilter, setShedFilter] = useState<ShedFilter>(ALL_SHEDS_ID);
  const [shedPickerOpen, setShedPickerOpen] = useState(false);
  const [byShedExpanded, setByShedExpanded] = useState(false);

  const query = useQuery({
    queryKey: ["vaccination", "dashboard", ownerAccountId, shedFilter],
    queryFn: () => loadDashboard(shedFilter),
    enabled: Boolean(ownerAccountId) && canView,
  });

  useFocusEffect(
    useCallback(() => {
      if (canView) void query.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canView, ownerAccountId, shedFilter]),
  );

  const groups = useMemo(() => groupDoseCards(query.data?.cards ?? []), [query.data?.cards]);
  const summary = useMemo(() => summaryCounts(groups), [groups]);
  const attention = useMemo(() => needsAttentionCards(groups), [groups]);
  const shedOverview = useMemo(
    () => (shedFilter === "all" ? shedOverviewFromCards(query.data?.cards ?? []) : []),
    [shedFilter, query.data?.cards],
  );

  const shedOptions = useMemo(
    () => buildShedFilterOptions(query.data?.sheds ?? []),
    [query.data?.sheds],
  );

  const shedLabel = shedFilterLabel(shedOptions, shedFilter);

  const rows: ListRow[] = useMemo(() => {
    const out: ListRow[] = [];
    if (shedFilter === "all" && shedOverview.length > 1) {
      out.push({ type: "shedOverview", rows: shedOverview });
    }
    if (attention.length) {
      out.push({
        type: "section",
        title: "Due Vaccinations",
        countLabel: `${attention.length} dose${attention.length === 1 ? "" : "s"}`,
      });
      attention.forEach((dose, index) => {
        out.push({ type: "dose", dose, primary: index === 0 });
      });
    }
    if (groups.upcoming.length) {
      out.push({
        type: "section",
        title: "Upcoming",
        countLabel: `${groups.upcoming.length} dose${groups.upcoming.length === 1 ? "" : "s"}`,
      });
      for (const dose of groups.upcoming) out.push({ type: "dose", dose });
    }
    if (groups.completed.length) {
      out.push({
        type: "section",
        title: "Recently completed",
        countLabel: `${groups.completed.length}`,
      });
      for (const dose of groups.completed.slice(0, 20)) out.push({ type: "dose", dose });
    }
    return out;
  }, [attention, groups.upcoming, groups.completed, shedFilter, shedOverview]);

  if (!canView) {
    return <Redirect href="/(app)/home" />;
  }

  const refreshing = query.isRefetching && !query.isLoading;
  const showInitialLoader = query.isLoading && !query.data;
  const errorMessage = query.error
    ? describeApiError(query.error, "load vaccination schedule")
    : null;
  const isEmpty = !showInitialLoader && !errorMessage && rows.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <ImmersiveHeroHeader
        source={heroArt.vaccination}
        curveFill={ui.bg}
        accessibilityLabel="Vaccination farm illustration"
      >
        <View style={styles.heroCopy}>
          <Text style={styles.title}>Vaccination</Text>
          <Text style={styles.subtitle}>Track and manage bird vaccinations</Text>
        </View>
      </ImmersiveHeroHeader>

      <View style={styles.sheet}>
        {canSheds && shedOptions.length > 0 ? (
          <View style={styles.filterWrap}>
            <Pressable
              style={styles.filterBtn}
              onPress={() => setShedPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by shed: ${shedLabel}`}
            >
              <Ionicons name="options-outline" size={18} color={ui.muted} />
              <Text style={styles.filterLabel} numberOfLines={1}>
                {shedLabel}
              </Text>
              <Ionicons name="chevron-down" size={18} color={ui.muted} />
            </Pressable>
          </View>
        ) : null}

        {!showInitialLoader && !errorMessage ? (
          <View style={styles.summaryRow}>
            <SummaryCard label="Overdue" count={summary.overdue} tone="overdue" icon="alert-circle" />
            <SummaryCard label="Due today" count={summary.dueToday} tone="due" icon="calendar" />
            <SummaryCard label="Upcoming" count={summary.upcoming} tone="upcoming" icon="time" />
          </View>
        ) : null}
      </View>

      {showInitialLoader ? (
        <View style={styles.center}>
          <HenLoader label="Loading vaccinations…" />
        </View>
      ) : errorMessage ? (
        <View style={styles.centerPad}>
          <Text style={styles.errorTitle}>Could not load schedule</Text>
          <Text style={styles.errorBody}>{errorMessage}</Text>
          <Pressable
            onPress={() => void query.refetch()}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : isEmpty ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            title="No vaccinations due"
            body={
              shedFilter === "all"
                ? "When schedules are generated for your flocks, overdue and upcoming doses will appear here."
                : "Nothing due in this shed right now. Try another shed or pull to refresh."
            }
            imageUri={media.farmMorning}
            actionLabel="Refresh"
            onAction={() => void query.refetch()}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item, index) =>
            item.type === "section"
              ? `s-${item.title}`
              : item.type === "shedOverview"
                ? "shed-overview"
                : item.dose.id || `d-${index}`
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void query.refetch()} />
          }
          renderItem={({ item }) => {
            if (item.type === "shedOverview") {
              const showToggle = shouldShowByShedToggle(item.rows.length);
              const hiddenCount = hiddenByShedCount(item.rows.length);
              const visibleRows = visibleByShedRows(item.rows, byShedExpanded);
              return (
                <View style={styles.overviewBlock}>
                  <View style={styles.byShedHeader}>
                    <Text style={styles.sectionTitle}>By shed</Text>
                    {showToggle ? (
                      <Pressable
                        onPress={() => setByShedExpanded((open) => !open)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={byShedToggleLabel(hiddenCount, byShedExpanded)}
                      >
                        <Text style={styles.byShedToggle}>
                          {byShedToggleLabel(hiddenCount, byShedExpanded)}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {visibleRows.map((row) => (
                    <Pressable
                      key={row.shedId}
                      style={styles.shedRow}
                      onPress={() => setShedFilter(row.shedId)}
                    >
                      <Text style={styles.shedName} numberOfLines={1}>
                        {row.shedName}
                      </Text>
                      <View style={styles.dotRow}>
                        <View style={[styles.countDot, { backgroundColor: ui.overdueBg }]}>
                          <Text style={[styles.countDotText, { color: ui.overdueText }]}>{row.overdue}</Text>
                        </View>
                        <View style={[styles.countDot, { backgroundColor: ui.dueBg }]}>
                          <Text style={[styles.countDotText, { color: ui.dueText }]}>{row.dueToday}</Text>
                        </View>
                        <View style={[styles.countDot, { backgroundColor: ui.upcomingBg }]}>
                          <Text style={[styles.countDotText, { color: ui.upcomingText }]}>{row.upcoming}</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                  <View style={styles.legend}>
                    <Text style={styles.legendItem}>
                      <Text style={{ color: ui.overdueText }}>●</Text> Overdue
                    </Text>
                    <Text style={styles.legendItem}>
                      <Text style={{ color: ui.dueText }}>●</Text> Due today
                    </Text>
                    <Text style={styles.legendItem}>
                      <Text style={{ color: ui.upcomingText }}>●</Text> Upcoming
                    </Text>
                  </View>
                </View>
              );
            }
            if (item.type === "section") {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{item.title}</Text>
                  <Text style={styles.sectionCount}>{item.countLabel}</Text>
                </View>
              );
            }
            return <DoseCard item={item.dose} primary={item.primary} canRecord={canRecord} />;
          }}
          ListFooterComponent={<View style={{ height: 28 }} />}
        />
      )}

      <ShedFilterSheet
        visible={shedPickerOpen}
        onClose={() => setShedPickerOpen(false)}
        options={shedOptions}
        selectedId={shedFilter}
        onSelect={(id) => setShedFilter(id)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  // Mirror Home farmRow / farmTitle / farmName placement over the hero.
  heroCopy: {
    marginTop: 18,
    paddingBottom: 6,
    gap: 4,
  },
  title: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: ui.ink,
    letterSpacing: -0.5,
  },
  subtitle: {
    flexShrink: 1,
    maxWidth: "72%",
    fontSize: typography.label.fontSize,
    fontWeight: "500",
    color: ui.muted,
    lineHeight: 20,
  },
  sheet: {
    marginTop: IMMERSIVE_HERO_SHEET_OVERLAP,
    backgroundColor: ui.bg,
  },
  filterWrap: {
    paddingHorizontal: ui.horizontal,
    paddingTop: 6,
    paddingBottom: 4,
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: ui.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  filterLabel: { flex: 1, fontSize: typography.body.fontSize, fontWeight: "700", color: ui.ink },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: ui.horizontal,
    paddingVertical: 12,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 72,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "flex-start",
    gap: 2,
  },
  summaryCount: { fontSize: typography.display.fontSize, fontWeight: "800", marginTop: 2 },
  summaryLabel: { fontSize: typography.overline.fontSize, fontWeight: "700", lineHeight: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { flex: 1, paddingHorizontal: ui.horizontal, justifyContent: "center", gap: 10 },
  errorTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: ui.ink },
  errorBody: { fontSize: typography.label.fontSize, color: ui.muted, lineHeight: 20 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: ui.brand,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 4,
  },
  retryText: { color: ui.white, fontWeight: "800", fontSize: typography.label.fontSize },
  emptyWrap: { flex: 1, paddingHorizontal: ui.horizontal },
  listContent: { paddingHorizontal: ui.horizontal, paddingBottom: 16, gap: 12 },
  overviewBlock: { gap: 8, marginBottom: 4 },
  byShedHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  byShedToggle: {
    fontSize: typography.secondary.fontSize,
    fontWeight: "700",
    color: ui.brand,
  },
  shedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: ui.white,
    borderRadius: ui.cardRadius,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  shedName: { flex: 1, fontSize: typography.body.fontSize, fontWeight: "800", color: ui.ink },
  dotRow: { flexDirection: "row", gap: 6 },
  countDot: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  countDotText: { fontSize: typography.caption.fontSize, fontWeight: "800" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 4, marginTop: 2 },
  legendItem: { fontSize: typography.overline.fontSize, fontWeight: "700", color: ui.muted },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
  },
  sectionTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: ui.ink },
  sectionCount: { fontSize: typography.secondary.fontSize, fontWeight: "600", color: ui.mutedSoft },
  card: {
    backgroundColor: ui.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    padding: 16,
    gap: 8,
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 2 },
  vaccineName: { flex: 1, fontSize: typography.body.fontSize, fontWeight: "800", color: ui.ink, paddingRight: 4 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: { fontSize: typography.overline.fontSize, fontWeight: "800", letterSpacing: 0.3 },
  cardChevron: { marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  metaIcon: { marginTop: 1 },
  metaText: { flex: 1, fontSize: typography.secondary.fontSize, color: ui.muted, fontWeight: "600", lineHeight: 18 },
  popHint: { fontSize: typography.caption.fontSize, color: ui.mutedSoft, fontWeight: "600", marginLeft: 23 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: ui.progressTrack,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: ui.progressFill, borderRadius: 999 },
  progressPct: { fontSize: typography.caption.fontSize, fontWeight: "700", color: ui.mutedSoft, minWidth: 32, textAlign: "right" },
  reviewBtn: {
    marginTop: 8,
    backgroundColor: ui.brand,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  reviewBtnText: { color: ui.white, fontWeight: "800", fontSize: typography.bodyStrong.fontSize },
});
