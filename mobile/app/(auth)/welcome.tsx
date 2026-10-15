import { router } from "expo-router";
import { useEffect } from "react";
import { ImageBackground, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { warmApi } from "../../src/api/auth";
import { Button } from "../../src/components/ui/Button";
import { colors, space } from "../../src/theme/tokens";

export default function WelcomeScreen() {
  useEffect(() => {
    warmApi();
  }, []);

  return (
    <View style={styles.root}>
      <ImageBackground
        source={{
          uri: "https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?auto=format&fit=crop&w=1200&q=80",
        }}
        style={styles.bg}
        resizeMode="cover"
      >
        <View style={styles.scrim}>
          <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
            <View style={styles.top}>
              <View style={styles.logoMark}>
                <Text style={styles.logoMarkText}>PT</Text>
              </View>
              <Text style={styles.brand}>PoultryTrack</Text>
            </View>

            <View style={styles.bottom}>
              <Text style={styles.tagline}>Healthy Birds.{"\n"}Better Farms.</Text>
              <Text style={styles.sub}>
                Track sheds, flocks, and vaccinations — on time, every cycle.
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
  scrim: { flex: 1, backgroundColor: "rgba(8,40,24,0.72)" },
  safe: { flex: 1, justifyContent: "space-between", padding: space.lg },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarkText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  brand: { color: "#fff", fontSize: 22, fontWeight: "800" },
  bottom: { gap: space.md, paddingBottom: space.md },
  tagline: { color: "#fff", fontSize: 36, fontWeight: "800", lineHeight: 42, letterSpacing: -0.8 },
  sub: { color: "#D5E8DC", fontSize: 16, lineHeight: 24, marginBottom: space.sm },
});
