import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { ComponentProps, useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { listSheds, type ShedListItem } from "../../../src/api/sheds";
import { describeApiError } from "../../../src/api/client";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { media } from "../../../src/theme/media";
import { SafeAreaView } from "react-native-safe-area-context";

type IconName = ComponentProps<typeof Ionicons>["name"];
type ModeFilter = "all" | "owner" | "farmer";
type StatusFilter = "active" | "inactive" | "all";

const DEFAULT_MODE: ModeFilter = "all";
const DEFAULT_STATUS: StatusFilter = "active";

const ui = {
  bg: "#F1F8F5",
  white: "#FFFFFF",
  mintSurface: "#E5F5EF",
  iconMint: "#DDF5EB",
  cardBorder: "#D9E9E2",
  divider: "#E4EEE9",
  primaryText: "#142B26",
  secondaryText: "#64766F",
  mutedText: "#71827B",
  chipActive: "#07835D",
  chipBorder: "#D6E7DF",
  chipText: "#50655D",
  emerald: "#047857",
  codeGreen: "#059669",
  activePillBg: "#E0F4EC",
  activePillText: "#087F50",
  activeDot: "#12A76A",
  inactivePillBg: "#FEE7E5",
  inactivePillText: "#D92D20",
  inactiveDot: "#F04438",
  liveIcon: "#07804B",
  liveCircle: "#E5F6EF",
  bandedIcon: "#F97316",
  bandedCircle: "#FFF1E6",
  unbandedIcon: "#1677FF",
  unbandedCircle: "#EAF2FF",
  horizontal: 22,
};

const ILLUSTRATION_TONES = [
  { bg: "#DDF5EB", icon: "#07835D" },
  { bg: "#E3F0FF", icon: "#2563EB" },
  { bg: "#FFE8E6", icon: "#DC2626" },
  { bg: "#FFF3E0", icon: "#EA6500" },
];

/** Defensive defaults — production/legacy list payloads may omit aggregate fields. */
function shedListDefaults(item: ShedListItem): ShedListItem {
  return {
    ...item,
    manager_names: item.manager_names ?? [],
    organization_name: item.organization_name ?? null,
    active_batch_count: item.active_batch_count ?? 0,
    total_live_birds: item.total_live_birds ?? 0,
    banded_birds: item.banded_birds ?? 0,
    unbanded_birds: item.unbanded_birds ?? 0,
    count_mismatch: Boolean(item.count_mismatch),
    overdue_tasks: item.overdue_tasks ?? 0,
    due_today_tasks: item.due_today_tasks ?? 0,
    upcoming_tasks: item.upcoming_tasks ?? 0,
    needs_review_tasks: item.needs_review_tasks ?? 0,
  };
}

function softShadow() {
  return {
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  };
}

function toneForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h + id.charCodeAt(i) * (i + 1)) % 997;
  return ILLUSTRATION_TONES[h % ILLUSTRATION_TONES.length];
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipOn : styles.chipOff]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipLabel, active ? styles.chipLabelOn : styles.chipLabelOff]}>{label}</Text>
    </Pressable>
  );
}

