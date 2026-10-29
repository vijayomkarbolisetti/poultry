import Ionicons from "@expo/vector-icons/Ionicons";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  ImageBackground,
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
import { AddBirdsSheet } from "../../../../src/components/birds/AddBirdsSheet";
import {
  BirdsFilterSheet,
  DEFAULT_BIRDS_FILTERS,
  filtersAreActive,
  type BirdsFilterState,
} from "../../../../src/components/birds/BirdsFilterSheet";
import {
  MortalityActionSheet,
  unbandedMortalityPayload,
  type MortalityBandedPayload,
  type MortalityUnbandedPayload,
} from "../../../../src/components/birds/MortalityActionSheet";
import {
  TransferActionSheet,
  type TransferBandedPayload,
  type TransferUnbandedPayload,
} from "../../../../src/components/birds/TransferActionSheet";
import { Button } from "../../../../src/components/ui/Button";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { Screen } from "../../../../src/components/ui/Screen";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import {
  formatLifecycleLabel,
  formatRelativeAgeLabel,
  formatSexLabel,
  formatUnbandedCohortLabel,
} from "../../../../src/features/birds/birdListHelpers";
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
import { shedHeaderArt } from "../../../../src/theme/media";

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
  const params = useLocalSearchParams<{ id: string | string[]; focus?: string | string[] }>();
  const id = firstRouteParam(params.id);
  const focus = firstRouteParam(params.focus);
  const insets = useSafeAreaInsets();
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const canCreate = hasPermission(user, ownerAccountId, "bird.create");
  const canCreateGroup = hasPermission(user, ownerAccountId, "flock.create");
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");
  const canUpdateShed = hasPermission(user, ownerAccountId, "shed.update");

  const [tab, setTab] = useState<TabKey>("banded");
  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<BirdsFilterState>(DEFAULT_BIRDS_FILTERS);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [mortalityPayload, setMortalityPayload] = useState<
    MortalityBandedPayload | MortalityUnbandedPayload | null
  >(null);
  const [transferPayload, setTransferPayload] = useState<
    TransferBandedPayload | TransferUnbandedPayload | null
  >(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterKey = useRef("");

  useEffect(() => {
    if (focus === "add" && (canCreate || canCreateGroup)) setAddOpen(true);
  }, [focus, canCreate, canCreateGroup]);

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
  const organizationName = overview.data?.organization_name;
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

  // Never carry selection across sheds.
  useEffect(() => {
    setSelected(new Set());
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

  const emptyPopulation =
    bandedCount === 0 && unbandedCount === 0 && !debouncedQ && !filtersAreActive(filters);
  const filtersActive = filtersAreActive(filters);
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

  const onActionSuccess = () => {
    setSelected(new Set());
    invalidate();
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

  const batchFilterOptions = batches.map((b) => ({
    value: b.id,
    label: formatUnbandedCohortLabel({
      hatch_date: b.hatch_date,
      estimated_age_days: b.estimated_age_days,
      unbanded_count: b.unbanded_count,
    }),
    hint: `${b.banded_count} banded · ${b.unbanded_count} unbanded`,
  }));

  const showBulkBar = canLifecycle && !!shed?.is_active && selected.size > 0;
  const bulkDisabledUnbanded = tab === "unbanded" && !unbandedBulk.ok;
  const allLoadedSelected =
    tab === "banded" && areAllEligibleSelected(selected, loadedEligibleIds);
  const showSelectAll =
    canLifecycle && !!shed?.is_active && tab === "banded" && loadedEligibleIds.length > 0;

  const onSelectAllPress = () => {
    const selecting = !allLoadedSelected;
    setSelected((prev) => toggleSelectAllLoaded(prev, loadedEligibleIds));
    if (!selecting) return;
    const scopeNote = selectAllLoadedScopeMessage(birds.hasNextPage);
    if (scopeNote) {
      Alert.alert("Select all", scopeNote, [{ text: "OK" }]);
    }
  };

  const listHeader = (
    <View style={styles.headerBlock}>
      <ImageBackground
        source={shedHeaderArt}
        style={[styles.hero, { paddingTop: Math.max(insets.top, 8) }]}
        imageStyle={styles.heroImage}
        resizeMode="cover"
      >
        <View style={[styles.heroTop, { top: Math.max(insets.top, 8) }]}>
          <Pressable
            onPress={() => safeBack("/(app)/sheds")}
            style={styles.backBtn}
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={22} color={birdUi.text} />
          </Pressable>
          {canUpdateShed ? (
            <Pressable
              onPress={() => router.push(`/(app)/sheds/edit/${id}`)}
              style={styles.manageBtn}
              accessibilityLabel="Manage shed"
            >
              <Ionicons name="settings-outline" size={16} color={birdUi.primary} />
              <Text style={styles.manageBtnText}>Manage</Text>
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
        <Text style={styles.shedName}>{shed?.name}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.shedMeta}>
            {[shed?.code, organizationName].filter(Boolean).join(" · ")}
          </Text>
          <View style={[styles.pill, shed?.is_active ? styles.pillOn : styles.pillOff]}>
            <View style={[styles.pillDot, { backgroundColor: shed?.is_active ? birdUi.successText : birdUi.error }]} />
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
          {farmerNames ? ` by ${farmerNames}` : " · No farmer assigned"}
        </Text>
      </ImageBackground>

      <View style={styles.metricsCard}>
        <Metric
          icon="egg-outline"
          iconBg={birdUi.iconCircle}
          iconColor={birdUi.primary}
          value={liveCount}
          label="Live birds"
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
            placeholder={
              tab === "banded"
                ? "Search by band no., breed, batch…"
                : "Search hatch date or breed…"
            }
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Search birds"
          />
          {q ? (
            <Pressable onPress={clearSearch} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={birdUi.muted} />
            </Pressable>
          ) : null}
        </View>
        {tab === "banded" ? (
          <Pressable
            style={[styles.filterBtn, filtersActive && styles.filterBtnOn]}
            onPress={() => setFilterOpen(true)}
            accessibilityLabel="Open filters"
          >
            <Ionicons
              name="options-outline"
              size={22}
              color={filtersActive ? birdUi.primary : birdUi.text}
            />
            {filtersActive ? <View style={styles.filterDot} /> : null}
          </Pressable>
        ) : null}
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
              <Pressable
                style={[styles.mortalityBtn, bulkDisabledUnbanded && styles.btnDisabled]}
                onPress={openMortality}
                disabled={bulkDisabledUnbanded}
                accessibilityRole="button"
                accessibilityLabel="Record mortality"
              >
                <Ionicons name="skull-outline" size={16} color="#fff" />
                <Text style={styles.mortalityBtnText}>Record mortality</Text>
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
                <Text style={styles.emptyBody}>Try a different search or clear filters.</Text>
                {(debouncedQ || filtersActive) && (
                  <Button
                    label="Clear search & filters"
                    variant="secondary"
                    onPress={() => {
                      clearSearch();
                      setFilters({ ...DEFAULT_BIRDS_FILTERS });
                    }}
                  />
                )}
              </View>
            )
          }
          renderItem={({ item }) => (
            <BandedBirdRow
              bird={item}
              shedId={id!}
              selected={selected.has(item.id)}
              canSelect={canLifecycle && !!shed?.is_active}
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
            onPress={() => setAddOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add birds"
          >
            <Ionicons name="add" size={22} color="#fff" />
            <Text style={styles.addBtnText}>Add birds</Text>
          </Pressable>
        </View>
      ) : null}

      <AddBirdsSheet
        visible={addOpen}
        shedName={shed?.name ?? "shed"}
        shedActive={!!shed?.is_active}
        canCreateGroup={canCreateGroup}
        canTagBirds={canCreate}
        onClose={() => setAddOpen(false)}
        onAddUnbanded={() => {
          setAddOpen(false);
          router.push({ pathname: "/(app)/birds/add-unbanded", params: { shedId: id! } });
        }}
        onRegisterBanded={() => {
          setAddOpen(false);
          router.push({ pathname: "/(app)/birds/add", params: { shedId: id! } });
        }}
      />

      <BirdsFilterSheet
        visible={filterOpen}
        batches={batchFilterOptions}
        applied={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next);
          invalidate();
        }}
      />

      <MortalityActionSheet
        visible={!!mortalityPayload}
        payload={mortalityPayload}
        onClose={() => setMortalityPayload(null)}
        onSuccess={onActionSuccess}
      />
      <TransferActionSheet
        visible={!!transferPayload}
        payload={transferPayload}
        onClose={() => setTransferPayload(null)}
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
    <View style={styles.metric}>
      <View style={[styles.metricIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <Text style={[styles.metricValue, { color: tone }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function EmptyBirds() {
  return (
    <View style={styles.emptyBox}>
      <View style={styles.emptyIcon}>
        <Ionicons name="egg-outline" size={40} color={birdUi.muted} />
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
  const age = formatRelativeAgeLabel(bird);
  const line1 = [bird.breed || "Breed —", formatSexLabel(bird.sex)].join(" · ");
  const line2 = [`Batch ${bird.batch_code || "—"}`, age].join(" · ");
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
          ? `${selected ? "Deselect" : "Select"} ${title}`
          : `${title}, ${line1}, ${formatLifecycleLabel(bird.lifecycle_status)}`
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
        <Ionicons name="egg-outline" size={20} color={birdUi.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.band}>{title}</Text>
        <Text style={styles.birdMeta}>{line1}</Text>
        <Text style={styles.birdMeta}>{line2}</Text>
        {canSelect && !eligible ? (
          <Text style={styles.ineligibleHint}>Not eligible for lifecycle actions</Text>
        ) : null}
      </View>
      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>{formatLifecycleLabel(bird.lifecycle_status)}</Text>
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
  hero: {
    minHeight: 168,
    paddingHorizontal: birdUi.horizontal,
    paddingBottom: 16,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  heroImage: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  heroTop: {
    position: "absolute",
    left: birdUi.horizontal,
    right: birdUi.horizontal,
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
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  manageBtnText: { fontSize: 13, fontWeight: "700", color: birdUi.primary },
  shedName: {
    fontSize: 28,
    fontWeight: "800",
    color: birdUi.deepGreen,
    letterSpacing: -0.4,
    marginTop: 48,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  shedMeta: { fontSize: 14, fontWeight: "600", color: birdUi.textSecondary },
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
  pillText: { fontSize: 12, fontWeight: "700" },
  managed: { fontSize: 13, color: birdUi.muted, marginTop: 2 },
  metricsCard: {
    marginHorizontal: birdUi.horizontal,
    flexDirection: "row",
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingVertical: 12,
  },
  metric: { flex: 1, alignItems: "center", gap: 2 },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  metricValue: { fontSize: 20, fontWeight: "800" },
  metricLabel: { fontSize: 11, fontWeight: "600", color: birdUi.muted, textAlign: "center" },
  metricDivider: { width: StyleSheet.hairlineWidth, backgroundColor: birdUi.divider, marginVertical: 4 },
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
  tabText: { fontSize: 14, fontWeight: "700", color: birdUi.text },
  tabTextOn: { color: "#fff" },
  searchRow: {
    marginHorizontal: birdUi.horizontal,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: birdUi.white,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 15, color: birdUi.text, paddingVertical: 10 },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBtnOn: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  filterDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: birdUi.primary,
  },
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
  bulkCount: { fontWeight: "800", color: birdUi.text, fontSize: 15 },
  selectAllLink: {
    fontWeight: "800",
    color: birdUi.primary,
    fontSize: 14,
    textDecorationLine: "underline",
  },
  ineligibleHint: { color: birdUi.orange, fontSize: 12, fontWeight: "600", marginTop: 2 },
  bulkActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  bulkHint: { fontSize: 12, color: birdUi.orange, fontWeight: "600" },
  mortalityBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: birdUi.error,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  mortalityBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  transferBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: birdUi.blue,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  transferBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.45 },
  birdCard: {
    marginHorizontal: birdUi.horizontal,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 12,
    minHeight: 72,
  },
  birdCardSelected: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  birdAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: birdUi.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  checkboxDisabled: { opacity: 0.35 },
  band: { fontSize: 16, fontWeight: "800", color: birdUi.text },
  birdMeta: { fontSize: 12, color: birdUi.muted, marginTop: 1 },
  statusBadge: {
    backgroundColor: birdUi.successBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: { fontSize: 12, fontWeight: "700", color: birdUi.successText },
  link: { color: birdUi.primary, fontWeight: "700", fontSize: 13, marginTop: 4 },
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
  addBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  emptyBox: { alignItems: "center", paddingVertical: 32, gap: 10, paddingHorizontal: 24 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: birdUi.text, textAlign: "center" },
  emptyBody: { fontSize: 14, color: birdUi.muted, textAlign: "center", lineHeight: 20 },
  error: { color: birdUi.error, fontWeight: "600" },
});
