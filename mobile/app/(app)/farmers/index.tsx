import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { listFarmers, type Farmer } from "../../../src/api/farmers";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { filterFarmers } from "../../../src/features/farmers/farmerListHelpers";
import { safeBack } from "../../../src/navigation/safeBack";
import { farmerHeaderArt } from "../../../src/theme/media";
import { colors, radius, shadow, space, typography } from "../../../src/theme/tokens";

const ui = {
  bg: "#F1F8F5",
  mint: "#E8F6F0",
  deep: "#176B45",
  ink: "#102A22",
  muted: "#6B7C75",
  border: "#D7E4DE",
  card: "#FFFFFF",
  inactive: "#D92D20",
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

  const list = farmers.data ?? [];
  const hasFarmers = list.length > 0;
  const filtered = useMemo(() => filterFarmers(list, query), [list, query]);

  if (!canManage) return <Redirect href="/(app)/home" />;

  const goCreate = () => router.push("/(app)/farmers/create");

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: Math.max(insets.top, 8) }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
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
        <View style={styles.topBarCopy}>
          <Text style={styles.title}>Farmers</Text>
          <Text style={styles.sub}>Invite teammates and manage farm access.</Text>
        </View>
        <Pressable
          onPress={goCreate}
          style={styles.addBtn}
          accessibilityRole="button"
          accessibilityLabel="Add farmer"
        >
          <Ionicons name="person-add" size={18} color="#fff" />
        </Pressable>
      </View>

      {hasFarmers ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={ui.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search farmers"
            placeholderTextColor={ui.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search farmers"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={ui.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {farmers.isError ? (
        <Text style={styles.error}>{describeApiError(farmers.error, "load farmers")}</Text>
      ) : null}

      <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(item) => item.membership_id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          farmers.isLoading ? (
            <HenLoader label="Loading farmers…" />
          ) : hasFarmers ? (
            <View style={styles.noMatch}>
              <Ionicons name="search-outline" size={28} color={ui.muted} />
              <Text style={styles.noMatchTitle}>No matching farmers</Text>
              <Text style={styles.noMatchBody}>Try a different name or email.</Text>
            </View>
          ) : (
            <EmptyFarmersCard onAdd={goCreate} />
          )
        }
        renderItem={({ item }) => <FarmerListCard farmer={item} />}
      />
    </KeyboardAvoidingView>
  );
}

function EmptyFarmersCard({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={[styles.emptyCard, shadow.card]}>
      <View style={styles.emptyArt}>
        <Image source={farmerHeaderArt} style={styles.emptyImg} resizeMode="cover" />
      </View>
      <Text style={styles.emptyTitle}>No farmers added yet</Text>
      <Text style={styles.emptyBody}>
        Invite farmers to help manage your sheds, birds and vaccination activities.
      </Text>
      <Button label="Add your first farmer" onPress={onAdd} />
    </View>
  );
}

function FarmerListCard({ farmer }: { farmer: Farmer }) {
  const shedCount = farmer.assigned_shed_ids.length;
  const initials = farmer.full_name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Pressable
      onPress={() => router.push(`/(app)/farmers/${farmer.membership_id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${farmer.full_name}, ${farmer.is_active ? "Active" : "Inactive"}`}
      style={({ pressed }) => [styles.card, shadow.card, pressed && { opacity: 0.94 }]}
    >
      <View style={styles.avatar}>
        {initials ? (
          <Text style={styles.avatarText}>{initials}</Text>
        ) : (
          <Ionicons name="person" size={18} color={ui.deep} />
        )}
      </View>
      <View style={styles.cardCopy}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {farmer.full_name}
          </Text>
          <View style={[styles.statusPill, farmer.is_active ? styles.statusOn : styles.statusOff]}>
            <View
              style={[styles.statusDot, { backgroundColor: farmer.is_active ? ui.deep : ui.inactive }]}
            />
            <Text style={[styles.statusText, { color: farmer.is_active ? ui.deep : ui.inactive }]}>
              {farmer.is_active ? "Active" : "Inactive"}
            </Text>
          </View>
        </View>
        <Text style={styles.cardEmail} numberOfLines={1}>
          {farmer.email}
        </Text>
        <Text style={styles.cardMeta}>
          {shedCount} shed{shedCount === 1 ? "" : "s"} assigned
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={ui.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: ui.bg,
    paddingHorizontal: space.md,
    gap: 10,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topBarCopy: { flex: 1, minWidth: 0, gap: 2 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: ui.deep, letterSpacing: -0.3 },
  sub: { fontSize: typography.secondary.fontSize, fontWeight: "500", color: ui.muted, lineHeight: 18 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: ui.deep,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: ui.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: ui.border,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: ui.ink,
    paddingVertical: 8,
  },
  listContent: {
    gap: 10,
    paddingBottom: 28,
    paddingTop: 4,
    flexGrow: 1,
  },
  emptyCard: {
    backgroundColor: ui.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: ui.border,
    padding: 16,
    gap: 10,
    marginTop: 8,
  },
  emptyArt: {
    alignSelf: "center",
    width: "100%",
    height: 132,
    borderRadius: 16,
    backgroundColor: ui.mint,
    overflow: "hidden",
  },
  emptyImg: { width: "100%", height: "100%" },
  emptyTitle: {
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: ui.deep,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: typography.label.fontSize,
    color: ui.muted,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  noMatch: {
    alignItems: "center",
    gap: 6,
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  noMatchTitle: { fontWeight: "800", color: ui.ink, fontSize: typography.sectionTitle.fontSize },
  noMatchBody: { color: ui.muted, fontSize: typography.label.fontSize, textAlign: "center" },
  error: { color: colors.danger, fontWeight: "600", fontSize: typography.secondary.fontSize },
  card: {
    backgroundColor: ui.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ui.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: typography.label.fontSize, fontWeight: "800", color: ui.deep },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardName: { flex: 1, fontSize: typography.bodyStrong.fontSize, fontWeight: "800", color: ui.ink },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusOn: { backgroundColor: ui.mint },
  statusOff: { backgroundColor: "#FEE7E5" },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: typography.overline.fontSize, fontWeight: "800" },
  cardEmail: { fontSize: typography.secondary.fontSize, color: ui.muted, fontWeight: "500" },
  cardMeta: { fontSize: typography.caption.fontSize, color: ui.muted, fontWeight: "600" },
});