function MetricCell({
  icon,
  mci,
  value,
  label,
  iconColor,
  circleBg,
  showDivider,
}: {
  icon?: IconName;
  mci?: ComponentProps<typeof MaterialCommunityIcons>["name"];
  value: number;
  label: string;
  iconColor: string;
  circleBg: string;
  showDivider?: boolean;
}) {
  return (
    <View style={styles.metricCell}>
      {showDivider ? <View style={styles.metricDivider} /> : null}
      <View style={[styles.metricIcon, { backgroundColor: circleBg }]}>
        {mci ? (
          <MaterialCommunityIcons name={mci} size={15} color={iconColor} />
        ) : (
          <Ionicons name={icon!} size={15} color={iconColor} />
        )}
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function ShedCard({
  item: raw,
  canUpdate,
  onMenu,
}: {
  item: ShedListItem;
  canUpdate: boolean;
  onMenu: (item: ShedListItem) => void;
}) {
  const item = shedListDefaults(raw);
  const tone = toneForId(item.id);
  const mode = item.is_owner_managed ? "Owner-managed" : "Farmer-managed";
  const managers =
    item.manager_names.length > 0
      ? item.manager_names.join(", ")
      : item.is_owner_managed
        ? "Owner"
        : "No farmer";
  const farm = item.organization_name?.trim() || "—";
  const openBirdManagement = () =>
    router.push({ pathname: "/(app)/sheds/[id]/birds", params: { id: item.id } });
  return (
    <View style={[styles.card, softShadow()]}>
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Pressable
            onPress={openBirdManagement}
            style={({ pressed }) => [
              styles.cardMainPress,
              pressed && { opacity: 0.94 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Open bird management for ${item.name}`}
          >
            <View style={[styles.illustration, { backgroundColor: tone.bg }]}>
              <Ionicons name="business" size={36} color={tone.icon} />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.cardCode} numberOfLines={1}>
                {item.code}
              </Text>
              <View style={styles.metaRow}>
                <Ionicons name="location-sharp" size={13} color={ui.secondaryText} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {farm}
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="person-outline" size={13} color={ui.secondaryText} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {mode} · {managers}
                </Text>
              </View>
            </View>
            <View style={styles.cardRight}>
              <View
                style={[
                  styles.statusPill,
                  {
                    backgroundColor: item.is_active ? ui.activePillBg : ui.inactivePillBg,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: item.is_active ? ui.activeDot : ui.inactiveDot },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    { color: item.is_active ? ui.activePillText : ui.inactivePillText },
                  ]}
                >
                  {item.is_active ? "Active" : "Inactive"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9AA8A1" style={styles.cardChevron} />
            </View>
          </Pressable>
          {canUpdate ? (
            <Pressable
              onPress={() => onMenu(item)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`More actions for ${item.name}`}
              style={styles.menuBtn}
            >
              <Ionicons name="ellipsis-vertical" size={18} color={ui.secondaryText} />
            </Pressable>
          ) : null}
        </View>

        <Pressable onPress={openBirdManagement} accessibilityRole="button" accessibilityLabel={`Shed metrics for ${item.name}`}>
          <View style={styles.metricsRow}>
            <MetricCell
              mci="bird"
              value={item.total_live_birds}
              label="Live birds"
              iconColor={ui.liveIcon}
              circleBg={ui.liveCircle}
            />
            <MetricCell
              icon="pricetag-outline"
              value={item.banded_birds}
              label="Banded"
              iconColor={ui.bandedIcon}
              circleBg={ui.bandedCircle}
              showDivider
            />
            <MetricCell
              icon="link-outline"
              value={item.unbanded_birds}
              label="Unbanded"
              iconColor={ui.unbandedIcon}
              circleBg={ui.unbandedCircle}
              showDivider
            />
          </View>
          {item.count_mismatch ? <Text style={styles.mismatch}>Counts need review</Text> : null}
        </Pressable>
      </View>

    </View>
  );
}

export default function ShedsScreen() {
  const { user, ownerAccountId } = useAuth();
  const canCreate = hasPermission(user, ownerAccountId, "shed.create");
  const canUpdate = hasPermission(user, ownerAccountId, "shed.update");

  const [q, setQ] = useState("");
  const [modeFilter, setModeFilter] = useState<ModeFilter>(DEFAULT_MODE);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS);
  const [draftMode, setDraftMode] = useState<ModeFilter>(DEFAULT_MODE);
  const [draftStatus, setDraftStatus] = useState<StatusFilter>(DEFAULT_STATUS);
  const [filterSheet, setFilterSheet] = useState(false);
  const [menuItem, setMenuItem] = useState<ShedListItem | null>(null);

  // Load inactive sheds when the user can manage them so Total vs Active summary stays accurate.
  const includeInactive = canUpdate;
  const sheds = useQuery({
    queryKey: ["sheds", ownerAccountId, includeInactive ? "with-inactive" : "active"],
    queryFn: () => listSheds({ includeInactive }),
    staleTime: 0,
  });

  useFocusEffect(
    useCallback(() => {
      void sheds.refetch();
    }, [includeInactive, ownerAccountId]),
  );

  const filtersActive = modeFilter !== DEFAULT_MODE || statusFilter !== DEFAULT_STATUS;

  const openFilterSheet = () => {
    setDraftMode(modeFilter);
    setDraftStatus(statusFilter);
    setFilterSheet(true);
  };

  const closeFilterSheet = () => {
    // Discard unapplied draft selections.
    setFilterSheet(false);
  };

  const applyFilters = () => {
    setModeFilter(draftMode);
    setStatusFilter(draftStatus);
    setFilterSheet(false);
  };

  const resetFilters = () => {
    setDraftMode(DEFAULT_MODE);
    setDraftStatus(DEFAULT_STATUS);
    setModeFilter(DEFAULT_MODE);
    setStatusFilter(DEFAULT_STATUS);
  };

  const scoped = useMemo(() => {
    let rows = (sheds.data ?? []).map(shedListDefaults);
    if (modeFilter === "owner") rows = rows.filter((s) => s.is_owner_managed);
    if (modeFilter === "farmer") rows = rows.filter((s) => !s.is_owner_managed);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(
        (s) => s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle),
      );
    }
    return rows;
  }, [sheds.data, modeFilter, q]);

  const data = useMemo(() => {
    let rows = scoped;
    if (statusFilter === "active") rows = rows.filter((s) => s.is_active);
    if (statusFilter === "inactive") rows = rows.filter((s) => !s.is_active);
    // Deterministic default order: Name (A–Z). No visible sort control.
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [scoped, statusFilter]);

  const totalCount = scoped.length;
  const activeCount = scoped.filter((s) => s.is_active).length;

  const listHeader = (
    <View style={styles.headerBlock}>
      <Text style={styles.title}>Sheds</Text>
      <Text style={styles.sub}>Search, filter, and open a shed overview</Text>

      <View style={styles.searchRow}>
        <View style={[styles.searchWrap, softShadow()]}>
          <Ionicons name="search" size={20} color={ui.secondaryText} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by name or code..."
            placeholderTextColor={ui.secondaryText}
            style={styles.search}
            returnKeyType="search"
            accessibilityLabel="Search sheds by name or code"
          />
          {q ? (
            <Pressable onPress={() => setQ("")} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={ui.mutedText} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={openFilterSheet}
          style={[styles.filterBtn, softShadow(), filtersActive && styles.filterBtnActive]}
          accessibilityRole="button"
          accessibilityLabel={filtersActive ? "Open filters, filters active" : "Open filters"}
        >
          <Ionicons name="options-outline" size={22} color={ui.chipActive} />
          {filtersActive ? <View style={styles.filterDot} /> : null}
        </Pressable>
        {canCreate ? (
          <Pressable
            onPress={() => router.push("/(app)/sheds/create")}
            style={[styles.addBtn, softShadow()]}
            accessibilityRole="button"
            accessibilityLabel="Add shed"
          >
            <Ionicons name="add" size={26} color={ui.white} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryMetric}>
          <View style={styles.summaryIcon}>
            <Ionicons name="business-outline" size={16} color={ui.chipActive} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>Total sheds</Text>
            <Text style={styles.summaryValue}>{sheds.isLoading ? "—" : totalCount}</Text>
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryMetric}>
          <View style={styles.summaryIcon}>
            <Ionicons name="stats-chart-outline" size={16} color={ui.chipActive} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>Active sheds</Text>
            <Text style={styles.summaryValue}>{sheds.isLoading ? "—" : activeCount}</Text>
          </View>
        </View>
      </View>

      {sheds.isError ? (
        <Pressable style={styles.errorBox} onPress={() => sheds.refetch()}>
          <Ionicons name="cloud-offline-outline" size={18} color="#D92D20" />
          <Text style={styles.errorText}>{describeApiError(sheds.error, "load sheds")}</Text>
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right", "top"]}>
      <FlatList
        style={styles.list}
        data={data}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={sheds.isRefetching}
            onRefresh={() => sheds.refetch()}
            tintColor={ui.chipActive}
            colors={[ui.chipActive]}
          />
        }
        ListEmptyComponent={
          sheds.isLoading ? (
            <HenLoader label="Loading sheds…" />
          ) : (
            <EmptyState
              title={
                q.trim() || modeFilter !== "all"
                  ? "No matching sheds"
                  : statusFilter === "inactive"
                    ? "No inactive sheds"
                    : statusFilter === "all"
                      ? "No sheds found"
                      : "No sheds yet"
              }
              body={
                q.trim() || modeFilter !== "all"
                  ? "Try adjusting search or filters."
                  : statusFilter === "inactive"
                    ? "Deactivated sheds will appear here."
                    : "Create a shed to house birds and assign farmers."
              }
              imageUri={media.shedYard}
              actionLabel={canCreate && statusFilter !== "inactive" && !q.trim() ? "Add first shed" : undefined}
              onAction={
                canCreate && statusFilter !== "inactive" && !q.trim()
                  ? () => router.push("/(app)/sheds/create")
                  : undefined
              }
            />
          )
        }
        renderItem={({ item }) => (
          <ShedCard item={item} canUpdate={canUpdate} onMenu={setMenuItem} />
        )}
      />

      <Modal visible={filterSheet} transparent animationType="fade" onRequestClose={closeFilterSheet}>
        <Pressable style={styles.sheetBackdrop} onPress={closeFilterSheet}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <Text style={styles.sheetSection}>Ownership</Text>
            <View style={styles.chipRow}>
              <Chip label="All modes" active={draftMode === "all"} onPress={() => setDraftMode("all")} />
              <Chip label="Owner" active={draftMode === "owner"} onPress={() => setDraftMode("owner")} />
              <Chip label="Farmer" active={draftMode === "farmer"} onPress={() => setDraftMode("farmer")} />
            </View>
            <Text style={[styles.sheetSection, { marginTop: 14 }]}>Status</Text>
            <View style={styles.chipRow}>
              <Chip label="Active" active={draftStatus === "active"} onPress={() => setDraftStatus("active")} />
              <Chip
                label="Inactive"
                active={draftStatus === "inactive"}
                onPress={() => setDraftStatus("inactive")}
              />
              <Chip label="All status" active={draftStatus === "all"} onPress={() => setDraftStatus("all")} />
            </View>
            <View style={styles.sheetActions}>
              <Pressable onPress={resetFilters} style={styles.sheetSecondary}>
                <Text style={styles.sheetSecondaryText}>Reset</Text>
              </Pressable>
              <Pressable onPress={applyFilters} style={styles.sheetPrimary}>
                <Text style={styles.sheetPrimaryText}>Apply</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={Boolean(menuItem)} transparent animationType="fade" onRequestClose={() => setMenuItem(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuItem(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {menuItem?.name ?? "Shed"}
            </Text>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                const id = menuItem?.id;
                setMenuItem(null);
                if (id) router.push({ pathname: "/(app)/sheds/[id]/birds", params: { id } });
              }}
            >
              <Text style={styles.menuOptionText}>Manage birds</Text>
            </Pressable>
            {canUpdate && menuItem ? (
              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  const id = menuItem.id;
                  setMenuItem(null);
                  router.push({ pathname: "/(app)/sheds/edit/[id]", params: { id } });
                }}
              >
                <Text style={styles.menuOptionText}>Edit shed</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                const id = menuItem?.id;
                setMenuItem(null);
                // Compatibility: advanced shed admin (assign farmer / deactivate) remains on details.
                if (id) router.push({ pathname: "/(app)/sheds/[id]", params: { id } });
              }}
            >
              <Text style={styles.menuOptionText}>Shed details</Text>
            </Pressable>
            <Pressable style={[styles.menuOption, { marginTop: 4 }]} onPress={() => setMenuItem(null)}>
              <Text style={[styles.menuOptionText, { color: ui.secondaryText }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  list: { flex: 1, backgroundColor: ui.bg },
  listContent: {
    paddingHorizontal: ui.horizontal,
    paddingBottom: 28,
    gap: 12,
    flexGrow: 1,
  },
  headerBlock: { gap: 14, paddingTop: 4, marginBottom: 2 },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: ui.primaryText,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 15,
    fontWeight: "500",
    color: ui.secondaryText,
    marginTop: -8,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  searchWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: ui.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingHorizontal: 14,
    minHeight: 54,
  },
  search: { flex: 1, fontSize: 15, color: ui.primaryText, paddingVertical: 12 },
  filterBtn: {
    width: 54,
    height: 54,
    borderRadius: 17,
    backgroundColor: ui.iconMint,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBtnActive: {
    borderWidth: 1.5,
    borderColor: ui.chipActive,
  },
  filterDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ui.chipActive,
    borderWidth: 1.5,
    borderColor: ui.iconMint,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: ui.chipActive },
  chipOff: {
    backgroundColor: ui.white,
    borderWidth: 1,
    borderColor: ui.chipBorder,
  },
  chipLabel: { fontSize: 14, fontWeight: "700" },
  chipLabelOn: { color: ui.white },
  chipLabelOff: { color: ui.chipText },
  addBtn: {
    width: 54,
    height: 54,
    borderRadius: 17,
    backgroundColor: ui.chipActive,
    alignItems: "center",
    justifyContent: "center",
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ui.mintSurface,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  summaryMetric: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ui.iconMint,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: { fontSize: 12, fontWeight: "600", color: ui.secondaryText },
  summaryValue: { fontSize: 22, fontWeight: "800", color: ui.primaryText, marginTop: 1 },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    height: 40,
    backgroundColor: ui.divider,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEE7E5",
    borderRadius: 14,
    padding: 12,
  },
  errorText: { flex: 1, color: ui.inactivePillText, fontWeight: "600", fontSize: 13 },
  retry: { color: ui.chipActive, fontWeight: "800", fontSize: 13 },
  card: {
    backgroundColor: ui.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    overflow: "hidden",
  },
  cardBody: { padding: 14, gap: 12 },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  cardMainPress: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 12, minWidth: 0 },
  illustration: {
    width: 84,
    height: 84,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: ui.primaryText },
  cardCode: { fontSize: 14, fontWeight: "700", color: ui.codeGreen },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  metaText: { flex: 1, fontSize: 13, color: ui.secondaryText, fontWeight: "500" },
  cardRight: { alignItems: "flex-end", justifyContent: "space-between", minHeight: 84 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "800" },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  cardChevron: { marginTop: "auto", marginBottom: 4 },
  metricsRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: ui.divider,
    paddingTop: 12,
  },
  metricCell: { flex: 1, alignItems: "center", gap: 3, position: "relative" },
  metricDivider: {
    position: "absolute",
    left: 0,
    top: 4,
    bottom: 4,
    width: StyleSheet.hairlineWidth,
    backgroundColor: ui.divider,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: { fontSize: 15, fontWeight: "800", color: ui.primaryText },
  metricLabel: { fontSize: 10, fontWeight: "600", color: ui.secondaryText, textAlign: "center" },
  mismatch: { fontSize: 12, fontWeight: "700", color: ui.bandedIcon },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2,44,34,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: ui.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28,
    gap: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: ui.primaryText, marginBottom: 6 },
  sheetSection: { fontSize: 13, fontWeight: "700", color: ui.secondaryText, marginBottom: 4 },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  sheetSecondary: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetSecondaryText: { fontWeight: "800", color: ui.chipText },
  sheetPrimary: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: ui.chipActive,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetPrimaryText: { fontWeight: "800", color: ui.white },
  menuOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ui.divider,
  },
  menuOptionText: { fontSize: 16, fontWeight: "600", color: ui.primaryText },
});
