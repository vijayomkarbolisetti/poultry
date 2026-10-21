import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, space } from "../../theme/tokens";
import type { SelectOption } from "./SelectField";
import { filterSelectOptions } from "./selectUtils";

type Props = {
  label: string;
  placeholder?: string;
  values: string[];
  options: SelectOption[];
  onChange: (values: string[]) => void;
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  emptyMessage?: string;
};

/** Modal multi-select with optional search — used for shed assignments. */
export function MultiSelectField({
  label,
  placeholder = "Select…",
  values,
  options,
  onChange,
  helper,
  error,
  required,
  disabled,
  searchable = true,
  emptyMessage = "No options available yet",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedLabels = options.filter((o) => values.includes(o.value)).map((o) => o.label);
  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`;

  const filtered = useMemo(
    () => (searchable ? filterSelectOptions(options, query) : options),
    [options, query, searchable],
  );

  const toggle = (id: string) => {
    onChange(values.includes(id) ? values.filter((x) => x !== id) : [...values, id]);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${summary}`}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.field,
          error ? styles.fieldError : null,
          disabled ? styles.fieldDisabled : null,
          pressed && !disabled ? { opacity: 0.9 } : null,
        ]}
      >
        <Text style={[styles.value, selectedLabels.length === 0 && styles.placeholder]} numberOfLines={1}>
          {summary}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.inkMuted} />
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>{label}</Text>
            {searchable ? (
              <View style={styles.searchWrap}>
                <Ionicons name="search-outline" size={18} color={colors.inkMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search…"
                  placeholderTextColor={colors.inkMuted}
                  style={styles.search}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ) : null}
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <Text style={styles.empty}>{emptyMessage}</Text>
              ) : (
                filtered.map((opt) => {
                  const on = values.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() => toggle(opt.value)}
                      style={[styles.option, on && styles.optionOn]}
                    >
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on ? <Text style={styles.checkMark}>✓</Text> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionLabel}>{opt.label}</Text>
                        {opt.hint ? <Text style={styles.optionHint}>{opt.hint}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable onPress={() => setOpen(false)} style={styles.done} accessibilityRole="button">
              <Text style={styles.doneText}>Done ({values.length})</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  required: { color: colors.danger },
  helper: { color: colors.inkMuted, fontSize: 12, marginTop: -2 },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  fieldError: { borderColor: colors.danger },
  fieldDisabled: { opacity: 0.55 },
  value: { flex: 1, fontSize: 16, color: colors.ink, fontWeight: "600" },
  placeholder: { color: colors.inkMuted, fontWeight: "500" },
  errorText: { color: colors.danger, fontSize: 13 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10,30,20,0.45)",
    justifyContent: "flex-end",
    padding: space.md,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  sheetTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 44,
    backgroundColor: colors.bg,
  },
  search: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 12,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    minHeight: 48,
  },
  optionOn: { backgroundColor: colors.brandSoft },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkMark: { color: "#fff", fontWeight: "800", fontSize: 13 },
  optionLabel: { fontSize: 15, fontWeight: "700", color: colors.ink },
  optionHint: { fontSize: 12, color: colors.inkMuted, marginTop: 2 },
  empty: { color: colors.inkMuted, padding: space.md },
  done: {
    alignItems: "center",
    paddingVertical: 14,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
  },
  doneText: { color: colors.brand, fontWeight: "800" },
});
