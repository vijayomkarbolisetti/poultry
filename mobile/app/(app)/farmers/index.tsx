import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { listFarmers } from "../../../src/api/farmers";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function FarmersScreen() {
  const { ownerAccountId } = useAuth();
  const farmers = useQuery({ queryKey: ["farmers", ownerAccountId], queryFn: listFarmers });

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Farmers</Text>
        <Button label="Add" onPress={() => router.push("/(app)/farmers/create")} />
      </View>
      {farmers.isError ? <Text style={styles.error}>Failed to load (need farmer.manage)</Text> : null}
      <FlatList
        data={farmers.data ?? []}
        keyExtractor={(item) => item.membership_id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={<Text style={styles.meta}>No farmers yet</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/(app)/farmers/${item.membership_id}`)}>
            <Text style={styles.name}>{item.full_name}</Text>
            <Text style={styles.meta}>
              {item.email} · {item.role} · {item.is_active ? "active" : "inactive"}
            </Text>
            <Text style={styles.meta}>
              Perms: {item.permission_codes.length ? item.permission_codes.join(", ") : "none"}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.brand, flex: 1 },
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
