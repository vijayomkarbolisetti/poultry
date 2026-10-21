import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, space } from "../../theme/tokens";
import { parseIsoDate, todayIsoDate } from "./selectUtils";

type Props = {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
};

/**
 * Lightweight date control (YYYY-MM-DD) without native picker dependency.
 * Validates calendar dates and offers a "Use today" shortcut.
 */
export function DateField({
  label,
  value,
  onChange,
  helper,
  error,
  required,
  disabled,
  placeholder = "YYYY-MM-DD",
  clearable,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const openEditor = () => {
    setDraft(value ?? todayIsoDate());
    setLocalError(null);
    setOpen(true);
  };

  const apply = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (required) {
        setLocalError("Date is required");
        return;
      }
      onChange(null);
      setOpen(false);
      return;
    }
    if (!parseIsoDate(trimmed)) {
      setLocalError("Enter a valid date as YYYY-MM-DD");
      return;
    }
    onChange(trimmed);
    setOpen(false);
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
        accessibilityLabel={`${label}${value ? `, ${value}` : ""}`}
        disabled={disabled}
        onPress={openEditor}
        style={({ pressed }) => [
          styles.field,
          error ? styles.fieldError : null,
          disabled ? styles.fieldDisabled : null,
          pressed && !disabled ? { opacity: 0.9 } : null,
        ]}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.inkMuted} />
        <Text style={[styles.value, !value && styles.placeholder]}>{value ?? placeholder}</Text>
        {clearable && value && !disabled ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            hitSlop={10}
            onPress={() => onChange(null)}
          >
            <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <TextInput
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                setLocalError(null);
              }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.inkMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />
            {localError ? <Text style={styles.error}>{localError}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setDraft(todayIsoDate());
                  setLocalError(null);
                }}
                style={styles.secondaryBtn}
              >
                <Text style={styles.secondaryText}>Use today</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={apply} style={styles.primaryBtn}>
                <Text style={styles.primaryText}>Apply</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setOpen(false)} style={styles.cancel}>
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
  sheetTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    fontSize: 16,
    color: colors.ink,
    minHeight: 52,
  },
  actions: { flexDirection: "row", gap: space.sm },
  secondaryBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.ink, fontWeight: "700" },
  primaryBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "#fff", fontWeight: "800" },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { color: colors.inkMuted, fontWeight: "700" },
});
