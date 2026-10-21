import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { birdUi } from "../../theme/birdManagementUi";
import { Button } from "../ui/Button";

export type BirdsFilterState = {
  flockId: string | null;
  /** "" = active only (default), "active"|"sold"|"dead"|"transferred_out" */
  status: string;
};

export const DEFAULT_BIRDS_FILTERS: BirdsFilterState = {
  flockId: null,
  status: "",
};

const STATUS_CHIPS = [
  { value: "", label: "Active" },
  { value: "sold", label: "Sold" },
  { value: "dead", label: "Dead" },
  { value: "transferred_out", label: "Transferred" },
] as const;

type BatchOption = { value: string; label: string; hint?: string };

type Props = {
  visible: boolean;
  batches: BatchOption[];
  applied: BirdsFilterState;
  onClose: () => void;
  onApply: (next: BirdsFilterState) => void;
};

export function BirdsFilterSheet({ visible, batches: _batches, applied, onClose, onApply }: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<BirdsFilterState>(applied);

  useEffect(() => {
    if (visible) setDraft(applied);
  }, [visible, applied]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close filters">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>Filters</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>

          <Text style={styles.label}>Status</Text>
          <View style={styles.chips}>
            {STATUS_CHIPS.map((c) => {
              const on = draft.status === c.value;
              return (
                <Pressable
                  key={c.value || "active-default"}
                  onPress={() => setDraft((d) => ({ ...d, status: c.value }))}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <Button
                label="Reset"
                variant="secondary"
                onPress={() => setDraft({ ...DEFAULT_BIRDS_FILTERS })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Apply"
                onPress={() => {
                  onApply(draft);
                  onClose();
                }}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function filtersAreActive(f: BirdsFilterState): boolean {
  return !!f.flockId || f.status !== "";
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(15,40,32,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: birdUi.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: birdUi.border,
    marginBottom: 4,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "800", color: birdUi.text },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: birdUi.paleMint,
  },
  label: { fontSize: 13, fontWeight: "700", color: birdUi.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
  },
  chipOn: { backgroundColor: birdUi.paleMint, borderColor: birdUi.primary },
  chipText: { fontSize: 14, fontWeight: "600", color: birdUi.textSecondary },
  chipTextOn: { color: birdUi.primary },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
});
