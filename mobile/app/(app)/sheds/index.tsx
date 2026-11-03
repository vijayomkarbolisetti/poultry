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
import { SafeAreaView } from "react-native-safe-area-context";

import { listSheds, type ShedListItem } from "../../../src/api/sheds";
import { describeApiError } from "../../../src/api/client";
import { BrandLogo } from "../../../src/components/brand/BrandLogo";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import {
  IMMERSIVE_HERO_SHEET_OVERLAP,
  ImmersiveHeroHeader,
} from "../../../src/components/ui/ImmersiveHeroHeader";
import { APP_BRAND_NAME } from "../../../src/config/appConfig";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { sumLiveBirds } from "../../../src/features/sheds/sumLiveBirds";
import { heroArt, media } from "../../../src/theme/media";
import { typography } from "../../../src/theme/tokens";


type IconName = ComponentProps<typeof Ionicons>["name"];
type ModeFilter = "all" | "owner" | "farmer";
type StatusFilter = "active" | "inactive" | "all";

const DEFAULT_MODE: ModeFilter = "all";
const DEFAULT_STATUS: StatusFilter = "active";

/** Exact palette from the Sheds reference. */
const ui = {
  deepGreen: "#176B45",
  paleMint: "#EFFFEB",
  copper: "#B96F3B",
  bg: "#F1F9F5",
  primaryText: "#102E25",
  secondaryText: "#64736F",
  white: "#FFFFFF",
  cardBorder: "#DCEBE4",
  activePillBg: "#DDF8E7",
  activePillText: "#087C46",
  activeDot: "#087C46",
  inactivePillBg: "#FEE7E5",
  inactivePillText: "#D92D20",
  inactiveDot: "#F04438",
  summaryBg: "#DFF5EA",
  blueAccent: "#E3EEFF",
  blueIcon: "#1769D2",
  liveIcon: "#087C46",
  liveCircle: "#DDF8E7",
  bandedIcon: "#D96B00",
  bandedCircle: "#FFF0D9",
  unbandedIcon: "#1769D2",
  unbandedCircle: "#E3EEFF",
  farmerPillBg: "#FFF0D9",
  farmerPillText: "#74400C",
  ownerPillBg: "#DDF8E7",
  ownerPillText: "#176B45",
  divider: "#DCEBE4",
  filterBg: "#EFFFEB",
  horizontal: 24,
};

