import Ionicons from "@expo/vector-icons/Ionicons";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listBirdsInShed, type ShedBirdListItem } from "../../../../src/api/birds";
import { describeApiError } from "../../../../src/api/client";
import { getShedOverview } from "../../../../src/api/sheds";
import {
  DEFAULT_BIRDS_FILTERS,
  type BirdsFilterState,
} from "../../../../src/components/birds/BirdsFilterSheet";
import {
  MortalityActionSheet,
  unbandedMortalityPayload,
  type MortalityBandedPayload,
  type MortalityUnbandedPayload,
} from "../../../../src/components/birds/MortalityActionSheet";
import {
  SaleActionSheet,
  unbandedSalePayload,
  type SaleBandedPayload,
  type SaleUnbandedPayload,
} from "../../../../src/components/birds/SaleActionSheet";
import {
  TransferActionSheet,
  type TransferBandedPayload,
  type TransferUnbandedPayload,
} from "../../../../src/components/birds/TransferActionSheet";
import { ShedManagePanel } from "../../../../src/components/sheds/ShedManagePanel";
import { AppDialog } from "../../../../src/components/ui/AppDialog";
import { Button } from "../../../../src/components/ui/Button";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { ImmersiveHeroHeader } from "../../../../src/components/ui/ImmersiveHeroHeader";
import { Screen } from "../../../../src/components/ui/Screen";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import {
  formatRelativeAgeLabel,
  formatSexLabel,
  formatUnbandedCohortLabel,
  normalizeSexSelectValue,
} from "../../../../src/features/birds/birdListHelpers";
import {
  clearTransferDraft,
  consumeTransferDraft,
  peekTransferDraft,
  resumeFieldsFromDraft,
  type TransferSheetResume,
} from "../../../../src/features/birds/transferDraftStore";
import {
  areAllEligibleSelected,
  birdLabel,
  eligibleIdsFromLoaded,
  formatSelectedBirdsLabel,
  isLifecycleEligible,
  reconcileSelectionToLoaded,
  selectAllLoadedScopeMessage,
  toggleSelectAllLoaded,
  toggleSelection,
} from "../../../../src/features/birds/birdSelectionHelpers";
import {
  buildBirdMgmtContextKey,
  unbandedBulkActionAllowed,
} from "../../../../src/features/birds/birdManagementUiHelpers";
import { cohortKeyFromAge } from "../../../../src/features/birds/transferHelpers";
import { firstRouteParam } from "../../../../src/navigation/routeParams";
import { safeBack } from "../../../../src/navigation/safeBack";
import { birdUi } from "../../../../src/theme/birdManagementUi";
import { birdIcons, shedHeaderArt } from "../../../../src/theme/media";
import { typography } from "../../../../src/theme/tokens";


const PAGE = 20;
type TabKey = "banded" | "unbanded";

type UnbandedRow = {
  flock_id: string;
  unbanded_count: number;
  hatch_date: string | null;
  estimated_age_days: number | null;
  breed: string | null;
  label: string;
};

