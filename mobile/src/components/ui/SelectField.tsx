import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, radius, space } from "../../theme/tokens";

export type SelectOption = { value: string; label: string; hint?: string };

type Props = {
  label: string;
  placeholder?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  helper?: string;
};

/** Simple dropdown — tap to open a list, pick one option. */
export function SelectField({ label, placeholder = "Select…", value, options, onChange, helper }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.9 }]}
      >
        <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.inkMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {options.length === 0 ? (
                <Text style={styles.empty}>No options available yet</Text>
              ) : (
                options.map((opt) => {
                  const on = opt.value === value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      style={[styles.option, on && styles.optionOn]}
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
  value: { flex: 1, fontSize: 16, color: colors.ink, fontWeight: "600" },
  placeholder: { color: colors.inkMuted, fontWeight: "500" },
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
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 12,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  optionOn: { backgroundColor: colors.brandSoft },
  optionLabel: { fontSize: 15, fontWeight: "700", color: colors.ink },
  optionLabelOn: { color: colors.brand },
  optionHint: { fontSize: 12, color: colors.inkMuted, marginTop: 2 },
  empty: { color: colors.inkMuted, padding: space.md },
  cancel: { alignItems: "center", paddingVertical: 12 },
  cancelText: { color: colors.inkMuted, fontWeight: "700" },
});
