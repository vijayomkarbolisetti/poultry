import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";

import { colors, radius, space } from "../../theme/tokens";

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, loading, variant = "primary", disabled, style }: Props) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  const isGhost = variant === "ghost";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary && styles.primary,
        variant === "secondary" && styles.secondary,
        isDanger && styles.danger,
        isGhost && styles.ghost,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isPrimary || isDanger ? "#fff" : colors.brand}
          style={styles.spinner}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          (isPrimary || isDanger) && styles.labelOnDark,
          (variant === "secondary" || isGhost) && styles.labelBrand,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: space.lg,
  },
  spinner: { marginRight: space.sm },
  primary: { backgroundColor: colors.brand },
  secondary: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1.5,
    borderColor: colors.brand,
  },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  label: { fontSize: 16, fontWeight: "700" },
  labelOnDark: { color: "#fff" },
  labelBrand: { color: colors.brand },
});
