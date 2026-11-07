import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { FollowUpState, SicknessSeverity } from "../../api/sickness";
import { birdUi } from "../../theme/birdManagementUi";
import { typography } from "../../theme/tokens";
import { AppDatePicker } from "../ui/AppDatePicker";
import { Button } from "../ui/Button";
import { FormBottomSheet } from "../ui/FormBottomSheet";
import {
  DEFAULT_SICKNESS_FILTERS,
  filtersAreActive,
  type SicknessFilterState,
} from "../../features/sickness/sicknessFilters";

const STATUS_CHIPS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "recovered", label: "Recovered" },
] as const;

const SEVERITY_CHIPS = [
  { value: "", label: "All" },
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe" },
] as const;

const FOLLOW_UP_CHIPS: { value: FollowUpState | ""; label: string }[] = [
  { value: "", label: "Any" },
  { value: "overdue", label: "Overdue" },
  { value: "due", label: "Due soon" },
  { value: "upcoming", label: "Upcoming" },
  { value: "none", label: "No follow-up" },
];

type Props = {
  visible: boolean;
  applied: SicknessFilterState;
  onClose: () => void;
  onApply: (next: SicknessFilterState) => void;
};

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => {
          const on = value === option.value;
          return (
            <Pressable
              key={option.value || "all"}
              onPress={() => onChange(option.value)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SicknessFilterSheet({ visible, applied, onClose, onApply }: Props) {
  const [draft, setDraft] = useState<SicknessFilterState>(applied);

  return (
    <FormBottomSheet
      visible={visible}
      onClose={onClose}
      maxHeightFraction={0.94}
      header={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Filter sick birds</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close filters">
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Active status and follow-ups are reminders, not recovery.</Text>
        </View>
      }
      footer={
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button
              label="Reset"
              variant="secondary"
              onPress={() => setDraft({ ...DEFAULT_SICKNESS_FILTERS })}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={filtersAreActive(draft) ? "Apply filters" : "Apply"}
              onPress={() => {
                onApply(draft);
                onClose();
              }}
            />
          </View>
        </View>
      }
    >
      <View style={styles.body}>
        <ChipRow
          label="Episode status"
          options={STATUS_CHIPS}
          value={draft.status}
          onChange={(value) =>
            setDraft((d) => ({ ...d, status: value as SicknessFilterState["status"] }))
          }
        />
        <ChipRow
          label="Severity"
          options={SEVERITY_CHIPS}
          value={draft.severity}
          onChange={(value) =>
            setDraft((d) => ({ ...d, severity: value as SicknessSeverity | "" }))
          }
        />
        <ChipRow
          label="Follow-up"
          options={FOLLOW_UP_CHIPS}
          value={draft.followUpState}
          onChange={(value) =>
            setDraft((d) => ({ ...d, followUpState: value as FollowUpState | "" }))
          }
        />

        <View style={styles.group}>
          <Text style={styles.label}>Sick date range</Text>
          <AppDatePicker
            label="From"
            value={draft.sickFrom}
            onChange={(value) => setDraft((d) => ({ ...d, sickFrom: value }))}
            maximumDate={draft.sickTo}
            clearable
          />
          <AppDatePicker
            label="To"
            value={draft.sickTo}
            onChange={(value) => setDraft((d) => ({ ...d, sickTo: value }))}
            minimumDate={draft.sickFrom}
            clearable
          />
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>Follow-up date range</Text>
          <AppDatePicker
            label="From"
            value={draft.followUpFrom}
            onChange={(value) => setDraft((d) => ({ ...d, followUpFrom: value }))}
            maximumDate={draft.followUpTo}
            clearable
          />
          <AppDatePicker
            label="To"
            value={draft.followUpTo}
            onChange={(value) => setDraft((d) => ({ ...d, followUpTo: value }))}
            minimumDate={draft.followUpFrom}
            clearable
          />
        </View>
      </View>
    </FormBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 4, gap: 4 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.text },
  subtitle: { fontSize: typography.caption.fontSize, color: birdUi.muted, lineHeight: 17 },
  body: { paddingHorizontal: 20, gap: 16, paddingBottom: 8 },
  group: { gap: 8 },
  label: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
  },
  chipOn: { backgroundColor: birdUi.paleMint, borderColor: birdUi.primary },
  chipText: { fontSize: typography.label.fontSize, fontWeight: "600", color: birdUi.textSecondary },
  chipTextOn: { color: birdUi.primary, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 4 },
});
