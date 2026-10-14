import { useQuery } from "@tanstack/react-query";
import { Link, router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function ShedsScreen() {
  const { user, ownerAccountId } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const canCreate = membership?.role === "owner"; // org_admin needs shed.create grant — hide unless owner for simplicity in UI
  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: listSheds });

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Sheds</Text>
        {canCreate ? <Button label="Add shed" onPress={() => router.push("/(app)/sheds/create")} /> : null}
      </View>

      {sheds.isLoading ? <Text>Loading…</Text> : null}
      {sheds.isError ? <Text style={styles.error}>Failed to load sheds</Text> : null}
      {!sheds.isLoading && (sheds.data?.length ?? 0) === 0 ? (
        <Text style={styles.empty}>No sheds yet. Create one to get started.</Text>
      ) : null}

      <FlatList
        data={sheds.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/(app)/sheds/${item.id}`)}
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>
              {item.code} · {item.is_owner_managed ? "Owner-managed" : "Farmer-managed"}
            </Text>
            <Link href={`/(app)/sheds/${item.id}`} style={styles.link}>
              Open →
            </Link>
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
  link: { color: colors.brand, fontWeight: "700", marginTop: 6 },
  empty: { color: colors.inkMuted },
  error: { color: colors.danger },
});
