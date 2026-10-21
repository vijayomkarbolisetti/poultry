import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { listBirdsInShed, type ShedBirdListItem } from "../../api/birds";
import { describeApiError } from "../../api/client";
import {
  formatBirdAge,
  formatLifecycleLabel,
  formatVaccSummary,
  LIFECYCLE_FILTER_OPTIONS,
} from "../../features/birds/birdListHelpers";
import {
  birdLabel,
  eligibleIdsFromLoaded,
  isLifecycleEligible,
  reconcileSelectionToLoaded,
  selectAllLoaded,
  toggleSelection,
} from "../../features/birds/birdSelectionHelpers";
import { media } from "../../theme/media";
import { colors, radius, space } from "../../theme/tokens";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { HenLoader } from "../ui/HenLoader";
import { SelectField } from "../ui/SelectField";

const PAGE = 20;

export type ShedBirdBatchOption = {
  id: string;
  batch_code: string;
  tracking_mode?: string;
  current_count?: number;
  banded_count?: number;
  unbanded_count?: number;
  status?: string;
};

type Props = {
  shedId: string;
  shedActive: boolean;
  batches: ShedBirdBatchOption[];
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canLifecycle: boolean;
};

export function ShedBirdsSection({
  shedId,
  shedActive,
  batches,
  canView,
  canCreate,
  canUpdate,
  canLifecycle,
}: Props) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [flockId, setFlockId] = useState<string | null>(null);
  const [lifecycleFilter, setLifecycleFilter] = useState<string | null>("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionNote, setSelectionNote] = useState<string | null>(null);
  const [batchActionId, setBatchActionId] = useState<string | null>(null);

  const debounceTimer = useMemo(() => ({ id: null as ReturnType<typeof setTimeout> | null }), []);
  const filterKey = useRef(`${debouncedQ}|${flockId}|${lifecycleFilter}`);

  const onSearchChange = (text: string) => {
    setQ(text);
    if (debounceTimer.id) clearTimeout(debounceTimer.id);
    debounceTimer.id = setTimeout(() => setDebouncedQ(text.trim()), 350);
  };

  const lifecycleStatus =
    lifecycleFilter && lifecycleFilter !== "" && lifecycleFilter !== "all" ? lifecycleFilter : null;
  const includeInactive = lifecycleFilter === "all" || !!lifecycleStatus;

  const birds = useInfiniteQuery({
    queryKey: ["shed-birds", shedId, debouncedQ, flockId, lifecycleFilter],
    enabled: canView && !!shedId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listBirdsInShed({
        shedId,
        flockId,
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

  // Clear selection when search/filters change so stale IDs cannot be submitted.
  useEffect(() => {
    const key = `${debouncedQ}|${flockId}|${lifecycleFilter}`;
    if (filterKey.current === key) return;
    filterKey.current = key;
    setSelected((prev) => {
      if (prev.size > 0) setSelectionNote("Selection cleared because search or filters changed.");
      return new Set();
    });
  }, [debouncedQ, flockId, lifecycleFilter]);

  // Drop IDs that fell out of the loaded eligible set (e.g. after Load more + filter drift).
  useEffect(() => {
    if (!selectMode) return;
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const { next, removed } = reconcileSelectionToLoaded(prev, loadedEligibleIds);
      if (removed > 0) {
        setSelectionNote(
          `${removed} bird${removed === 1 ? "" : "s"} removed from selection (no longer eligible in this result set).`,
        );
        return next;
      }
      return prev;
    });
  }, [loadedEligibleIds, selectMode]);

  const batchOptions = useMemo(
    () => [
      { value: "", label: "All batches", hint: "Every batch in this shed" },
      ...batches.map((b) => ({ value: b.id, label: b.batch_code, hint: "Filter registered birds" })),
    ],
    [batches],
  );

  const batchActionOptions = useMemo(
    () => [
      { value: "", label: "Choose a batch…", hint: "Count-only unbanded actions" },
      ...batches
        .filter((b) => b.status !== "closed")
        .map((b) => ({
          value: b.id,
          label: b.batch_code,
          hint: `${b.tracking_mode ?? "—"} · live ${b.current_count ?? "—"} · unbanded ${b.unbanded_count ?? "—"}`,
        })),
    ],
    [batches],
  );

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
    setSelectionNote(null);
  };

  const openBulk = (eventType: "mortality" | "sale" | "transfer") => {
    if (selected.size === 0) return;
    const ids = [...selected];
    const labels = items.filter((b) => selected.has(b.id)).map(birdLabel);
    router.push({
      pathname: "/(app)/lifecycle-bulk",
      params: {
        shedId,
        eventType,
        birdIds: ids.join(","),
        labels: labels.join("|"),
      },
    });
  };

  if (!canView) {
    return (
      <View style={styles.block}>
        <Text style={styles.section}>Birds</Text>
        <Text style={styles.meta}>You do not have permission to view birds in this shed.</Text>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.headerRow}>
        <Text style={styles.section}>Birds</Text>
        <View style={styles.headerActions}>
          {canLifecycle && shedActive ? (
            <Button
              label={selectMode ? "Exit selection" : "Select"}
              variant="secondary"
              onPress={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            />
          ) : null}
          {canCreate && shedActive ? (
            <Button
              label="Tag bird"
              onPress={() =>
                router.push({
                  pathname: "/(app)/birds/add",
                  params: { shedId, flockId: flockId || undefined },
                })
              }
            />
          ) : null}
        </View>
      </View>

      <Text style={styles.meta}>
        Showing {items.length} of {total} registered bird{total === 1 ? "" : "s"}
        {debouncedQ ? ` matching “${debouncedQ}”` : ""}.
      </Text>

      {selectMode ? (
        <View style={styles.selectBanner}>
          <Text style={styles.selectTitle}>
            {selected.size} selected · {loadedEligibleIds.length} eligible in loaded results
          </Text>
          <Text style={styles.meta}>
            Select all applies only to eligible birds already loaded on screen — not unloaded pages.
          </Text>
          <View style={styles.headerActions}>
            <Button
              label="Select all loaded"
              variant="secondary"
              onPress={() => {
                setSelected(selectAllLoaded(selected, loadedEligibleIds));
                setSelectionNote(null);
              }}
            />
            <Button label="Clear" variant="ghost" onPress={() => setSelected(new Set())} />
          </View>
          {selectionNote ? <Text style={styles.warn}>{selectionNote}</Text> : null}
          {selected.size > 0 ? (
            <View style={styles.bulkBar}>
              <Button label="Record Mortality" variant="secondary" onPress={() => openBulk("mortality")} />
              <Button label="Record Sale" variant="secondary" onPress={() => openBulk("sale")} />
              <Button label="Record Transfer" variant="secondary" onPress={() => openBulk("transfer")} />
              <Button label="Cancel selection" variant="ghost" onPress={exitSelectMode} />
            </View>
          ) : null}
        </View>
      ) : null}

      {canLifecycle && shedActive ? (
        <View style={styles.batchBlock}>
          <Text style={styles.subsection}>Batch count actions</Text>
          <Text style={styles.meta}>
            Manage unbanded population counts without selecting individual birds. Banded birds keep their own
            history — use Select for those.
          </Text>
          <SelectField
            label="Batch for count action"
            value={batchActionId ?? ""}
            options={batchActionOptions}
            onChange={(v) => setBatchActionId(v || null)}
            clearable
          />
          {batchActionId ? (
            <Button
              label="Continue with batch count…"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: "/(app)/lifecycle-batch",
                  params: { shedId, flockId: batchActionId },
                })
              }
            />
          ) : null}
        </View>
      ) : null}

      {unbandedTotal > 0 ? (
        <View style={styles.unbandedCard}>
          <Text style={styles.unbandedTitle}>Unbanded birds: {unbandedTotal}</Text>
          <Text style={styles.meta}>
            Unbanded birds are batch population counts — not individual profiles. Start banding on the correct
            batch.
          </Text>
          {unbandedBatches.slice(0, 3).map((b) => (
            <View key={b.flock_id} style={styles.unbandedRow}>
              <Text style={styles.meta}>
                {b.batch_code}: {b.unbanded_count} unbanded
              </Text>
              {canCreate && shedActive ? (
                <Button
                  label="Band birds"
                  variant="secondary"
                  onPress={() => router.push(`/(app)/flocks/${b.flock_id}`)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        value={q}
        onChangeText={onSearchChange}
        placeholder="Search by band number"
        autoCapitalize="characters"
        autoCorrect={false}
        accessibilityLabel="Search birds by band number"
      />
      <SelectField
        label="Batch"
        value={flockId ?? ""}
        options={batchOptions}
        onChange={(v) => setFlockId(v || null)}
        clearable
      />
      <SelectField
        label="Lifecycle status"
        value={lifecycleFilter ?? ""}
        options={[...LIFECYCLE_FILTER_OPTIONS]}
        onChange={setLifecycleFilter}
      />

      {birds.isLoading ? <HenLoader label="Loading birds…" /> : null}
      {birds.isError ? (
        <View style={styles.card}>
          <Text style={styles.error}>{describeApiError(birds.error, "load birds")}</Text>
          <Button label="Retry" onPress={() => birds.refetch()} />
        </View>
      ) : null}

      {!birds.isLoading && !birds.isError && items.length === 0 ? (
        <EmptyState
          title={debouncedQ || flockId ? "No matching birds" : "No registered birds yet"}
          body={
            shedActive
              ? "Add a banded bird to a batch in this shed, or band unbanded birds from a batch."
              : "This shed is inactive. History remains available; new birds are blocked until reactivation."
          }
          imageUri={media.flockHen}
          actionLabel={canCreate && shedActive ? "Tag bird" : undefined}
          onAction={
            canCreate && shedActive
              ? () => router.push({ pathname: "/(app)/birds/add", params: { shedId } })
              : undefined
          }
        />
      ) : null}

      {items.map((bird) => (
        <BirdRow
          key={bird.id}
          bird={bird}
          shedId={shedId}
          canUpdate={canUpdate}
          canLifecycle={canLifecycle}
          selectMode={selectMode}
          selected={selected.has(bird.id)}
          onToggle={() => setSelected(toggleSelection(selected, bird.id))}
        />
      ))}

      {birds.hasNextPage ? (
        <Button
          label="Load more"
          variant="secondary"
          loading={birds.isFetchingNextPage}
          onPress={() => birds.fetchNextPage()}
        />
      ) : null}
    </View>
  );
}

function BirdRow({
  bird,
  shedId,
  canUpdate,
  canLifecycle,
  selectMode,
  selected,
  onToggle,
}: {
  bird: ShedBirdListItem;
  shedId: string;
  canUpdate: boolean;
  canLifecycle: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const title = birdLabel(bird);
  const eligible = isLifecycleEligible(bird);
  const openProfile = () =>
    router.push({
      pathname: "/(app)/birds/[id]",
      params: { id: bird.id, fromShedId: shedId },
    });

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }, selected && styles.cardSelected]}
      onPress={() => {
        if (selectMode) {
          if (eligible) onToggle();
          return;
        }
        openProfile();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        selectMode
          ? `${selected ? "Deselect" : "Select"} ${title}`
          : `Open profile for ${title}`
      }
    >
      <View style={styles.rowTop}>
        {selectMode ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              if (eligible) onToggle();
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled: !eligible }}
            hitSlop={8}
            style={styles.checkboxHit}
          >
            <View style={[styles.checkbox, selected && styles.checkboxOn, !eligible && styles.checkboxDisabled]}>
              {selected ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
          </Pressable>
        ) : null}
        <Text style={styles.band}>{title}</Text>
        <Text style={styles.badge}>{formatLifecycleLabel(bird.lifecycle_status)}</Text>
      </View>
      {selectMode && !eligible ? (
        <Text style={styles.warn}>Not eligible for lifecycle actions in this selection.</Text>
      ) : null}
      <Text style={styles.meta}>
        {[bird.breed ?? "Breed unknown", bird.sex ?? "Sex —", formatBirdAge(bird)].join(" · ")}
      </Text>
      <Text style={styles.meta}>Batch {bird.batch_code}</Text>
      <Text style={styles.meta}>{formatVaccSummary(bird.individual_vaccination_count)}</Text>
      {!selectMode ? (
        <View style={styles.rowActions}>
          <View style={{ flex: 1 }}>
            <Button label="Open profile" variant="secondary" onPress={openProfile} />
          </View>
          {canUpdate && bird.is_active ? (
            <View style={{ flex: 1 }}>
              <Button
                label="Edit"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: "/(app)/birds/edit/[id]",
                    params: { id: bird.id, fromShedId: shedId },
                  })
                }
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {!selectMode && canLifecycle && bird.is_active ? (
        <Text style={styles.hint}>Record mortality, sale, or transfer from the bird profile — or use Select.</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: space.sm, gap: space.sm, marginBottom: space.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  headerActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "center" },
  section: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkMuted,
    textTransform: "uppercase",
  },
  subsection: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkMuted,
    textTransform: "uppercase",
  },
  meta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  hint: { color: colors.inkMuted, fontSize: 12, marginTop: 4 },
  warn: { color: colors.accent, fontSize: 12, fontWeight: "600", marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    backgroundColor: colors.bgElevated,
    color: colors.ink,
    fontSize: 16,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  cardSelected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  band: { fontSize: 17, fontWeight: "800", color: colors.ink, flex: 1 },
  badge: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brand,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: "hidden",
    textTransform: "capitalize",
  },
  rowActions: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  unbandedCard: {
    backgroundColor: colors.info + "12",
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.info + "44",
    gap: space.sm,
  },
  unbandedTitle: { fontSize: 15, fontWeight: "800", color: colors.ink },
  unbandedRow: { gap: 6 },
  error: { color: colors.danger },
  selectBanner: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.brand + "55",
    gap: space.sm,
  },
  selectTitle: { fontWeight: "800", color: colors.ink, fontSize: 15 },
  bulkBar: { gap: space.sm },
  batchBlock: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  checkboxHit: { paddingRight: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkboxDisabled: { opacity: 0.35 },
  checkMark: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
