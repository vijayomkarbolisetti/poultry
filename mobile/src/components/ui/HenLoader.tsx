import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";

import { colors, space } from "../../theme/tokens";

type Props = {
  label?: string;
};

/** Hen mark plus spinner. Use this wherever a screen is waiting on data. */
export function HenLoader({ label = "Loading your hens…" }: Props) {
  return (
    <View style={styles.wrap}>
      <Image source={require("../../../assets/icon.png")} style={styles.hen} resizeMode="contain" />
      <ActivityIndicator color={colors.brand} size="large" />
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
  hen: {
    width: 88,
    height: 88,
    borderRadius: 24,
  },
  label: {
    color: colors.inkMuted,
    fontSize: 15,
    fontWeight: "700",
  },
});
