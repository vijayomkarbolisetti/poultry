import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, radius, space } from "../../theme/tokens";
import { filterSelectOptions, reconcileSelectValue } from "./selectUtils";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

export type SelectFieldProps = {
  label: string;
  placeholder?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string | null) => void;
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  emptyMessage?: string;
  /** Extra values treated as valid even if absent from options (e.g. "all"). */
  allowValues?: string[];
  /** Clear value when it disappears from options. Default true. */
  clearStale?: boolean;
  onRetry?: () => void;
  testID?: string;
};

/** Modal single-select dropdown with optional search, loading, and clear. */
export function SelectField({
  label,
  placeholder = "Select…",
  value,
  options,
  onChange,
  helper,
  error,
  required,
  disabled,
  loading,
  searchable,
  clearable,
  emptyMessage = "No options available yet",
  allowValues = [],
  clearStale = true,
  onRetry,
  testID,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!clearStale) return;
    const next = reconcileSelectValue(value, options, allowValues);
    if (next !== (value ?? null)) onChange(next);
    // Intentionally omit onChange — callers often pass inline setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, value, allowValues, clearStale]);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(
    () => (searchable ? filterSelectOptions(options, query) : options),
    [options, query, searchable],
  );

  const canOpen = !disabled && !loading;
  const a11yLabel = `${label}${required ? ", required" : ""}${selected ? `, selected ${selected.label}` : ", no selection"}`;

  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={{ disabled: !canOpen, expanded: open }}
        disabled={!canOpen}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.field,
          error ? styles.fieldError : null,
          disabled || loading ? styles.fieldDisabled : null,
          pressed && canOpen ? { opacity: 0.9 } : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.brand} style={{ marginRight: space.sm }} />
        ) : null}
        <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1}>
          {loading ? "Loading…" : (selected?.label ?? placeholder)}
        </Text>
        {clearable && value && !disabled && !loading ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={10}
            onPress={(e) => {
              e.stopPropagation?.();
              onChange(null);
            }}
            style={styles.clearBtn}
          >
            <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={18} color={colors.inkMuted} />
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

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
                <View style={styles.emptyBlock}>
                  <Text style={styles.empty}>{emptyMessage}</Text>
                  {onRetry ? (
                    <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
                      <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                filtered.map((opt) => {
                  const on = opt.value === value;
                  const optDisabled = Boolean(opt.disabled);
                  return (
                    <Pressable
                      key={opt.value}
                      disabled={optDisabled}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on, disabled: optDisabled }}
                      accessibilityLabel={`${opt.label}${on ? ", selected" : ""}`}
                      onPress={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      style={[styles.option, on && styles.optionOn, optDisabled && styles.optionDisabled]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{opt.label}</Text>
                        {opt.hint ? <Text style={styles.optionHint}>{opt.hint}</Text> : null}
                      </View>
                      {on ? <Ionicons name="checkmark-circle" size={20} color={colors.brand} /> : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable onPress={() => setOpen(false)} style={styles.cancel} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
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
  clearBtn: { padding: 4 },
  error: { color: colors.danger, fontSize: 13 },
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
  sheetTitle: { fontSize: 16, fontWeight: "800", color: colors.ink, marginBottom: 4 },
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
    gap: space.sm,
    paddingVertical: 14,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    minHeight: 48,
  },
  optionOn: { backgroundColor: colors.brandSoft },
  optionDisabled: { opacity: 0.4 },
  optionLabel: { fontSize: 15, fontWeight: "700", color: colors.ink },
  optionLabelOn: { color: colors.brand },
  optionHint: { fontSize: 12, color: colors.inkMuted, marginTop: 2 },
  emptyBlock: { padding: space.md, gap: space.sm, alignItems: "center" },
  empty: { color: colors.inkMuted, textAlign: "center" },
  retry: { paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { color: colors.brand, fontWeight: "800" },
  cancel: { alignItems: "center", paddingVertical: 12, minHeight: 44 },
  cancelText: { color: colors.inkMuted, fontWeight: "700" },
});
