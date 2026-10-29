import Ionicons from "@expo/vector-icons/Ionicons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, space } from "../../theme/tokens";
import {
  clampIsoDate,
  formatDisplayDate,
  formatIsoDate,
  parseIsoDate,
  todayIsoDate,
} from "./selectUtils";

export type AppDatePickerProps = {
  label: string;
  /** Controlled value as YYYY-MM-DD (API / storage format). */
  value: string | null;
  onChange: (value: string | null) => void;
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
  /** Inclusive minimum YYYY-MM-DD. */
  minimumDate?: string | null;
  /** Inclusive maximum YYYY-MM-DD. */
  maximumDate?: string | null;
  /** Show human-readable label (default). Pass false to show raw YYYY-MM-DD. */
  humanReadable?: boolean;
  testID?: string;
};

/**
 * App-wide date-only picker.
 * - Field is a non-editable pressable (never focuses a TextInput / keyboard).
 * - Android: native system date dialog.
 * - iOS: bottom sheet spinner with Cancel / Confirm / Use today.
 * Values are always local-calendar YYYY-MM-DD (no UTC day shift).
 */
export function AppDatePicker({
  label,
  value,
  onChange,
  helper,
  error,
  required,
  disabled,
  placeholder = "Select date",
  clearable,
  minimumDate,
  maximumDate,
  humanReadable = true,
  testID,
}: AppDatePickerProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => parseIsoDate(value ?? "") ?? new Date());

  const minDt = useMemo(
    () => (minimumDate ? parseIsoDate(minimumDate) ?? undefined : undefined),
    [minimumDate],
  );
  const maxDt = useMemo(
    () => (maximumDate ? parseIsoDate(maximumDate) ?? undefined : undefined),
    [maximumDate],
  );

  useEffect(() => {
    if (!open) return;
    const base = parseIsoDate(value ?? "") ?? new Date();
    const iso = clampIsoDate(formatIsoDate(base), minimumDate, maximumDate);
    setDraft(parseIsoDate(iso) ?? base);
  }, [open, value, minimumDate, maximumDate]);

  const display = value
    ? humanReadable
      ? formatDisplayDate(value)
      : value
    : placeholder;

  const openPicker = () => {
    if (disabled) return;
    Keyboard.dismiss();
    setOpen(true);
  };

  const closePicker = () => setOpen(false);

  const commitIso = (iso: string) => {
    onChange(clampIsoDate(iso, minimumDate, maximumDate));
  };

  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") {
      setOpen(false);
      if (event.type === "dismissed" || !selected) return;
      commitIso(formatIsoDate(selected));
      return;
    }
    if (selected) setDraft(selected);
  };

  const confirmIos = () => {
    commitIso(formatIsoDate(draft));
    setOpen(false);
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}${value ? `, ${display}` : ", no date selected"}`}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={openPicker}
        style={({ pressed }) => [
          styles.field,
          error ? styles.fieldError : null,
          disabled ? styles.fieldDisabled : null,
          pressed && !disabled ? { opacity: 0.9 } : null,
        ]}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.inkMuted} />
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {display}
        </Text>
        {clearable && value && !disabled && !required ? (
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

      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={draft}
          mode="date"
          display="default"
          onChange={onNativeChange}
          minimumDate={minDt}
          maximumDate={maxDt}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={closePicker}>
          <Pressable style={styles.scrim} onPress={closePicker} accessibilityLabel="Dismiss date picker">
            <Pressable
              style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.sheetHeader}>
                <Pressable onPress={closePicker} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {label.replace(/\s*\*$/, "")}
                </Text>
                <Pressable onPress={confirmIos} hitSlop={12} accessibilityRole="button">
                  <Text style={styles.confirmText}>Confirm</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={draft}
                mode="date"
                display="spinner"
                onChange={onNativeChange}
                minimumDate={minDt}
                maximumDate={maxDt}
                style={styles.iosPicker}
              />
              <Pressable
                onPress={() => {
                  const today = clampIsoDate(todayIsoDate(), minimumDate, maximumDate);
                  const dt = parseIsoDate(today);
                  if (dt) setDraft(dt);
                }}
                style={styles.todayBtn}
                accessibilityRole="button"
              >
                <Text style={styles.todayText}>Use today</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
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
  scrim: {
    flex: 1,
    backgroundColor: "rgba(10,30,20,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingHorizontal: space.md,
    gap: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sheetTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "800",
    color: colors.ink,
    marginHorizontal: 8,
  },
  cancelText: { color: colors.inkMuted, fontWeight: "700", fontSize: 16 },
  confirmText: { color: colors.brand, fontWeight: "800", fontSize: 16 },
  iosPicker: { alignSelf: "stretch" },
  todayBtn: {
    alignItems: "center",
    paddingVertical: 12,
    marginBottom: 4,
  },
  todayText: { color: colors.brand, fontWeight: "700", fontSize: 15 },
});
