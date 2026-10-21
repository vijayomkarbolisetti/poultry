import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors, gradients, layout, radius, shadows, space, states, typography } from "../../theme/tokens";

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
  const isSecondary = variant === "secondary";
  const inactive = Boolean(disabled || loading);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.pressable,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {({ pressed }) => (
        <View style={styles.inner}>
          {isPrimary ? (
            <LinearGradient
              colors={[...(pressed && !inactive ? gradients.primaryPressed : gradients.primary)]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.base, styles.primaryGradient, shadows.button]}
            >
              <ButtonLabel label={label} loading={loading} onDark />
            </LinearGradient>
          ) : (
            <View
              style={[
                styles.base,
                isSecondary && styles.secondary,
                isDanger && styles.danger,
                isGhost && styles.ghost,
              ]}
            >
              <ButtonLabel
                label={label}
                loading={loading}
                onDark={isDanger}
                brand={!isDanger}
              />
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

function ButtonLabel({
  label,
  loading,
  onDark,
  brand,
}: {
  label: string;
  loading?: boolean;
  onDark?: boolean;
  brand?: boolean;
}) {
  return (
    <>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={onDark ? colors.textOnPrimary : colors.primary}
          style={styles.spinner}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          onDark && styles.labelOnDark,
          brand && styles.labelBrand,
        ]}
      >
        {label}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  pressable: { width: "100%" },
  inner: { width: "100%" },
  base: {
    minHeight: layout.buttonMinHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: space.lg,
  },
  primaryGradient: { overflow: "hidden" },
  spinner: { marginRight: space.sm },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: states.disabledOpacity },
  pressed: { transform: [{ scale: states.pressedScale }], opacity: states.pressedOpacity },
  label: { ...typography.button },
  labelOnDark: { color: colors.textOnPrimary },
  labelBrand: { color: colors.primary },
});
