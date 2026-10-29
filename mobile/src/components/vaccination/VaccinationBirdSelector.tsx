import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Bird } from "../../api/flocks";
import { formatRelativeAgeLabel } from "../../features/birds/birdListHelpers";
import {
  addBirdIds,
  filterBirdRows,
  toggleBirdSelection,
  type BirdSelectFilter,
  type SelectableBirdRow,
} from "../../features/vaccination/birdSelectionHelpers";
import { vaccineUi as ui } from "../../theme/vaccineUi";

type Props = {
  visible: boolean;
  birds: Bird[];
  /** Bird IDs already recorded against this scheduled dose (cannot be selected). */
  alreadyVaccinatedIds: ReadonlySet<string>;
  /** Max birds still open on this dose. */
  remaining: number;
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  onContinue: () => void;
  onClose: () => void;
  loading?: boolean;
};

function buildRows(
  birds: Bird[],
  alreadyVaccinatedIds: ReadonlySet<string>,
): SelectableBirdRow[] {
  return birds
    .filter((b) => b.is_active && b.band_id)
    .map((b) => {
      const vaccinated = alreadyVaccinatedIds.has(b.id);
      const age = formatRelativeAgeLabel({
        hatch_date: b.hatch_date,
        estimated_age_days: null,
      });
      const metaParts = [b.breed?.trim() || null, age !== "Age unknown" ? age : null].filter(
        Boolean,
      );
      return {
        id: b.id,
        band: b.band_id!.trim(),
        meta: metaParts.length ? metaParts.join(" · ") : "Banded bird",
        status: vaccinated ? ("vaccinated" as const) : ("eligible" as const),
      };
    })
    .sort((a, b) => a.band.localeCompare(b.band));
}

/**
 * Full-screen searchable bird picker for vaccination "Select birds" mode.
 * Selection persists across search/filter; ineligible (already vaccinated) rows are not selectable.
 */
