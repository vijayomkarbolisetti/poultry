import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { MediaCard } from "../../../src/components/ui/MediaCard";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { media } from "../../../src/theme/media";
import { colors, radius, space } from "../../../src/theme/tokens";

type Filter = "all" | "owner" | "farmer";

export default function ShedsScreen() {
  const { user, ownerAccountId } = useAuth();
  const canCreate = hasPermission(user, ownerAccountId, "shed.create");
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
      <Text style={styles.title}>Sheds</Text>
      <Text style={styles.sub}>Where your hens live — search and filter below</Text>

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
          <Pressable key={key} onPress={() => setFilter(key)} style={[styles.tab, filter === key && styles.tabOn]}>
            <Text style={[styles.tabLabel, filter === key && styles.tabLabelOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {canCreate ? <Button label="Add shed" onPress={() => router.push("/(app)/sheds/create")} /> : null}
      {sheds.isError ? <Text style={styles.error}>Failed to load sheds</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={
          sheds.isLoading ? (
            <Text style={styles.meta}>Loading…</Text>
          ) : (
            <EmptyState
              title="No sheds yet"
              body="Create a shed to house flocks and assign farmers."
              imageUri={media.shedYard}
              actionLabel={canCreate ? "Add first shed" : undefined}
              onAction={canCreate ? () => router.push("/(app)/sheds/create") : undefined}
            />
          )
        }
        renderItem={({ item }) => (
          <MediaCard
            title={item.name}
            subtitle={item.code}
            meta={item.is_owner_managed ? "Owner-managed" : "Farmer-managed"}
            imageUri={media.shedYard}
            icon="business"
            badge={item.is_active ? "Active" : "Inactive"}
            badgeTone={item.is_active ? "good" : "neutral"}
            onPress={() => router.push(`/(app)/sheds/${item.id}`)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  sub: { color: colors.inkMuted, fontSize: 13, marginTop: -space.sm },
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
  meta: { fontSize: 13, color: colors.inkMuted },
  error: { color: colors.danger },
});
