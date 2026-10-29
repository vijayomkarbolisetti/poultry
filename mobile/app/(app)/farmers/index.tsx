import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listFarmers, type Farmer } from "../../../src/api/farmers";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { MediaCard } from "../../../src/components/ui/MediaCard";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { safeBack } from "../../../src/navigation/safeBack";
import { media } from "../../../src/theme/media";
import { colors, radius, shadow, space } from "../../../src/theme/tokens";

const ui = {
  mint: "#EFFFEB",
  deep: "#176B45",
} as const;

export default function FarmersScreen() {
  const { ownerAccountId, user } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");

  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: canManage,
  });

  const filtered = useMemo(() => {
    const rows = farmers.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (f) =>
        f.full_name.toLowerCase().includes(q) ||
        f.email.toLowerCase().includes(q) ||
        f.role.toLowerCase().includes(q),
    );
  }, [farmers.data, query]);

  if (!canManage) return <Redirect href="/(app)/home" />;

  const goCreate = () => router.push("/(app)/farmers/create");
  const list = farmers.data ?? [];
  const hasFarmers = list.length > 0;

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 8) }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => safeBack("/(app)/settings")}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={22} color={ui.deep} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Farmers</Text>
          <Text style={styles.sub}>Invite teammates and control shed access</Text>
        </View>
        {!hasFarmers && !farmers.isLoading ? (
          <Pressable
            onPress={goCreate}
            style={styles.addChip}
            accessibilityRole="button"
            accessibilityLabel="Add farmer"
          >
            <Ionicons name="person-add-outline" size={16} color="#fff" />
            <Text style={styles.addChipText}>Add</Text>
          </Pressable>
        ) : null}
      </View>

      {hasFarmers || farmers.isLoading ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.inkMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or email"
            placeholderTextColor={colors.inkMuted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search farmers"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {hasFarmers ? (
        <View style={styles.addRow}>
          <Text style={styles.countLabel}>
            {filtered.length} of {list.length} farmer{list.length === 1 ? "" : "s"}
          </Text>
          <Pressable
            onPress={goCreate}
            style={styles.addChip}
            accessibilityRole="button"
            accessibilityLabel="Add farmer"
          >
            <Ionicons name="person-add-outline" size={16} color="#fff" />
            <Text style={styles.addChipText}>Add farmer</Text>
          </Pressable>
        </View>
      ) : null}

      {farmers.isError ? <Text style={styles.error}>Could not load farmers</Text> : null}

      <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(item) => item.membership_id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          farmers.isLoading ? (
            <HenLoader label="Loading farmers…" />
          ) : hasFarmers ? (
            <View style={styles.noMatch}>
              <Text style={styles.noMatchTitle}>No matches</Text>
              <Text style={styles.noMatchBody}>Try another name or email.</Text>
            </View>
          ) : (
            <EmptyState
              title="No farmers yet"
              body="Add a farmer, assign sheds, and pick only the permissions they need."
              imageUri={media.farmMorning}
              actionLabel="Add farmer"
              onAction={goCreate}
            />
          )
        }
        renderItem={({ item }) => <FarmerListCard farmer={item} />}
      />
    </View>
  );
}

function FarmerListCard({ farmer }: { farmer: Farmer }) {
  const shedCount = farmer.assigned_shed_ids.length;
  const permCount = farmer.permission_codes.length;
  return (
    <MediaCard
      title={farmer.full_name}
      subtitle={farmer.email}
      meta={`${permCount} permission${permCount === 1 ? "" : "s"} · ${shedCount} shed${shedCount === 1 ? "" : "s"}`}
      icon="person"
      badge={farmer.is_active ? farmer.role.replace("_", " ") : "inactive"}
      badgeTone={farmer.is_active ? "good" : "neutral"}
      onPress={() => router.push(`/(app)/farmers/${farmer.membership_id}`)}
      footer={
        <View style={styles.cardFooter}>
          <View style={[styles.dot, { backgroundColor: farmer.is_active ? ui.deep : colors.inkMuted }]} />
          <Text style={styles.footerText}>
            {farmer.is_active ? "Active login" : "Deactivated"}
            {farmer.permission_codes.includes("vaccination.record") ? " · Can record vaccinations" : ""}
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "800", color: ui.deep },
  sub: { fontSize: 13, color: colors.inkMuted, marginTop: 2 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    minHeight: 48,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 10,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  countLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.inkMuted,
  },
  addChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: ui.deep,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  addChipText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 13,
  },
  error: { color: colors.danger },
  noMatch: {
    padding: space.lg,
    alignItems: "center",
    gap: 4,
  },
  noMatchTitle: { fontWeight: "800", color: colors.ink, fontSize: 16 },
  noMatchBody: { color: colors.inkMuted, fontSize: 14 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  footerText: { fontSize: 11, color: colors.inkMuted, fontWeight: "600" },
});