export function VaccinationBirdSelector({
  visible,
  birds,
  alreadyVaccinatedIds,
  remaining,
  selectedIds,
  onChange,
  onContinue,
  onClose,
  loading,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BirdSelectFilter>("eligible");

  const rows = useMemo(
    () => buildRows(birds, alreadyVaccinatedIds),
    [birds, alreadyVaccinatedIds],
  );
  const eligibleRows = useMemo(() => rows.filter((r) => r.status === "eligible"), [rows]);
  const vaccinatedRows = useMemo(() => rows.filter((r) => r.status === "vaccinated"), [rows]);
  const eligibleIds = useMemo(() => eligibleRows.map((r) => r.id), [eligibleRows]);

  const filtered = useMemo(
    () => filterBirdRows(rows, { filter, query, selectedIds }),
    [rows, filter, query, selectedIds],
  );

  const selectedEligibleCount = useMemo(
    () => eligibleIds.filter((id) => selectedIds.has(id)).length,
    [eligibleIds, selectedIds],
  );
  const overRemaining = selectedEligibleCount > remaining;
  const canContinue = selectedEligibleCount > 0 && !overRemaining;

  const toggle = (id: string, selectable: boolean) => {
    if (!selectable) return;
    onChange(toggleBirdSelection(selectedIds, id));
  };

  const selectAllEligible = () => onChange(addBirdIds(selectedIds, eligibleIds));

  const selectVisibleEligible = () =>
    onChange(
      addBirdIds(
        selectedIds,
        filtered.filter((r) => r.status === "eligible").map((r) => r.id),
      ),
    );

  const clearSelection = () => onChange(new Set());

  const searching = query.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <Ionicons name="checkmark-circle" size={22} color={ui.brand} />
            </View>
            <View style={styles.titleCopy}>
              <Text style={styles.title}>Select birds for vaccination</Text>
              <Text style={styles.subtitle}>
                {eligibleRows.length} eligible bird{eligibleRows.length === 1 ? "" : "s"}
                {vaccinatedRows.length
                  ? ` · ${vaccinatedRows.length} already recorded`
                  : ""}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close bird selector"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={ui.ink} />
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={ui.muted} />
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search band number or bird name…"
              placeholderTextColor={ui.mutedSoft}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
              accessibilityLabel="Search birds"
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={18} color={ui.mutedSoft} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.chipRow}>
            {(
              [
                ["eligible", `All eligible (${eligibleRows.length})`],
                ["selected", `Selected (${selectedEligibleCount})`],
                ...(vaccinatedRows.length
                  ? ([["vaccinated", `Already vaccinated (${vaccinatedRows.length})`]] as const)
                  : []),
              ] as Array<[BirdSelectFilter, string]>
            ).map(([key, label]) => (
              <Pressable
                key={key}
                style={[styles.chip, filter === key && styles.chipOn]}
                onPress={() => setFilter(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === key }}
              >
                <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.bulkRow}>
          <Text style={styles.bulkHint} numberOfLines={1}>
            {filter === "eligible"
              ? "Select eligible birds for this dose"
              : filter === "selected"
                ? "Review your selection"
                : "Already recorded for this dose"}
          </Text>
          {filter === "eligible" ? (
            <View style={styles.bulkActions}>
              {searching ? (
                <Pressable onPress={selectVisibleEligible} accessibilityRole="button">
                  <Text style={styles.bulkLink}>Select visible</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={selectAllEligible} accessibilityRole="button">
                <Text style={styles.bulkLink}>Select all</Text>
              </Pressable>
            </View>
          ) : filter === "selected" && selectedEligibleCount > 0 ? (
            <Pressable onPress={clearSelection} accessibilityRole="button">
              <Text style={styles.bulkLink}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.empty}>
            <Text style={styles.emptyBody}>Loading birds…</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={Keyboard.dismiss}
            contentContainerStyle={
              filtered.length === 0 ? styles.emptyList : styles.listContent
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={28} color={ui.mutedSoft} />
                <Text style={styles.emptyTitle}>
                  {searching ? "No birds match your search" : "No birds in this filter"}
                </Text>
                <Text style={styles.emptyBody}>
                  {searching
                    ? "Try another band number or clear the search."
                    : filter === "selected"
                      ? "Select eligible birds to see them here."
                      : "There are no birds available for this view."}
                </Text>
              </View>
            }
            ListFooterComponent={
              filtered.length > 0 ? (
                <Text style={styles.footerHint}>
                  Showing {filtered.length} of{" "}
                  {filter === "eligible"
                    ? eligibleRows.length
                    : filter === "vaccinated"
                      ? vaccinatedRows.length
                      : selectedEligibleCount}{" "}
                  · Scroll for more
                </Text>
              ) : null
            }
            renderItem={({ item }) => {
              const selectable = item.status === "eligible";
              const on = selectedIds.has(item.id);
              return (
                <Pressable
                  style={[styles.row, on && selectable && styles.rowOn]}
                  onPress={() => toggle(item.id, selectable)}
                  disabled={!selectable}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: !selectable }}
                  accessibilityLabel={`${item.band}, ${item.meta}, ${item.status}`}
                >
                  <Ionicons
                    name={
                      !selectable
                        ? "remove-circle-outline"
                        : on
                          ? "checkbox"
                          : "square-outline"
                    }
                    size={22}
                    color={!selectable ? ui.mutedSoft : on ? ui.brand : ui.muted}
                  />
                  <View style={styles.avatar}>
                    <Ionicons name="egg-outline" size={16} color={ui.brand} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.band} numberOfLines={1}>
                      {item.band}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {item.meta}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      item.status === "vaccinated" ? styles.badgeMuted : styles.badgeOk,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        item.status === "vaccinated" ? styles.badgeTextMuted : styles.badgeTextOk,
                      ]}
                    >
                      {item.status === "vaccinated" ? "Recorded" : "Eligible"}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.footerCopy}>
            <Text style={styles.footerCount}>
              {selectedEligibleCount} of {eligibleRows.length} selected
            </Text>
            <Text style={styles.footerSub} numberOfLines={2}>
              {overRemaining
                ? `Only ${remaining} remaining on this dose — deselect ${selectedEligibleCount - remaining}.`
                : selectedEligibleCount === 0
                  ? "Choose the birds receiving this dose."
                  : `${remaining} remaining on this dose.`}
            </Text>
          </View>
          <View style={styles.footerActions}>
            {selectedEligibleCount > 0 ? (
              <Pressable onPress={clearSelection} accessibilityRole="button" style={styles.clearBtn}>
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[styles.continueBtn, !canContinue && styles.continueDisabled]}
              disabled={!canContinue}
              onPress={onContinue}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canContinue }}
              accessibilityLabel="Continue with selected birds"
            >
              <Text style={styles.continueText}>Continue</Text>
              <Ionicons name="arrow-forward" size={16} color={ui.white} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ui.bg },
  header: {
    paddingHorizontal: ui.horizontal,
    gap: 12,
    paddingBottom: 8,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  titleIcon: { paddingTop: 2 },
  titleCopy: { flex: 1, gap: 2 },
  title: { fontSize: 18, fontWeight: "800", color: ui.ink },
  subtitle: { fontSize: 13, fontWeight: "600", color: ui.muted },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ui.white,
    borderWidth: 1,
    borderColor: ui.cardBorder,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: ui.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  search: { flex: 1, fontSize: 15, fontWeight: "600", color: ui.ink, paddingVertical: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    backgroundColor: ui.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: ui.brand, borderColor: ui.brand },
  chipText: { fontSize: 12, fontWeight: "700", color: ui.ink },
  chipTextOn: { color: ui.white },
  bulkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: ui.horizontal,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ui.cardBorder,
  },
  bulkHint: { flex: 1, fontSize: 12, fontWeight: "600", color: ui.muted },
  bulkActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  bulkLink: { fontSize: 13, fontWeight: "800", color: ui.brand },
  listContent: { paddingHorizontal: ui.horizontal, paddingBottom: 12 },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingHorizontal: ui.horizontal },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ui.cardBorder,
    minHeight: 56,
  },
  rowOn: { backgroundColor: ui.brandSoft, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 12 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ui.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  band: { fontSize: 15, fontWeight: "800", color: ui.ink },
  meta: { fontSize: 12, fontWeight: "600", color: ui.muted },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  badgeOk: { backgroundColor: ui.brandSoft },
  badgeMuted: { backgroundColor: "#EEF1F0" },
  badgeText: { fontSize: 11, fontWeight: "800" },
  badgeTextOk: { color: ui.brand },
  badgeTextMuted: { color: ui.muted },
  footerHint: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: ui.mutedSoft,
    paddingVertical: 12,
  },
  empty: { alignItems: "center", gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: ui.ink, textAlign: "center" },
  emptyBody: { fontSize: 13, fontWeight: "600", color: ui.muted, textAlign: "center", lineHeight: 18 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: ui.cardBorder,
    backgroundColor: ui.white,
    paddingHorizontal: ui.horizontal,
    paddingTop: 12,
    gap: 10,
  },
  footerCopy: { gap: 2 },
  footerCount: { fontSize: 15, fontWeight: "800", color: ui.ink },
  footerSub: { fontSize: 12, fontWeight: "600", color: ui.muted, lineHeight: 16 },
  footerActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  clearText: { fontSize: 14, fontWeight: "700", color: ui.muted },
  continueBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: ui.brand,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  continueDisabled: { opacity: 0.45 },
  continueText: { color: ui.white, fontWeight: "800", fontSize: 15 },
});
