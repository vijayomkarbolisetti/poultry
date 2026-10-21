import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, space } from "../../theme/tokens";

export type RadioChipOption = { value: string; label: string; hint?: string };

type Props = {
  label: string;
  value: string;
  options: RadioChipOption[];
  onChange: (value: string) => void;
  helper?: string;
  error?: string;
  required?: boolean;
};

/** Compact single-select chips for small static enums (tracking mode, DOB confidence). */
export function RadioChips({ label, value, options, onChange, helper, error, required }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      <View style={styles.row}>
        {options.map((opt) => {
          const on = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={opt.label}
              onPress={() => onChange(opt.value)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{opt.label}</Text>
              {opt.hint ? <Text style={styles.hint}>{opt.hint}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  required: { color: colors.danger },
  helper: { color: colors.inkMuted, fontSize: 12, marginTop: -2 },
  row: { gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    backgroundColor: colors.bgElevated,
    minHeight: 48,
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { color: colors.ink, fontWeight: "600", textTransform: "capitalize" },
  chipTextOn: { color: colors.brand, fontWeight: "800" },
  hint: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  error: { color: colors.danger, fontSize: 13 },
});
