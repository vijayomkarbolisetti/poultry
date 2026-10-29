import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";

import { colors, layout, radius, space, states, typography } from "../../theme/tokens";

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  style?: ViewStyle;
};

/**
 * Shared CTA. Solid fills only — avoid LinearGradient + Android elevation
 * (that combo paints a dark half-overlay on the button face).
 */
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
        isPrimary && !inactive && styles.primaryLift,
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      <View
        style={[
          styles.base,
          isPrimary && styles.primary,
          isSecondary && styles.secondary,
          isDanger && styles.danger,
          isGhost && styles.ghost,
        ]}
      >
        <ButtonLabel
          label={label}
          loading={loading}
          onDark={isPrimary || isDanger}
          brand={isSecondary || isGhost}
        />
      </View>
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
        numberOfLines={1}
      >
        {label}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: "100%",
    alignSelf: "stretch",
  },
  /** Soft lift without overlaying the fill (shadow on wrapper, not clipped child). */
  primaryLift: Platform.select({
    ios: {
      shadowColor: "#022C22",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
    },
    android: {
      elevation: 2,
    },
    default: {},
  }),
  base: {
    height: layout.buttonMinHeight,
    minHeight: layout.buttonMinHeight,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingHorizontal: space.lg,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: "transparent" },
  spinner: { marginRight: space.sm },
  disabled: { opacity: states.disabledOpacity },
  pressed: { transform: [{ scale: states.pressedScale }], opacity: states.pressedOpacity },
  label: {
    ...typography.button,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  labelOnDark: { color: colors.textOnPrimary },
  labelBrand: { color: colors.primary },
});
