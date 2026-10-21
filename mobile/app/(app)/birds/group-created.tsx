import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { birdUi } from "../../../src/theme/birdManagementUi";

export default function GroupCreatedScreen() {
  const params = useLocalSearchParams<{
    shedId?: string | string[];
    flockId?: string | string[];
    batchCode?: string | string[];
    count?: string | string[];
    shedName?: string | string[];
  }>();
  const shedId = firstRouteParam(params.shedId);
  const flockId = firstRouteParam(params.flockId);
  const batchCode = firstRouteParam(params.batchCode) ?? "Group";
  const count = firstRouteParam(params.count) ?? "0";
  const shedName = firstRouteParam(params.shedName) ?? "this shed";

  const goTag = () => {
    if (!shedId || !flockId) {
      if (shedId) router.replace(`/(app)/sheds/${shedId}`);
      else router.replace("/(app)/sheds");
      return;
    }
    router.replace({
      pathname: "/(app)/birds/add",
      params: { shedId, flockId },
    });
  };

  const goDone = () => {
    if (shedId) router.replace(`/(app)/sheds/${shedId}`);
    else router.replace("/(app)/sheds");
  };

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <View style={styles.center}>
        <View style={styles.hero}>
          <View style={styles.iconRing}>
            <Ionicons name="checkmark-circle" size={56} color={birdUi.successText} />
          </View>
          <View style={styles.confettiRow}>
            <View style={[styles.dot, { backgroundColor: birdUi.primary }]} />
            <View style={[styles.dot, { backgroundColor: birdUi.orange }]} />
            <View style={[styles.dot, { backgroundColor: birdUi.blue }]} />
            <View style={[styles.dot, { backgroundColor: birdUi.teal }]} />
          </View>
        </View>

        <Text style={styles.title}>Group created!</Text>
        <Text style={styles.body}>
          {count} birds added to {shedName}
        </Text>
        <Text style={styles.meta}>{batchCode}</Text>

        <View style={styles.actions}>
          <Button label="Tag birds now" onPress={goTag} />
          <Button label="Done" variant="secondary" onPress={goDone} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
  },
  hero: { alignItems: "center", marginBottom: 8 },
  iconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: birdUi.successBg,
    alignItems: "center",
    justifyContent: "center",
  },
  confettiRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 28, fontWeight: "800", color: birdUi.text, letterSpacing: -0.4 },
  body: {
    fontSize: 16,
    color: birdUi.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 12,
  },
  meta: {
    fontSize: 14,
    fontWeight: "700",
    color: birdUi.primary,
    backgroundColor: birdUi.paleMint,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
  },
  actions: { width: "100%", gap: 10, marginTop: 20 },
});