export default function ShedBirdsScreen() {
  const params = useLocalSearchParams<{
    id: string | string[];
    focus?: string | string[];
    resumeTransfer?: string | string[];
  }>();
  const id = firstRouteParam(params.id);
  const focus = firstRouteParam(params.focus);
  const resumeTransferFlag = firstRouteParam(params.resumeTransfer);
  const insets = useSafeAreaInsets();
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const canCreate = hasPermission(user, ownerAccountId, "bird.create");
  const canCreateGroup = hasPermission(user, ownerAccountId, "flock.create");
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");
  const canRecordVaccination = hasPermission(user, ownerAccountId, "vaccination.record");
  const canUpdateShed = hasPermission(user, ownerAccountId, "shed.update");

  const [tab, setTab] = useState<TabKey>("banded");
  const [showManage, setShowManage] = useState(false);
  const [filters] = useState<BirdsFilterState>(DEFAULT_BIRDS_FILTERS);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [mortalityPayload, setMortalityPayload] = useState<
    MortalityBandedPayload | MortalityUnbandedPayload | null
  >(null);
  const [salePayload, setSalePayload] = useState<SaleBandedPayload | SaleUnbandedPayload | null>(
    null,
  );
  const [transferPayload, setTransferPayload] = useState<
    TransferBandedPayload | TransferUnbandedPayload | null
  >(null);
  const [transferResume, setTransferResume] = useState<TransferSheetResume | null>(null);
  const [selectAllNote, setSelectAllNote] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterKey = useRef("");

  useEffect(() => {
    if (focus !== "add" || !id) return;
    if (!canCreate && !canCreateGroup) return;
    router.push({
      pathname: "/(app)/birds/add",
      params: { shedId: id, mode: canCreate ? "banded" : "unbanded" },
    });
  }, [focus, canCreate, canCreateGroup, id]);

  // Resume Transfer after Create Shed (or cancel-back from create while draft exists).
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      const pending = peekTransferDraft();
      if (!pending || pending.payload.shedId !== id) return;
      const draft = consumeTransferDraft();
      if (!draft || draft.payload.shedId !== id) return;
      setTransferResume(resumeFieldsFromDraft(draft));
      setTransferPayload(draft.payload);
      if (draft.payload.mode === "banded") {
        setSelected(new Set(draft.payload.birdIds));
        setTab("banded");
      } else {
        setSelected(new Set([draft.payload.flockId]));
        setTab("unbanded");
      }
      void qc.invalidateQueries({ queryKey: ["sheds"] });
    }, [id, resumeTransferFlag, qc]),
  );

  const overview = useQuery({
    queryKey: ["shed-overview", id],
    queryFn: () => getShedOverview(id!),
    enabled: !!id && canView,
    staleTime: 0,
  });

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      void qc.invalidateQueries({ queryKey: ["shed-overview", id] });
      void qc.invalidateQueries({ queryKey: ["shed-birds", id] });
    }, [id, qc]),
  );

  const lifecycleStatus = filters.status && filters.status !== "" ? filters.status : null;
  const includeInactive = !!lifecycleStatus;

  const birds = useInfiniteQuery({
    queryKey: ["shed-birds", id, debouncedQ, filters.flockId, filters.status],
    enabled: canView && !!id && tab === "banded",
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listBirdsInShed({
        shedId: id!,
        flockId: filters.flockId,
        q: debouncedQ || undefined,
        lifecycleStatus,
        includeInactive,
        limit: PAGE,
        offset: pageParam,
      }),
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return next < last.total ? next : undefined;
    },
  });

  /** Lightweight fetch for unbanded summaries even when banded tab is active (counts). */
  const birdsSummary = useQuery({
    queryKey: ["shed-birds-summary", id],
    enabled: canView && !!id,
    queryFn: () => listBirdsInShed({ shedId: id!, limit: 1, offset: 0 }),
  });

  const items = useMemo(
    () => birds.data?.pages.flatMap((p) => p.items) ?? [],
    [birds.data],
  );
  const total = birds.data?.pages[0]?.total ?? 0;
  const unbandedBatchesApi =
    birds.data?.pages[0]?.unbanded_batches ?? birdsSummary.data?.unbanded_batches ?? [];
  const loadedEligibleIds = useMemo(() => eligibleIdsFromLoaded(items), [items]);
  const loadedEligibleKey = loadedEligibleIds.join(",");

  const shed = overview.data?.shed;
  const population = overview.data?.population;
  const batches = overview.data?.batches ?? [];
  const assignments = overview.data?.assignments ?? [];
  const overviewByFlockId = useMemo(() => {
    const map = new Map<string, (typeof batches)[number]>();
    for (const b of batches) map.set(b.id, b);
    return map;
  }, [batches]);

  const bandedCount = population?.banded_birds ?? total;
  const unbandedCount =
    population?.unbanded_birds ??
    birdsSummary.data?.unbanded_total ??
    birds.data?.pages[0]?.unbanded_total ??
    0;
  const liveCount = population?.total_live_birds ?? bandedCount + unbandedCount;

  const unbandedRows: UnbandedRow[] = useMemo(() => {
    const rows = unbandedBatchesApi
      .filter((b) => b.unbanded_count > 0)
      .map((b) => {
        const ov = overviewByFlockId.get(b.flock_id);
        const hatch_date = ov?.hatch_date ?? null;
        const estimated_age_days = ov?.estimated_age_days ?? null;
        const label = formatUnbandedCohortLabel({
          hatch_date,
          estimated_age_days,
          unbanded_count: b.unbanded_count,
        });
        return {
          flock_id: b.flock_id,
          unbanded_count: b.unbanded_count,
          hatch_date,
          estimated_age_days,
          breed: ov?.breed ?? null,
          label,
        };
      });
    const qLower = debouncedQ.trim().toLowerCase();
    if (!qLower) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(qLower) ||
        (r.breed ?? "").toLowerCase().includes(qLower) ||
        (r.hatch_date ?? "").includes(qLower),
    );
  }, [unbandedBatchesApi, overviewByFlockId, debouncedQ]);

  // Never carry selection or manage panel across sheds.
  useEffect(() => {
    setSelected(new Set());
    setShowManage(false);
    filterKey.current = "";
  }, [id]);

  useEffect(() => {
    const key = buildBirdMgmtContextKey({
      tab,
      q: debouncedQ,
      flockId: filters.flockId,
      status: filters.status,
    });
    if (filterKey.current === key) return;
    filterKey.current = key;
    setSelected(new Set());
  }, [tab, debouncedQ, filters.flockId, filters.status]);

  useEffect(() => {
    if (tab !== "banded") return;
    const eligibleIds = loadedEligibleKey ? loadedEligibleKey.split(",") : [];
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const { next, removed } = reconcileSelectionToLoaded(prev, eligibleIds);
      // Return the same Set reference when nothing changed — a new Set every
      // render would loop because derived id arrays get new identities each pass.
      if (removed === 0 && next.size === prev.size) return prev;
      return next;
    });
  }, [loadedEligibleKey, tab]);

  const onSearchChange = (text: string) => {
    setQ(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(text.trim()), 350);
  };

  const clearSearch = () => {
    setQ("");
    setDebouncedQ("");
  };

  const emptyPopulation = bandedCount === 0 && unbandedCount === 0 && !debouncedQ;
  const managedLabel = shed?.is_owner_managed ? "Owner-managed" : "Farmer-managed";
  const farmerNames = assignments
    .map((a) => a.farmer_name ?? a.farmer_email ?? "Farmer")
    .join(", ");

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["shed-birds", id] });
    void qc.invalidateQueries({ queryKey: ["shed-birds-summary", id] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", id] });
    void qc.invalidateQueries({ queryKey: ["flocks", id] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] });
  };

  const openMortality = () => {
    if (!id || selected.size === 0) return;
    if (tab === "banded") {
      const labels = items.filter((b) => selected.has(b.id)).map(birdLabel);
      setMortalityPayload({ mode: "banded", birdIds: [...selected], labels });
      return;
    }
    if (selected.size !== 1) {
      setMortalityPayload(null);
      return;
    }
    const flockId = [...selected][0]!;
    const row = unbandedRows.find((r) => r.flock_id === flockId);
    if (!row) return;
    setMortalityPayload(
      unbandedMortalityPayload({
        shedId: id,
        flockId: row.flock_id,
        label: row.label,
        unbandedCount: row.unbanded_count,
        hatch_date: row.hatch_date,
        estimated_age_days: row.estimated_age_days,
      }),
    );
  };

  const openTransfer = () => {
    if (!id || selected.size === 0) return;
    if (tab === "banded") {
      const selectedBirds = items.filter((b) => selected.has(b.id));
      setTransferPayload({
        mode: "banded",
        shedId: id,
        birdIds: [...selected],
        labels: selectedBirds.map(birdLabel),
        birds: selectedBirds.map((b) => ({
          id: b.id,
          flock_id: b.flock_id,
          hatch_date: b.hatch_date,
          estimated_age_days: b.estimated_age_days,
          is_active: b.is_active,
          lifecycle_status: b.lifecycle_status,
        })),
      });
      return;
    }
    if (selected.size !== 1) return;
    const flockId = [...selected][0]!;
    const row = unbandedRows.find((r) => r.flock_id === flockId);
    if (!row) return;
    setTransferPayload({
      mode: "unbanded",
      shedId: id,
      flockId: row.flock_id,
      label: row.label,
      unbandedCount: row.unbanded_count,
      key: cohortKeyFromAge({
        hatch_date: row.hatch_date,
        estimated_age_days: row.estimated_age_days,
      }),
    });
  };

  const openSale = () => {
    if (!id || selected.size === 0) return;
    if (tab === "banded") {
      const labels = items.filter((b) => selected.has(b.id)).map(birdLabel);
      setSalePayload({ mode: "banded", birdIds: [...selected], labels });
      return;
    }
    if (selected.size !== 1) {
      setSalePayload(null);
      return;
    }
    const flockId = [...selected][0]!;
    const row = unbandedRows.find((r) => r.flock_id === flockId);
    if (!row) return;
    setSalePayload(
      unbandedSalePayload({
        shedId: id,
        flockId: row.flock_id,
        label: row.label,
        unbandedCount: row.unbanded_count,
        hatch_date: row.hatch_date,
        estimated_age_days: row.estimated_age_days,
      }),
    );
  };

  const onActionSuccess = () => {
    clearTransferDraft();
    setTransferResume(null);
    setSelected(new Set());
    invalidate();
    void qc.invalidateQueries({ queryKey: ["sold-birds"] });
    void qc.invalidateQueries({ queryKey: ["dead-birds"] });
    void overview.refetch();
    void birds.refetch();
    void birdsSummary.refetch();
  };

  const unbandedBulk = unbandedBulkActionAllowed(tab === "unbanded" ? selected.size : 0);
  const unbandedMultiHint = tab === "unbanded" ? unbandedBulk.hint : null;

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view birds.</Text>
        <Button
          label="Back"
          variant="secondary"
          onPress={() => safeBack("/(app)/sheds")}
        />
      </Screen>
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <Screen>
        <HenLoader label="Loading birds…" />
      </Screen>
    );
  }

  if (overview.isError) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(overview.error, "load shed")}</Text>
        <Button label="Retry" onPress={() => overview.refetch()} />
      </Screen>
    );
  }

  // Banded multi-select must work for vaccination-only users (no lifecycle.record),
  // so they can open Record vaccination without visiting each Bird Profile.
  const canSelectBanded =
    (canLifecycle || canRecordVaccination) && !!shed?.is_active;
  const showBulkBar =
    !!shed?.is_active &&
    selected.size > 0 &&
    (canLifecycle || (canRecordVaccination && tab === "banded"));
  const bulkDisabledUnbanded = tab === "unbanded" && !unbandedBulk.ok;
  const allLoadedSelected =
    tab === "banded" && areAllEligibleSelected(selected, loadedEligibleIds);
  const showSelectAll =
    canSelectBanded && tab === "banded" && loadedEligibleIds.length > 0;

  const openRecordVaccination = () => {
    if (!id || selected.size === 0 || tab !== "banded") return;
    const ids = [...selected];
    const birdLabels = items.filter((b) => selected.has(b.id)).map((b) => birdLabel(b));
    router.push({
      pathname: "/(app)/birds/record-vaccination",
      params: {
        shedId: id,
        birdIds: ids.join(","),
        labels: birdLabels.join("|"),
      },
    });
    setSelected(new Set());
  };

  const onSelectAllPress = () => {
    const selecting = !allLoadedSelected;
    setSelected((prev) => toggleSelectAllLoaded(prev, loadedEligibleIds));
    if (!selecting) return;
    const scopeNote = selectAllLoadedScopeMessage(birds.hasNextPage);
    if (scopeNote) {
      setSelectAllNote(scopeNote);
    }
  };

  const listHeader = (
    <View style={styles.headerBlock}>
      <ImmersiveHeroHeader
        source={shedHeaderArt}
        curveFill={birdUi.bg}
        accessibilityLabel="Shed header illustration"
        contentStyle={styles.heroCopy}
      >
        <View style={styles.heroTop}>
          <Pressable
            onPress={() => safeBack("/(app)/sheds")}
            style={styles.backBtn}
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={22} color={birdUi.text} />
          </Pressable>
          {canUpdateShed ? (
            <Pressable
              onPress={() => setShowManage((v) => !v)}
              style={styles.manageBtn}
              accessibilityRole="button"
              accessibilityState={{ expanded: showManage }}
              accessibilityLabel={showManage ? "Close shed management" : "Manage shed"}
            >
              <Ionicons name="settings-outline" size={16} color={birdUi.primary} />
              <Text style={styles.manageBtnText}>{showManage ? "Close" : "Manage"}</Text>
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
        <View style={styles.heroIdentity}>
          <Text style={styles.shedName}>{shed?.name}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.pill, shed?.is_active ? styles.pillOn : styles.pillOff]}>
              <View
                style={[
                  styles.pillDot,
                  { backgroundColor: shed?.is_active ? birdUi.successText : birdUi.error },
                ]}
              />
              <Text
                style={[
                  styles.pillText,
                  { color: shed?.is_active ? birdUi.successText : birdUi.error },
                ]}
              >
                {shed?.is_active ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>
          <Text style={styles.managed}>
            {managedLabel}
            {farmerNames ? ` · ${farmerNames}` : " · No farmer assigned"}
          </Text>
        </View>
      </ImmersiveHeroHeader>

      {showManage && shed && id ? (
        <ShedManagePanel
          shedId={id}
          shed={shed}
          assignments={assignments}
          onChanged={() => {
            void overview.refetch();
            void birds.refetch();
            void birdsSummary.refetch();
          }}
        />
      ) : null}

      {!shed?.is_active ? (
        <Text style={styles.warnBanner}>
          Inactive — history stays available. Reactivate before adding birds.
        </Text>
      ) : null}

      <View style={styles.metricsCard}>
        <Metric
          icon="egg-outline"
          iconBg={birdUi.iconCircle}
          iconColor={birdUi.primary}
          value={liveCount}
          label="Live"
          tone={birdUi.primary}
        />
        <View style={styles.metricDivider} />
        <Metric
          icon="pricetag-outline"
          iconBg={birdUi.orangePale}
          iconColor={birdUi.orange}
          value={bandedCount}
          label="Banded"
          tone={birdUi.orange}
        />
        <View style={styles.metricDivider} />
        <Metric
          icon="people-outline"
          iconBg={birdUi.bluePale}
          iconColor={birdUi.blue}
          value={unbandedCount}
          label="Unbanded"
          tone={birdUi.blue}
        />
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === "banded" && styles.tabOn]}
          onPress={() => setTab("banded")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "banded" }}
        >
          <Ionicons
            name="pricetag"
            size={16}
            color={tab === "banded" ? "#fff" : birdUi.orange}
          />
          <Text style={[styles.tabText, tab === "banded" && styles.tabTextOn]}>
            Banded ({bandedCount})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "unbanded" && styles.tabOnBlue]}
          onPress={() => setTab("unbanded")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "unbanded" }}
        >
          <Ionicons
            name="people"
            size={16}
            color={tab === "unbanded" ? "#fff" : birdUi.blue}
          />
          <Text style={[styles.tabText, tab === "unbanded" && styles.tabTextOn]}>
            Unbanded ({unbandedCount})
          </Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={birdUi.muted} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={onSearchChange}
            placeholder={tab === "banded" ? "Search by Band" : "Search hatch or breed…"}
            placeholderTextColor={birdUi.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Search by Band"
          />
          {q ? (
            <Pressable onPress={clearSearch} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={birdUi.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {showSelectAll || showBulkBar ? (
        <View style={styles.bulkBar}>
          <View style={styles.bulkTopRow}>
            <View style={styles.bulkLeft}>
              <Ionicons name="checkbox" size={20} color={birdUi.primary} />
              <Text style={styles.bulkCount}>
                {tab === "banded"
                  ? formatSelectedBirdsLabel(selected.size)
                  : selected.size === 1
                    ? "1 selected"
                    : `${selected.size} selected`}
              </Text>
            </View>
            {showSelectAll ? (
              <Pressable
                onPress={onSelectAllPress}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={allLoadedSelected ? "Deselect all" : "Select all"}
              >
                <Text style={styles.selectAllLink}>
                  {allLoadedSelected ? "Deselect all" : "Select all"}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {showBulkBar ? (
            <View style={styles.bulkActions}>
              {canRecordVaccination && tab === "banded" ? (
                <Pressable
                  style={styles.vaxBtn}
                  onPress={openRecordVaccination}
                  accessibilityRole="button"
                  accessibilityLabel="Record vaccination"
                >
                  <Ionicons name="medkit-outline" size={16} color="#fff" />
                  <Text style={styles.vaxBtnText}>Record vaccination</Text>
                </Pressable>
              ) : null}
              {canLifecycle ? (
                <>
                  <Pressable
                    style={[styles.mortalityBtn, bulkDisabledUnbanded && styles.btnDisabled]}
                    onPress={openMortality}
                    disabled={bulkDisabledUnbanded}
                    accessibilityRole="button"
                    accessibilityLabel="Mortality"
                  >
                    <Ionicons name="skull-outline" size={16} color="#fff" />
                    <Text style={styles.mortalityBtnText}>Mortality</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.transferBtn, bulkDisabledUnbanded && styles.btnDisabled]}
                    onPress={openTransfer}
                    disabled={bulkDisabledUnbanded}
                    accessibilityRole="button"
                    accessibilityLabel="Transfer"
                  >
                    <Ionicons name="swap-horizontal" size={16} color="#fff" />
                    <Text style={styles.transferBtnText}>Transfer</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.soldBtn, bulkDisabledUnbanded && styles.btnDisabled]}
                    onPress={openSale}
                    disabled={bulkDisabledUnbanded}
                    accessibilityRole="button"
                    accessibilityLabel="Sold"
                  >
                    <Ionicons name="pricetag-outline" size={16} color="#fff" />
                    <Text style={styles.soldBtnText}>Sold</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}
          {unbandedMultiHint ? <Text style={styles.bulkHint}>{unbandedMultiHint}</Text> : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <Screen edges={["left", "right", "bottom"]} style={{ backgroundColor: birdUi.bg, padding: 0 }}>
      {tab === "banded" ? (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          onRefresh={() => {
            void overview.refetch();
            void birds.refetch();
            void birdsSummary.refetch();
          }}
          refreshing={
            (birds.isRefetching && !birds.isFetchingNextPage) || overview.isRefetching
          }
          ListEmptyComponent={
            birds.isLoading ? (
              <HenLoader label="Loading birds…" />
            ) : birds.isError ? (
              <View style={styles.emptyBox}>
                <Text style={styles.error}>{describeApiError(birds.error, "load birds")}</Text>
                <Button label="Retry" onPress={() => birds.refetch()} />
              </View>
            ) : emptyPopulation ? (
              <EmptyBirds />
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No matching birds</Text>
                <Text style={styles.emptyBody}>Try a different search.</Text>
                {debouncedQ ? (
                  <Button label="Clear search" variant="secondary" onPress={clearSearch} />
                ) : null}
              </View>
            )
          }
          renderItem={({ item }) => (
            <BandedBirdRow
              bird={item}
              shedId={id!}
              selected={selected.has(item.id)}
              canSelect={canSelectBanded}
              onToggle={() => setSelected((prev) => toggleSelection(prev, item.id))}
            />
          )}
          ListFooterComponent={
            birds.hasNextPage ? (
              <Button
                label="Load more"
                variant="secondary"
                loading={birds.isFetchingNextPage}
                onPress={() => birds.fetchNextPage()}
              />
            ) : (
              <View style={{ height: 100 }} />
            )
          }
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={unbandedRows}
          keyExtractor={(item) => item.flock_id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          onRefresh={() => {
            void overview.refetch();
            void birdsSummary.refetch();
          }}
          refreshing={overview.isRefetching || birdsSummary.isRefetching}
          ListEmptyComponent={
            emptyPopulation ? (
              <EmptyBirds />
            ) : (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyTitle}>No unbanded birds</Text>
                <Text style={styles.emptyBody}>
                  {debouncedQ
                    ? "No populations match this search."
                    : "Record an unbanded population with Add birds."}
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <UnbandedCohortRow
              row={item}
              selected={selected.has(item.flock_id)}
              canSelect={canLifecycle && !!shed?.is_active}
              canBand={canCreate && !!shed?.is_active}
              onToggle={() => setSelected((prev) => toggleSelection(prev, item.flock_id))}
              onBand={() =>
                router.push({
                  pathname: "/(app)/birds/band-from-unbanded",
                  params: { shedId: id!, flockId: item.flock_id },
                })
              }
            />
          )}
          ListFooterComponent={<View style={{ height: 100 }} />}
        />
      )}

      {(canCreate || canCreateGroup) && shed?.is_active ? (
        <View style={[styles.fabWrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Pressable
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.92 }]}
            onPress={() =>
              router.push({
                pathname: "/(app)/birds/add",
                params: {
                  shedId: id!,
                  mode: canCreate ? "banded" : "unbanded",
                },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Add bird"
          >
            <Ionicons name="add" size={22} color="#fff" />
            <Text style={styles.addBtnText}>Add bird</Text>
          </Pressable>
        </View>
      ) : null}

      <AppDialog
        visible={Boolean(selectAllNote)}
        title="Select all"
        description={selectAllNote ?? undefined}
        tone="info"
        dismissible
        onDismiss={() => setSelectAllNote(null)}
        primary={{
          label: "OK",
          variant: "primary",
          onPress: () => setSelectAllNote(null),
        }}
      />

      <MortalityActionSheet
        visible={!!mortalityPayload}
        payload={mortalityPayload}
        onClose={() => setMortalityPayload(null)}
        onSuccess={onActionSuccess}
      />
      <SaleActionSheet
        visible={!!salePayload}
        payload={salePayload}
        onClose={() => setSalePayload(null)}
        onSuccess={() => {
          onActionSuccess();
        }}
      />
      <TransferActionSheet
        visible={!!transferPayload}
        payload={transferPayload}
        resume={transferResume}
        onResumeConsumed={() => setTransferResume(null)}
        onClose={() => {
          // Keep draft when Add Shed paused the sheet (store already has this shed's draft).
          const pending = peekTransferDraft();
          if (!(pending && id && pending.payload.shedId === id)) {
            clearTransferDraft();
          }
          setTransferResume(null);
          setTransferPayload(null);
        }}
        onSuccess={onActionSuccess}
      />
    </Screen>
  );
}

function Metric({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  tone,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  iconBg: string;
  iconColor: string;
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <View style={styles.metric} accessibilityLabel={`${label} ${value}`}>
      <View style={[styles.metricIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={14} color={iconColor} />
      </View>
      <View style={styles.metricCopy}>
        <Text style={[styles.metricValue, { color: tone }]}>{value}</Text>
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
    </View>
  );
}

function genderIconSource(sex: string | null | undefined) {
  const normalized = normalizeSexSelectValue(sex);
  if (normalized === "male") return birdIcons.male;
  if (normalized === "female") return birdIcons.female;
  return birdIcons.bird;
}

function EmptyBirds() {
  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIcon}>
        <Image source={birdIcons.bird} style={styles.emptyIconImg} resizeMode="cover" />
      </View>
      <Text style={styles.emptyTitle}>No registered birds yet</Text>
      <Text style={styles.emptyBody}>
        Add banded birds or record an unbanded population for this shed.
      </Text>
    </View>
  );
}

function BandedBirdRow({
  bird,
  shedId,
  selected,
  canSelect,
  onToggle,
}: {
  bird: ShedBirdListItem;
  shedId: string;
  selected: boolean;
  canSelect: boolean;
  onToggle: () => void;
}) {
  const title = birdLabel(bird);
  const eligible = isLifecycleEligible(bird);
  const sexLabel = formatSexLabel(bird.sex);
  const open = () =>
    router.push({
      pathname: "/(app)/birds/[id]",
      params: { id: bird.id, fromShedId: shedId },
    });

  // Single press target for selection — checkbox is visual only so row + checkbox
  // cannot double-toggle. Profile opens via the chevron when selection is enabled.
  const onRowPress = () => {
    if (canSelect && eligible) {
      onToggle();
      return;
    }
    open();
  };

  return (
    <Pressable
      style={[styles.birdCard, selected && styles.birdCardSelected]}
      onPress={onRowPress}
      accessibilityRole={canSelect ? "checkbox" : "button"}
      accessibilityState={canSelect ? { checked: selected, disabled: !eligible } : undefined}
      accessibilityLabel={
        canSelect && eligible
          ? `${selected ? "Deselect" : "Select"} ${title}, ${sexLabel}`
          : `${title}, ${sexLabel}`
      }
    >
      {canSelect ? (
        <View
          style={[styles.checkbox, selected && styles.checkboxOn, !eligible && styles.checkboxDisabled]}
          importantForAccessibility="no"
        >
          {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
      ) : null}
      <View style={styles.birdAvatar}>
        <Image
          source={genderIconSource(bird.sex)}
          style={styles.birdAvatarImg}
          resizeMode="cover"
        />
      </View>
      <View style={styles.birdCopy}>
        <Text style={styles.band} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.birdMeta} numberOfLines={1}>
          {sexLabel}
        </Text>
      </View>
      <Pressable
        onPress={open}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Open profile for ${title}`}
      >
        <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
      </Pressable>
    </Pressable>
  );
}

function UnbandedCohortRow({
  row,
  selected,
  canSelect,
  canBand,
  onToggle,
  onBand,
}: {
  row: UnbandedRow;
  selected: boolean;
  canSelect: boolean;
  canBand: boolean;
  onToggle: () => void;
  onBand: () => void;
}) {
  const age = formatRelativeAgeLabel(row);
  return (
    <Pressable
      style={[styles.birdCard, selected && styles.birdCardSelected]}
      onPress={() => {
        if (canSelect) onToggle();
      }}
      accessibilityRole={canSelect ? "checkbox" : "button"}
      accessibilityState={canSelect ? { checked: selected } : undefined}
      accessibilityLabel={
        canSelect ? `${selected ? "Deselect" : "Select"} ${row.label}` : row.label
      }
    >
      {canSelect ? (
        <View
          style={[styles.checkbox, selected && styles.checkboxOn]}
          importantForAccessibility="no"
        >
          {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
      ) : null}
      <View style={[styles.birdAvatar, { backgroundColor: birdUi.bluePale }]}>
        <Ionicons name="people-outline" size={20} color={birdUi.blue} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.band}>{row.unbanded_count} unbanded</Text>
        <Text style={styles.birdMeta}>
          {[row.breed || "Breed —", age].join(" · ")}
        </Text>
        <Text style={styles.birdMeta}>{row.label}</Text>
        {canBand ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onBand();
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Band a bird from ${row.label}`}
          >
            <Text style={styles.link}>Band a bird</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: 24, gap: 10 },
  headerBlock: { gap: 12, marginBottom: 4 },
  heroCopy: {
    flexGrow: 1,
    gap: 12,
    justifyContent: "space-between",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroIdentity: { gap: 6 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  manageBtnText: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.primary },
  shedName: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.deepGreen,
    letterSpacing: -0.4,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  shedMeta: { fontSize: typography.secondary.fontSize, fontWeight: "600", color: birdUi.textSecondary },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillOn: { backgroundColor: birdUi.successBg },
  pillOff: { backgroundColor: birdUi.errorPale },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: typography.caption.fontSize, fontWeight: "700" },
  managed: { fontSize: typography.caption.fontSize, color: birdUi.muted, marginTop: 2 },
  warnBanner: {
    marginHorizontal: birdUi.horizontal,
    backgroundColor: birdUi.orangePale,
    color: birdUi.orange,
    fontWeight: "600",
    fontSize: typography.secondary.fontSize,
    padding: 10,
    borderRadius: 12,
    overflow: "hidden",
  },
  metricsCard: {
    marginHorizontal: birdUi.horizontal,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: birdUi.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  metric: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  metricCopy: { gap: 0 },
  metricValue: { fontSize: typography.bodyStrong.fontSize, fontWeight: "800", lineHeight: 18 },
  metricLabel: { fontSize: typography.overline.fontSize, fontWeight: "600", color: birdUi.muted, lineHeight: 13 },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: birdUi.divider,
    marginVertical: 2,
  },
  tabs: {
    marginHorizontal: birdUi.horizontal,
    flexDirection: "row",
    gap: 8,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 11,
  },
  tabOn: { backgroundColor: birdUi.primary },
  tabOnBlue: { backgroundColor: birdUi.blue },
  tabText: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.text },
  tabTextOn: { color: "#fff" },
  searchRow: {
    marginHorizontal: birdUi.horizontal,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: birdUi.white,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: typography.body.fontSize, color: birdUi.text, paddingVertical: 8 },
  bulkBar: {
    marginHorizontal: birdUi.horizontal,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 12,
    gap: 10,
  },
  bulkTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  bulkLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  bulkCount: { fontWeight: "800", color: birdUi.text, fontSize: typography.body.fontSize },
  selectAllLink: {
    fontWeight: "800",
    color: birdUi.primary,
    fontSize: typography.label.fontSize,
    textDecorationLine: "underline",
  },
  bulkActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  bulkHint: { fontSize: typography.caption.fontSize, color: birdUi.orange, fontWeight: "600" },
  vaxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: birdUi.primary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  vaxBtnText: { color: "#fff", fontWeight: "700", fontSize: typography.secondary.fontSize },
  mortalityBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: birdUi.error,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  mortalityBtnText: { color: "#fff", fontWeight: "700", fontSize: typography.secondary.fontSize },
  transferBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: birdUi.blue,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  transferBtnText: { color: "#fff", fontWeight: "700", fontSize: typography.secondary.fontSize },
  soldBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: birdUi.orange,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  soldBtnText: { color: "#fff", fontWeight: "700", fontSize: typography.secondary.fontSize },
  btnDisabled: { opacity: 0.45 },
  birdCard: {
    marginHorizontal: birdUi.horizontal,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minHeight: 48,
  },
  birdCardSelected: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  birdAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  birdAvatarImg: { width: "100%", height: "100%" },
  birdCopy: { flex: 1, minWidth: 0, gap: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: birdUi.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  checkboxDisabled: { opacity: 0.35 },
  band: { fontSize: typography.body.fontSize, fontWeight: "800", color: birdUi.text },
  birdMeta: { fontSize: typography.caption.fontSize, color: birdUi.muted },
  link: { color: birdUi.primary, fontWeight: "700", fontSize: typography.secondary.fontSize, marginTop: 4 },
  fabWrap: {
    position: "absolute",
    left: birdUi.horizontal,
    right: birdUi.horizontal,
    bottom: 4,
  },
  addBtn: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: birdUi.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addBtnText: { color: "#fff", fontSize: typography.button.fontSize, fontWeight: "700" },
  emptyBox: { alignItems: "center", paddingVertical: 32, gap: 10, paddingHorizontal: 24 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  emptyIconImg: { width: "100%", height: "100%" },
  emptyTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.text, textAlign: "center" },
  emptyBody: { fontSize: typography.label.fontSize, color: birdUi.muted, textAlign: "center", lineHeight: 20 },
  error: { color: birdUi.error, fontWeight: "600" },
});
