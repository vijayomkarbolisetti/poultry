import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, shadow, space } from "../../../src/theme/tokens";

type Filter = "all" | "owner" | "farmer";

export default function ShedsScreen() {
  const { user, ownerAccountId } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const canCreate = membership?.role === "owner";
  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: listSheds });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const data = useMemo(() => {
    let rows = sheds.data ?? [];
    if (filter === "owner") rows = rows.filter((s) => s.is_owner_managed);
    if (filter === "farmer") rows = rows.filter((s) => !s.is_owner_managed);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((s) => s.name.toLowerCase().includes(needle) || s.code.toLowerCase().includes(needle));
    }
    return rows;
  }, [sheds.data, filter, q]);

  return (
    <Screen style={{ paddingTop: space.md }}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={colors.inkMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search sheds"
          placeholderTextColor={colors.inkMuted}
          style={styles.search}
        />
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["all", "All"],
            ["owner", "Owner"],
            ["farmer", "Farmer"],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={[styles.tab, filter === key && styles.tabOn]}
          >
            <Text style={[styles.tabLabel, filter === key && styles.tabLabelOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {canCreate ? <Button label="Add shed" onPress={() => router.push("/(app)/sheds/create")} /> : null}

      {sheds.isLoading ? <Text style={styles.meta}>Loading…</Text> : null}
      {sheds.isError ? <Text style={styles.error}>Failed to load sheds</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={
          !sheds.isLoading ? <Text style={styles.meta}>No sheds yet. Create one to get started.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, shadow.card, pressed && { opacity: 0.9 }]}
            onPress={() => router.push(`/(app)/sheds/${item.id}`)}
          >
            <View style={styles.thumb}>
              <Ionicons name="business" size={22} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {item.code} · {item.is_owner_managed ? "Owner-managed" : "Farmer-managed"}
              </Text>
            </View>
            <View style={[styles.badge, item.is_active ? styles.badgeOn : styles.badgeOff]}>
              <Text style={[styles.badgeText, item.is_active ? styles.badgeTextOn : null]}>
                {item.is_active ? "Active" : "Inactive"}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
  },
  search: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 12 },
  tabs: { flexDirection: "row", gap: space.sm },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tabLabel: { fontWeight: "700", color: colors.inkMuted, fontSize: 13 },
  tabLabelOn: { color: "#fff" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 16, fontWeight: "800", color: colors.ink },
  meta: { fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeOn: { backgroundColor: colors.brandSoft },
  badgeOff: { backgroundColor: "#F0F0F0" },
  badgeText: { fontSize: 11, fontWeight: "800", color: colors.inkMuted },
  badgeTextOn: { color: colors.brand },
  error: { color: colors.danger },
});
