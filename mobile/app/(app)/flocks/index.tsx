import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { listFlocks } from "../../../src/api/flocks";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function FlocksScreen() {
  const { ownerAccountId } = useAuth();
  const flocks = useQuery({ queryKey: ["flocks", ownerAccountId], queryFn: () => listFlocks() });

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.count}>{flocks.data ? `${flocks.data.length} flock${flocks.data.length === 1 ? "" : "s"}` : ""}</Text>
        <Button label="Onboard" onPress={() => router.push("/(app)/flocks/create")} />
      </View>
      {flocks.isError ? <Text style={styles.error}>Failed to load flocks</Text> : null}
      <FlatList
        data={flocks.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={<Text style={styles.meta}>No flocks yet</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/(app)/flocks/${item.id}`)}>
            <Text style={styles.name}>{item.batch_code}</Text>
            <Text style={styles.meta}>
              {item.tracking_mode} · {item.current_count} birds · {item.dob_confidence} DOB
              {item.count_mismatch ? " · COUNT MISMATCH" : ""}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.sm },
  count: { fontSize: 14, fontWeight: "600", color: colors.inkMuted, flex: 1 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  name: { fontSize: 17, fontWeight: "700", color: colors.ink },
  meta: { color: colors.inkMuted, fontSize: 13 },
  error: { color: colors.danger },
});
