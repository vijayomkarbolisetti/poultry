import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { birdUi } from "../../../src/theme/birdManagementUi";

export default function BirdAddedScreen() {
  const params = useLocalSearchParams<{
    shedId?: string | string[];
    flockId?: string | string[];
    bandId?: string | string[];
    batchCode?: string | string[];
  }>();
  const shedId = firstRouteParam(params.shedId);
  const flockId = firstRouteParam(params.flockId);
  const bandId = firstRouteParam(params.bandId) ?? "—";
  const batchCode = firstRouteParam(params.batchCode) ?? "Group";

  const addAnother = () => {
    if (!shedId || !flockId) {
      if (shedId) router.replace(`/(app)/sheds/${shedId}`);
      else router.replace("/(app)/sheds");
      return;
    }
    router.replace({
      pathname: "/(app)/birds/add",
      params: { shedId, flockId, rapid: "1" },
    });
  };

  const done = () => {
    if (shedId) router.replace(`/(app)/sheds/${shedId}`);
    else router.replace("/(app)/sheds");
  };

  return (
    <Screen edges={["left", "right", "bottom"]}>
      <View style={styles.center}>
        <View style={styles.iconRing}>
          <Ionicons name="checkmark-circle" size={56} color={birdUi.successText} />
        </View>
        <Text style={styles.title}>Bird added!</Text>
        <Text style={styles.band}>{bandId}</Text>
        <Text style={styles.meta}>Saved to {batchCode}</Text>

        <View style={styles.actions}>
          <Button label="Add another bird" onPress={addAnother} />
          <Button label="Done" variant="secondary" onPress={done} />
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
    gap: 10,
    paddingHorizontal: 8,
  },
  iconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: birdUi.successBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: { fontSize: 28, fontWeight: "800", color: birdUi.text, letterSpacing: -0.4 },
  band: {
    fontSize: 20,
    fontWeight: "800",
    color: birdUi.primary,
    backgroundColor: birdUi.paleMint,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  meta: { fontSize: 15, color: birdUi.muted },
  actions: { width: "100%", gap: 10, marginTop: 20 },
});
