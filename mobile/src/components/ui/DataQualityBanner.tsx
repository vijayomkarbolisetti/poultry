import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius, space } from "../../theme/tokens";

type Props = {
  message: string;
  accessibilityLabel?: string;
};

/** Compact, consistent warning for count-mismatch / data-quality signals. */
export function DataQualityBanner({ message, accessibilityLabel }: Props) {
  return (
    <View
      style={styles.banner}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? message}
    >
      <Ionicons name="warning-outline" size={16} color={colors.warning} style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.xs,
    marginTop: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    backgroundColor: colors.warning + "14",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning + "55",
  },
  icon: { marginTop: 1 },
  text: {
    flex: 1,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    lineHeight: 18,
  },
});