/** Stable shed-icon accents in reference order: orange → green → blue. */
const ILLUSTRATION_TONES = [
  { bg: "#FFF0D9", icon: "#D96B00" },
  { bg: "#DDF8E7", icon: "#087C46" },
  { bg: "#E3EEFF", icon: "#1769D2" },
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

function toneForIndex(index: number) {
  return ILLUSTRATION_TONES[index % ILLUSTRATION_TONES.length];
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
          <MaterialCommunityIcons name={mci} size={16} color={iconColor} />
        ) : (
          <Ionicons name={icon!} size={16} color={iconColor} />
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
  index,
  canUpdate,
  onMenu,
}: {
  item: ShedListItem;
  index: number;
  canUpdate: boolean;
  onMenu: (item: ShedListItem) => void;
}) {
  const item = shedListDefaults(raw);
  const tone = toneForIndex(index);
  const modeLabel = item.is_owner_managed ? "Owner Managed" : "Farmer Managed";
  const modePillBg = item.is_owner_managed ? ui.ownerPillBg : ui.farmerPillBg;
  const modePillText = item.is_owner_managed ? ui.ownerPillText : ui.farmerPillText;
  const openBirdManagement = () =>
    router.push({ pathname: "/(app)/sheds/[id]/birds", params: { id: item.id } });

  return (
    <View style={[styles.card, softShadow()]}>
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Pressable
            onPress={openBirdManagement}
            style={({ pressed }) => [styles.cardIdentityPress, pressed && { opacity: 0.94 }]}
            accessibilityRole="button"
            accessibilityLabel={`Open shed management for ${item.name}`}
          >
            <View style={[styles.illustration, { backgroundColor: tone.bg }]}>
              <Ionicons name="home" size={36} color={tone.icon} />
            </View>
            <View style={styles.cardInfo}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.name}
                </Text>
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
              </View>
              <View style={[styles.modePill, { backgroundColor: modePillBg }]}>
                <Ionicons name="person" size={12} color={modePillText} />
                <Text style={[styles.modePillText, { color: modePillText }]} numberOfLines={2}>
                  {modeLabel}
                </Text>
              </View>
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
              <Ionicons name="ellipsis-vertical" size={20} color={ui.secondaryText} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={openBirdManagement}
          accessibilityRole="button"
          accessibilityLabel={`Shed metrics for ${item.name}`}
          style={styles.metricsPress}
        >
          <View style={styles.metricsRow}>
            <View style={styles.metricsCols}>
              <MetricCell
                mci="bird"
                value={item.total_live_birds}
                label="Live Birds"
                iconColor={ui.liveIcon}
                circleBg={ui.liveCircle}
              />
              <MetricCell
                icon="pricetag"
                value={item.banded_birds}
                label="Banded"
                iconColor={ui.bandedIcon}
                circleBg={ui.bandedCircle}
                showDivider
              />
              <MetricCell
                icon="link"
                value={item.unbanded_birds}
                label="Unbanded"
                iconColor={ui.unbandedIcon}
                circleBg={ui.unbandedCircle}
                showDivider
              />
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9AA8A1" style={styles.cardChevron} />
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

  // Load inactive sheds when the user can manage them so Total sheds stays accurate.
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
      rows = rows.filter((s) => s.name.toLowerCase().includes(needle));
    }
    return rows;
  }, [sheds.data, modeFilter, q]);

  const data = useMemo(() => {
    let rows = scoped;
    if (statusFilter === "active") rows = rows.filter((s) => s.is_active);
    if (statusFilter === "inactive") rows = rows.filter((s) => !s.is_active);
    return [...rows].sort((a, b) => a.name.localeCompare(b.name));
  }, [scoped, statusFilter]);

  const totalCount = scoped.length;
  /** Living birds across scoped sheds (same set as Total sheds). Server `total_live_birds`
   * already excludes sold/dead/inactive; includes banded + unbanded. */
  const totalBirds = useMemo(() => sumLiveBirds(scoped), [scoped]);

  const listHeader = (
    <View style={styles.headerBlock}>
      <ImmersiveHeroHeader
        source={heroArt.sheds}
        curveFill={ui.bg}
        accessibilityLabel="Sheds farm illustration"
        contentStyle={styles.heroCopy}
      >
        <View style={styles.brandRow}>
          <BrandLogo size={26} preferPng accessibilityLabel={`${APP_BRAND_NAME} logo`} />
          <Text style={styles.brandName}>
            {APP_BRAND_NAME}
            <Text style={styles.brandMark}>™</Text>
          </Text>
        </View>
        <View style={styles.titleCopy}>
          <Text style={styles.title}>Sheds</Text>
          <Text style={styles.sub}>Search, filter and open a shed to manage birds</Text>
        </View>
      </ImmersiveHeroHeader>

      <View style={styles.headerBody}>
        <View style={styles.searchRow}>
          <View style={[styles.searchWrap, softShadow()]}>
            <Ionicons name="search" size={20} color={ui.secondaryText} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search sheds..."
              placeholderTextColor={ui.secondaryText}
              style={styles.search}
              returnKeyType="search"
              accessibilityLabel="Search sheds"
            />
            {q ? (
              <Pressable onPress={() => setQ("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={ui.secondaryText} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={openFilterSheet}
            style={[styles.filterBtn, softShadow(), filtersActive && styles.filterBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={filtersActive ? "Open filters, filters active" : "Open filters"}
          >
            <Ionicons name="options-outline" size={24} color={ui.deepGreen} />
            {filtersActive ? <View style={styles.filterDot} /> : null}
          </Pressable>
          {canCreate ? (
            <Pressable
              onPress={() => router.push("/(app)/sheds/create")}
              style={[styles.addBtn, softShadow()]}
              accessibilityRole="button"
              accessibilityLabel="Add Shed"
            >
              <Ionicons name="add" size={22} color={ui.white} />
              <Text style={styles.addBtnText}>Add Shed</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryMetric}>
            <View style={styles.summaryIcon}>
              <Ionicons name="home" size={20} color={ui.deepGreen} />
            </View>
            <View>
              <Text style={styles.summaryLabel}>Total Sheds</Text>
              <Text style={styles.summaryValue}>{sheds.isLoading ? "—" : totalCount}</Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryMetric}>
            <View style={styles.summaryIcon}>
              <MaterialCommunityIcons name="bird" size={20} color={ui.deepGreen} />
            </View>
            <View>
              <Text style={styles.summaryLabel}>Total Birds</Text>
              <Text style={styles.summaryValue}>{sheds.isLoading ? "—" : totalBirds}</Text>
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
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
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
            tintColor={ui.deepGreen}
            colors={[ui.deepGreen]}
          />
        }
        ListEmptyComponent={
          <View style={styles.paddedBlock}>
            {sheds.isLoading ? (
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
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.paddedBlock}>
            <ShedCard item={item} index={index} canUpdate={canUpdate} onMenu={setMenuItem} />
          </View>
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
              <Text style={styles.menuOptionText}>Open shed</Text>
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
    paddingBottom: 28,
    gap: 16,
    flexGrow: 1,
  },
  headerBlock: { marginBottom: 8 },
  heroCopy: {
    flexGrow: 1,
    justifyContent: "space-between",
    gap: 12,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandName: {
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: ui.deepGreen,
    letterSpacing: -0.2,
  },
  brandMark: { color: ui.copper, fontSize: typography.overline.fontSize, fontWeight: "700" },
  titleCopy: {
    gap: 6,
    paddingBottom: 4,
    maxWidth: "62%",
  },
  title: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: ui.primaryText,
    letterSpacing: -0.6,
  },
  sub: {
    fontSize: typography.label.fontSize,
    fontWeight: "500",
    color: ui.secondaryText,
    lineHeight: 20,
  },
  headerBody: {
    gap: 14,
    paddingHorizontal: ui.horizontal,
    marginTop: IMMERSIVE_HERO_SHEET_OVERLAP,
  },
  paddedBlock: { paddingHorizontal: ui.horizontal },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchWrap: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "56%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: ui.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#CDE5D9",
    paddingHorizontal: 12,
    minHeight: 56,
  },
  search: {
    flex: 1,
    minWidth: 0,
    fontSize: typography.body.fontSize,
    color: ui.primaryText,
    paddingVertical: 10,
    includeFontPadding: false,
  },
  filterBtn: {
    width: 56,
    height: 56,
    flexShrink: 0,
    borderRadius: 18,
    backgroundColor: ui.filterBg,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBtnActive: {
    borderWidth: 1.5,
    borderColor: ui.deepGreen,
  },
  filterDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ui.deepGreen,
    borderWidth: 1.5,
    borderColor: ui.filterBg,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flexShrink: 0,
    minHeight: 56,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: ui.deepGreen,
  },
  addBtnText: { color: ui.white, fontSize: typography.button.fontSize, fontWeight: "800" },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ui.summaryBg,
    borderRadius: 24,
    minHeight: 110,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  summaryMetric: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ui.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: { fontSize: typography.label.fontSize, fontWeight: "600", color: ui.secondaryText },
  summaryValue: { fontSize: typography.display.fontSize, fontWeight: "800", color: ui.primaryText, marginTop: 1 },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    height: 52,
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
  errorText: { flex: 1, color: ui.inactivePillText, fontWeight: "600", fontSize: typography.secondary.fontSize },
  retry: { color: ui.deepGreen, fontWeight: "800", fontSize: typography.secondary.fontSize },
  card: {
    backgroundColor: ui.white,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    overflow: "hidden",
  },
  cardBody: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, gap: 12 },
  cardTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  cardIdentityPress: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  illustration: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: { flex: 1, minWidth: 0, gap: 8 },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: ui.primaryText,
    letterSpacing: -0.3,
  },
  modePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modePillText: { fontSize: typography.caption.fontSize, fontWeight: "700" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: typography.overline.fontSize, fontWeight: "800" },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  metricsPress: { gap: 6 },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: ui.divider,
    paddingTop: 12,
    gap: 4,
  },
  metricsCols: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    minWidth: 0,
  },
  metricCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 3,
    position: "relative",
    paddingHorizontal: 2,
  },
  metricDivider: {
    position: "absolute",
    left: 0,
    top: 2,
    bottom: 2,
    width: StyleSheet.hairlineWidth,
    backgroundColor: ui.divider,
  },
  metricIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: { fontSize: typography.display.fontSize, fontWeight: "800", color: ui.primaryText },
  metricLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: ui.secondaryText,
    textAlign: "center",
  },
  cardChevron: { width: 18, marginLeft: 2, flexShrink: 0 },
  mismatch: { fontSize: typography.caption.fontSize, fontWeight: "700", color: ui.bandedIcon },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: ui.deepGreen },
  chipOff: {
    backgroundColor: ui.white,
    borderWidth: 1,
    borderColor: ui.cardBorder,
  },
  chipLabel: { fontSize: typography.label.fontSize, fontWeight: "700" },
  chipLabelOn: { color: ui.white },
  chipLabelOff: { color: ui.secondaryText },
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
  sheetTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: ui.primaryText, marginBottom: 6 },
  sheetSection: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: ui.secondaryText, marginBottom: 4 },
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
  sheetSecondaryText: { fontWeight: "800", color: ui.secondaryText },
  sheetPrimary: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: ui.deepGreen,
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
  menuOptionText: { fontSize: typography.bodyStrong.fontSize, fontWeight: "600", color: ui.primaryText },
});
