import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
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
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
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
import { media } from "../../../src/theme/media";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";

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
      <MetaRow icon="home-outline" text={`${item.shed_name} · ${item.flock_label}`} />
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
  const [shedFilter, setShedFilter] = useState<ShedFilter>("all");
  const [shedPickerOpen, setShedPickerOpen] = useState(false);

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

  const shedOptions = useMemo(() => {
    const sheds = query.data?.sheds ?? [];
    return [
      { id: "all" as ShedFilter, label: "All sheds" },
      ...sheds.map((s) => ({ id: s.id as ShedFilter, label: s.name })),
    ];
  }, [query.data?.sheds]);

  const shedLabel =
    shedOptions.find((s) => s.id === shedFilter)?.label ??
    (shedFilter === "all" ? "All sheds" : "Shed");

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

  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const farmName = membership?.organization_name?.trim() || "Your farm";

  const refreshing = query.isRefetching && !query.isLoading;
  const showInitialLoader = query.isLoading && !query.data;
  const errorMessage = query.error
    ? describeApiError(query.error, "load vaccination schedule")
    : null;
  const isEmpty = !showInitialLoader && !errorMessage && rows.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Vaccination</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {farmName}
        </Text>
      </View>

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
          <SummaryCard label="Needs review" count={summary.needsReview} tone="review" icon="help-circle" />
        </View>
      ) : null}

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
              return (
                <View style={styles.overviewBlock}>
                  <Text style={styles.sectionTitle}>By shed</Text>
                  {item.rows.map((row) => (
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

      <Modal visible={shedPickerOpen} transparent animationType="fade" onRequestClose={() => setShedPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShedPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filter by shed</Text>
            {shedOptions.map((opt) => {
              const active = shedFilter === opt.id;
              return (
                <Pressable
                  key={String(opt.id)}
                  style={[styles.modalRow, active && styles.modalRowActive]}
                  onPress={() => {
                    setShedFilter(opt.id);
                    setShedPickerOpen(false);
                  }}
                >
                  <Text style={[styles.modalRowText, active && styles.modalRowTextActive]}>{opt.label}</Text>
                  {active ? <Ionicons name="checkmark" size={18} color={ui.brand} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: { paddingHorizontal: ui.horizontal, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 28, fontWeight: "800", color: ui.ink },
  subtitle: { marginTop: 2, fontSize: 14, color: ui.muted, fontWeight: "600" },
  filterWrap: { paddingHorizontal: ui.horizontal, paddingTop: 10, paddingBottom: 4 },
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
  filterLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: ui.ink },
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
  summaryCount: { fontSize: 20, fontWeight: "800", marginTop: 2 },
  summaryLabel: { fontSize: 11, fontWeight: "700", lineHeight: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { flex: 1, paddingHorizontal: ui.horizontal, justifyContent: "center", gap: 10 },
  errorTitle: { fontSize: 18, fontWeight: "800", color: ui.ink },
  errorBody: { fontSize: 14, color: ui.muted, lineHeight: 20 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: ui.brand,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 4,
  },
  retryText: { color: ui.white, fontWeight: "800", fontSize: 14 },
  emptyWrap: { flex: 1, paddingHorizontal: ui.horizontal },
  listContent: { paddingHorizontal: ui.horizontal, paddingBottom: 16, gap: 12 },
  overviewBlock: { gap: 8, marginBottom: 4 },
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
  shedName: { flex: 1, fontSize: 15, fontWeight: "800", color: ui.ink },
  dotRow: { flexDirection: "row", gap: 6 },
  countDot: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  countDotText: { fontSize: 12, fontWeight: "800" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 4, marginTop: 2 },
  legendItem: { fontSize: 11, fontWeight: "700", color: ui.muted },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 8,
    marginBottom: 2,
  },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: ui.ink },
  sectionCount: { fontSize: 13, fontWeight: "600", color: ui.mutedSoft },
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
  vaccineName: { flex: 1, fontSize: 16, fontWeight: "800", color: ui.ink, paddingRight: 4 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  cardChevron: { marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  metaIcon: { marginTop: 1 },
  metaText: { flex: 1, fontSize: 13, color: ui.muted, fontWeight: "600", lineHeight: 18 },
  popHint: { fontSize: 12, color: ui.mutedSoft, fontWeight: "600", marginLeft: 23 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: ui.progressTrack,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: ui.progressFill, borderRadius: 999 },
  progressPct: { fontSize: 12, fontWeight: "700", color: ui.mutedSoft, minWidth: 32, textAlign: "right" },
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
  reviewBtnText: { color: ui.white, fontWeight: "800", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 30, 25, 0.35)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: ui.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 4,
  },
  modalTitle: { fontSize: 17, fontWeight: "800", color: ui.ink, marginBottom: 8 },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  modalRowActive: { backgroundColor: ui.brandSoft },
  modalRowText: { fontSize: 15, fontWeight: "600", color: ui.ink },
  modalRowTextActive: { color: ui.brand, fontWeight: "800" },
});
