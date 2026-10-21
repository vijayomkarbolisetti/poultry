import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { BrandLogo } from "../brand/BrandLogo";
import { colors, space } from "../../theme/tokens";

type Props = {
  label?: string;
};

/** Brand mark plus spinner. Use this wherever a screen is waiting on data. */
export function HenLoader({ label = "Loading your farm…" }: Props) {
  return (
    <View style={styles.wrap}>
      <BrandLogo size={88} preferPng />
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    paddingVertical: space.xl,
    minHeight: 220,
  },
  label: {
    color: colors.inkMuted,
    fontSize: 15,
    fontWeight: "700",
  },
});
