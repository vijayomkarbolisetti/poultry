import Ionicons from "@expo/vector-icons/Ionicons";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

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
import { Button } from "../../../../src/components/ui/Button";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { Screen } from "../../../../src/components/ui/Screen";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import {
  formatLifecycleLabel,
  formatUnbandedCohortLabel,
} from "../../../../src/features/birds/birdListHelpers";
import {
  birdLabel,
  eligibleIdsFromLoaded,
  isLifecycleEligible,
  reconcileSelectionToLoaded,
  selectAllLoaded,
  toggleSelection,
} from "../../../../src/features/birds/birdSelectionHelpers";
import { firstRouteParam } from "../../../../src/navigation/routeParams";
import { safeBack } from "../../../../src/navigation/safeBack";
import { birdUi } from "../../../../src/theme/birdManagementUi";

const PAGE = 20;

export default function ShedBirdsScreen() {
  const params = useLocalSearchParams<{ id: string | string[]; focus?: string | string[] }>();
  const id = firstRouteParam(params.id);
  const focus = firstRouteParam(params.focus);
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const canCreate = hasPermission(user, ownerAccountId, "bird.create");
  const canCreateGroup = hasPermission(user, ownerAccountId, "flock.create");
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");

  const [addOpen, setAddOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<BirdsFilterState>(DEFAULT_BIRDS_FILTERS);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterKey = useRef("");

  useEffect(() => {
    if (focus === "add" && canCreate) setAddOpen(true);
  }, [focus, canCreate]);

  const overview = useQuery({
    queryKey: ["shed-overview", id],
    queryFn: () => getShedOverview(id!),
    enabled: !!id && canView,
  });

  const lifecycleStatus =
    filters.status && filters.status !== "" ? filters.status : null;
  const includeInactive = !!lifecycleStatus;

  const birds = useInfiniteQuery({
    queryKey: ["shed-birds", id, debouncedQ, filters.flockId, filters.status],
    enabled: canView && !!id,
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

  const items = birds.data?.pages.flatMap((p) => p.items) ?? [];
  const total = birds.data?.pages[0]?.total ?? 0;
  const unbandedTotal = birds.data?.pages[0]?.unbanded_total ?? 0;
  const unbandedBatches = birds.data?.pages[0]?.unbanded_batches ?? [];
  const loadedEligibleIds = useMemo(() => eligibleIdsFromLoaded(items), [items]);

  useEffect(() => {
    const key = `${debouncedQ}|${filters.flockId}|${filters.status}`;
    if (filterKey.current === key) return;
    filterKey.current = key;
    setSelected(new Set());
  }, [debouncedQ, filters.flockId, filters.status]);

  useEffect(() => {
    if (!selectMode) return;
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const { next } = reconcileSelectionToLoaded(prev, loadedEligibleIds);
      return next;
    });
  }, [loadedEligibleIds, selectMode]);

  const onSearchChange = (text: string) => {
    setQ(text);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(text.trim()), 350);
  };

  const clearSearch = () => {
    setQ("");
    setDebouncedQ("");
  };

  const shed = overview.data?.shed;
  const population = overview.data?.population;
  const batches = overview.data?.batches ?? [];
  const overviewByFlockId = useMemo(() => {
    const map = new Map<string, (typeof batches)[number]>();
    for (const b of batches) map.set(b.id, b);
    return map;
  }, [batches]);
  const bandedCount = population?.banded_birds ?? 0;
  const unbandedCount = population?.unbanded_birds ?? unbandedTotal;
  const emptyPopulation = bandedCount === 0 && unbandedCount === 0 && !debouncedQ && !filtersAreActive(filters);
  const filtersActive = filtersAreActive(filters);

  const openBulk = (eventType: "mortality" | "transfer") => {
    if (selected.size === 0) return;
    const ids = [...selected];
    const labels = items.filter((b) => selected.has(b.id)).map(birdLabel);
    if (eventType === "transfer") {
      router.push({
        pathname: "/(app)/birds/transfer",
        params: { shedId: id!, birdIds: ids.join(",") },
      });
      return;
    }
    router.push({
      pathname: "/(app)/lifecycle-bulk",
      params: {
        shedId: id!,
        eventType,
        birdIds: ids.join(","),
        labels: labels.join("|"),
      },
    });
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["shed-birds", id] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", id] });
    void qc.invalidateQueries({ queryKey: ["flocks", id] });
  };

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(id ? `/(app)/sheds/${id}` : undefined)} />
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

  const listHeader = (
    <View style={styles.headerBlock}>
      <View style={styles.navRow}>
        <Pressable
          onPress={() => safeBack(`/(app)/sheds/${id}`)}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <Text style={styles.screenTitle}>Birds</Text>
        {canLifecycle && shed?.is_active && bandedCount > 0 ? (
          <Pressable
            onPress={() => (selectMode ? (setSelectMode(false), setSelected(new Set())) : setSelectMode(true))}
            style={styles.selectLink}
            hitSlop={8}
          >
            <Text style={styles.selectLinkText}>{selectMode ? "Done" : "Select"}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 48 }} />
        )}
      </View>

      <View style={styles.identityCard}>
        <Text style={styles.shedName}>{shed?.name}</Text>
        <Text style={styles.shedMeta}>
          {[shed?.code, overview.data.organization_name].filter(Boolean).join(" · ")}
        </Text>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <View style={[styles.metricIcon, { backgroundColor: birdUi.orangePale }]}>
            <Ionicons name="pricetag-outline" size={18} color={birdUi.orange} />
          </View>
          <Text style={styles.metricValue}>{bandedCount}</Text>
          <Text style={styles.metricLabel}>Banded birds</Text>
        </View>
        <View style={styles.metricCard}>
          <View style={[styles.metricIcon, { backgroundColor: birdUi.bluePale }]}>
            <Ionicons name="people-outline" size={18} color={birdUi.blue} />
          </View>
          <Text style={styles.metricValue}>{unbandedCount}</Text>
          <Text style={styles.metricLabel}>Unbanded birds</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={birdUi.muted} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={onSearchChange}
            placeholder="Search by band number"
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Search by band number"
          />
          {q ? (
            <Pressable onPress={clearSearch} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={birdUi.muted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          style={[styles.filterBtn, filtersActive && styles.filterBtnOn]}
          onPress={() => setFilterOpen(true)}
          accessibilityLabel="Open filters"
        >
          <Ionicons name="options-outline" size={22} color={filtersActive ? birdUi.primary : birdUi.text} />
          {filtersActive ? <View style={styles.filterDot} /> : null}
        </Pressable>
      </View>

      {selectMode ? (
        <View style={styles.selectBar}>
          <Text style={styles.selectTitle}>{selected.size} selected</Text>
          <View style={styles.selectActions}>
            <Button
              label="All loaded"
              variant="secondary"
              onPress={() => setSelected(selectAllLoaded(selected, loadedEligibleIds))}
            />
            <Button label="Clear" variant="ghost" onPress={() => setSelected(new Set())} />
          </View>
          {selected.size > 0 ? (
            <View style={styles.bulkRow}>
              <View style={{ flex: 1 }}>
                <Button label="Bulk mortality" variant="secondary" onPress={() => openBulk("mortality")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Bulk transfer" onPress={() => openBulk("transfer")} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {unbandedCount > 0 && !selectMode ? (
        <View style={styles.unbandedCard}>
          <Text style={styles.unbandedTitle}>Unbanded · {unbandedCount}</Text>
          <Text style={styles.unbandedHint}>
            Count-only birds have no profiles. Banding creates a new individual from the same hatch
            date.
          </Text>
          {unbandedBatches.map((b) => {
            const ov = overviewByFlockId.get(b.flock_id);
            const label = formatUnbandedCohortLabel({
              hatch_date: ov?.hatch_date ?? null,
              estimated_age_days: ov?.estimated_age_days ?? null,
              unbanded_count: b.unbanded_count,
            });
            return (
              <View key={b.flock_id} style={styles.unbandedRow}>
                <Text style={styles.unbandedBatch}>{label}</Text>
                <View style={styles.unbandedActions}>
                  {canCreate && shed?.is_active ? (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/birds/band-from-unbanded",
                          params: { shedId: id!, flockId: b.flock_id },
                        })
                      }
                      accessibilityLabel={`Band a bird from ${label}`}
                    >
                      <Text style={styles.link}>Band a bird</Text>
                    </Pressable>
                  ) : null}
                  {canLifecycle && shed?.is_active ? (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/(app)/lifecycle-batch",
                          params: { shedId: id!, flockId: b.flock_id },
                        })
                      }
                      accessibilityLabel={`Count actions for ${label}`}
                    >
                      <Text style={styles.link}>Count actions</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>Birds</Text>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{total}</Text>
        </View>
      </View>
    </View>
  );

  return (
    <Screen edges={["left", "right", "bottom"]} style={{ backgroundColor: birdUi.bg }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.listContent}
        onRefresh={() => {
          void overview.refetch();
          void birds.refetch();
        }}
        refreshing={birds.isRefetching && !birds.isFetchingNextPage}
        ListEmptyComponent={
          birds.isLoading ? (
            <HenLoader label="Loading birds…" />
          ) : birds.isError ? (
            <View style={styles.emptyBox}>
              <Text style={styles.error}>{describeApiError(birds.error, "load birds")}</Text>
              <Button label="Retry" onPress={() => birds.refetch()} />
            </View>
          ) : emptyPopulation ? (
            <View style={styles.emptyBox}>
              <View style={styles.emptyIcon}>
                <Ionicons name="egg-outline" size={40} color={birdUi.muted} />
              </View>
              <Text style={styles.emptyTitle}>No registered birds yet</Text>
              <Text style={styles.emptyBody}>
                Add banded birds or record an unbanded population for this shed.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No matching birds</Text>
              <Text style={styles.emptyBody}>Try a different band search or clear filters.</Text>
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
          <BirdRow
            bird={item}
            shedId={id!}
            selectMode={selectMode}
            selected={selected.has(item.id)}
            onToggle={() => setSelected(toggleSelection(selected, item.id))}
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
            <View style={{ height: 88 }} />
          )
        }
      />

      {canCreate && shed?.is_active && !selectMode ? (
        <View style={styles.fabWrap}>
          <Button label="+ Add birds" onPress={() => setAddOpen(true)} />
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
    </Screen>
  );
}

function BirdRow({
  bird,
  shedId,
  selectMode,
  selected,
  onToggle,
}: {
  bird: ShedBirdListItem;
  shedId: string;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const title = birdLabel(bird);
  const eligible = isLifecycleEligible(bird);
  const open = () =>
    router.push({
      pathname: "/(app)/birds/[id]",
      params: { id: bird.id, fromShedId: shedId },
    });

  return (
    <Pressable
      style={[styles.birdCard, selected && styles.birdCardSelected]}
      onPress={() => {
        if (selectMode) {
          if (eligible) onToggle();
          return;
        }
        open();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${bird.hatch_date ?? "no hatch date"}, ${formatLifecycleLabel(bird.lifecycle_status)}`}
    >
      {selectMode ? (
        <View style={[styles.checkbox, selected && styles.checkboxOn]}>
          {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
      ) : (
        <View style={styles.birdIcon}>
          <Ionicons name="egg-outline" size={20} color={birdUi.primary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.band}>{title}</Text>
        <Text style={styles.birdMeta}>
          {bird.hatch_date ? `Hatched ${bird.hatch_date}` : bird.breed || "Banded bird"}
        </Text>
      </View>
      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>{formatLifecycleLabel(bird.lifecycle_status)}</Text>
      </View>
      {!selectMode ? <Ionicons name="chevron-forward" size={18} color={birdUi.muted} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: birdUi.horizontal, paddingBottom: 24, gap: 10 },
  headerBlock: { gap: 12, marginBottom: 4 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: { flex: 1, fontSize: 22, fontWeight: "800", color: birdUi.text },
  selectLink: { paddingVertical: 8, paddingHorizontal: 4 },
  selectLinkText: { color: birdUi.primary, fontWeight: "700", fontSize: 15 },
  identityCard: {
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 2,
  },
  shedName: { fontSize: 16, fontWeight: "800", color: birdUi.text },
  shedMeta: { fontSize: 13, color: birdUi.muted },
  metricsRow: { flexDirection: "row", gap: 10 },
  metricCard: {
    flex: 1,
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 4,
  },
  metricIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  metricValue: { fontSize: 22, fontWeight: "800", color: birdUi.text },
  metricLabel: { fontSize: 12, fontWeight: "600", color: birdUi.muted },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
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
  selectBar: {
    backgroundColor: birdUi.paleMint,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  selectTitle: { fontWeight: "800", color: birdUi.text },
  selectActions: { flexDirection: "row", gap: 8 },
  bulkRow: { flexDirection: "row", gap: 8 },
  unbandedCard: {
    backgroundColor: birdUi.bluePale,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  unbandedTitle: { fontWeight: "800", color: birdUi.text },
  unbandedHint: { fontSize: 12, color: birdUi.muted, lineHeight: 17 },
  unbandedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  unbandedBatch: { fontSize: 13, fontWeight: "600", color: birdUi.text, flex: 1 },
  unbandedActions: { flexDirection: "row", gap: 12 },
  link: { color: birdUi.primary, fontWeight: "700", fontSize: 13 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  sectionLabel: { fontSize: 13, fontWeight: "800", color: birdUi.muted, letterSpacing: 0.4 },
  countPill: {
    backgroundColor: birdUi.paleMint,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countPillText: { fontSize: 12, fontWeight: "800", color: birdUi.primary },
  birdCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    minHeight: 64,
  },
  birdCardSelected: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  birdIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  band: { fontSize: 16, fontWeight: "800", color: birdUi.text },
  birdMeta: { fontSize: 13, color: birdUi.muted, marginTop: 2 },
  statusBadge: {
    backgroundColor: birdUi.successBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: { fontSize: 12, fontWeight: "700", color: birdUi.successText },
  fabWrap: {
    position: "absolute",
    left: birdUi.horizontal,
    right: birdUi.horizontal,
    bottom: 12,
  },
  emptyBox: { alignItems: "center", paddingVertical: 32, gap: 10, paddingHorizontal: 16 },
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
