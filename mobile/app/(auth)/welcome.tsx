import { router } from "expo-router";
import { useEffect } from "react";
import { ImageBackground, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { warmApi } from "../../src/api/auth";
import { Button } from "../../src/components/ui/Button";
import { media } from "../../src/theme/media";
import { colors, space } from "../../src/theme/tokens";

export default function WelcomeScreen() {
  useEffect(() => {
    warmApi();
  }, []);

  return (
    <View style={styles.root}>
      <ImageBackground source={{ uri: media.welcomeHen }} style={styles.bg} resizeMode="cover">
        <View style={styles.scrim}>
          <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
            <View style={styles.top}>
              <View style={styles.logoMark}>
                <Text style={styles.logoMarkText}>PT</Text>
              </View>
              <View>
                <Text style={styles.brand}>PoultryTrack</Text>
                <Text style={styles.brandSub}>Farm health, made simple</Text>
              </View>
            </View>

            <View style={styles.bottom}>
              <Text style={styles.eyebrow}>FOR MODERN POULTRY FARMS</Text>
              <Text style={styles.tagline}>Healthy Hens.{"\n"}Better Harvest.</Text>
              <Text style={styles.sub}>
                Beautiful tools to track sheds, flocks, and vaccination tasks — so every bird stays on schedule.
              </Text>
              <Button label="Get Started" onPress={() => router.push("/(auth)/login")} />
              <Button
                label="Create farm account"
                variant="ghost"
                onPress={() => router.push("/(auth)/register")}
              />
            </View>
          </SafeAreaView>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brandDark },
  bg: { flex: 1 },
  scrim: { flex: 1, backgroundColor: "rgba(6,28,16,0.58)" },
  safe: { flex: 1, justifyContent: "space-between", padding: space.lg },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarkText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  brand: { color: "#fff", fontSize: 22, fontWeight: "800" },
  brandSub: { color: "#C8E0D1", fontSize: 12, fontWeight: "600" },
  bottom: { gap: space.md, paddingBottom: space.md },
  eyebrow: {
    color: "#9FD4B4",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  tagline: { color: "#fff", fontSize: 38, fontWeight: "800", lineHeight: 44, letterSpacing: -0.8 },
  sub: { color: "#D5E8DC", fontSize: 16, lineHeight: 24, marginBottom: space.sm },
});
