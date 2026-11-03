import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  listOwnerAccounts,
  updateFarmOwnerUser,
  type OwnerAccountListItem,
} from "../../../src/api/owners";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { safeBack } from "../../../src/navigation/safeBack";
import { colors, radius, shadow, space, typography } from "../../../src/theme/tokens";
import { toast } from "../../../src/ui/toast/toastStore";

const ui = {
  mint: "#EFFFEB",
  deep: "#176B45",
} as const;

export default function FarmsScreen() {
  const { user, ownerAccountId, setActiveOwner } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [editFarm, setEditFarm] = useState<OwnerAccountListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const isSuper = Boolean(user?.is_platform_super_admin);

  const farms = useQuery({
    queryKey: ["owners", "all"],
    queryFn: listOwnerAccounts,
    enabled: isSuper,
  });

  const filtered = useMemo(() => {
    const rows = farms.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.owner_email ?? "").toLowerCase().includes(q) ||
        (f.owner_full_name ?? "").toLowerCase().includes(q),
    );
  }, [farms.data, query]);

  if (!isSuper) return <Redirect href="/(app)/home" />;

  const openFarm = async (farm: OwnerAccountListItem) => {
    await setActiveOwner(farm.id);
    toast.success(`Opened ${farm.name}`);
    router.replace("/(app)/home");
  };

  const openEdit = (farm: OwnerAccountListItem) => {
    setEditFarm(farm);
    setEditName(farm.owner_full_name ?? "");
    setEditPassword("");
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editFarm) return;
    const name = editName.trim();
    const password = editPassword.trim();
    if (!name && !password) {
      setEditError("Enter a new owner name and/or password.");
      return;
    }
    setEditLoading(true);
    setEditError(null);
    try {
      await updateFarmOwnerUser(editFarm.id, {
        full_name: name || undefined,
        password: password || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["owners", "all"] });
      toast.success("Owner updated");
      setEditFarm(null);
    } catch (e: unknown) {
      setEditError(describeApiError(e, "update owner"));
    } finally {
      setEditLoading(false);
    }
  };

  const goCreate = () => router.push("/(app)/farms/create");
  const list = farms.data ?? [];
  const hasFarms = list.length > 0;

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
        <View style={styles.topBarCopy}>
          <Text style={styles.title}>All farms</Text>
          <Text style={styles.sub}>Create owner accounts and open any farm</Text>
        </View>
        <Pressable
          onPress={goCreate}
          style={styles.addChipHeader}
          accessibilityRole="button"
          accessibilityLabel="Create farm"
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addChipText}>Add</Text>
        </Pressable>
      </View>

      {hasFarms || farms.isLoading ? (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.inkMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search farm or owner"
            placeholderTextColor={colors.inkMuted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search farms"
          />
        </View>
      ) : null}

      {farms.isLoading ? (
        <HenLoader label="Loading farms…" />
      ) : farms.isError ? (
        <EmptyState
          title="Could not load farms"
          body="Check that the API is reachable, then try again."
          actionLabel="Retry"
          onAction={() => void farms.refetch()}
        />
      ) : !hasFarms ? (
        <EmptyState
          title="No farms yet"
          body="Create the first farm owner account to get started."
          actionLabel="Create farm"
          onAction={goCreate}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptySearch}>No farms match “{query.trim()}”.</Text>
          }
          renderItem={({ item }) => {
            const active = item.id === ownerAccountId;
            return (
              <View style={[styles.card, shadow.card, active && styles.cardActive]}>
                <Pressable
                  onPress={() => void openFarm(item)}
                  style={styles.cardMain}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.name}`}
                >
                  <View style={styles.cardIcon}>
                    <Ionicons name="business-outline" size={20} color={ui.deep} />
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {item.owner_full_name || item.owner_email || "No owner on file"}
                      {item.owner_email && item.owner_full_name ? ` · ${item.owner_email}` : ""}
                    </Text>
                    <Text style={styles.passwordLine} numberOfLines={1}>
                      Password: {item.owner_password || "—"}
                      {item.owner_must_change_password ? " · must change" : ""}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => openEdit(item)}
                  style={styles.editBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit owner for ${item.name}`}
                  hitSlop={8}
                >
                  <Ionicons name="create-outline" size={18} color={ui.deep} />
                </Pressable>
              </View>
            );
          }}
        />
      )}

      <Modal visible={Boolean(editFarm)} transparent animationType="fade" onRequestClose={() => setEditFarm(null)}>
        <Pressable style={styles.modalScrim} onPress={() => setEditFarm(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Edit farm owner</Text>
            <Text style={styles.modalSub}>{editFarm?.name}</Text>
            <Text style={styles.label}>Owner name</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              autoCapitalize="words"
              placeholder="Owner full name"
              placeholderTextColor={colors.inkMuted}
            />
            <Text style={styles.label}>New password (optional)</Text>
            <TextInput
              style={styles.input}
              value={editPassword}
              onChangeText={setEditPassword}
              autoCapitalize="none"
              secureTextEntry
              placeholder="Leave blank to keep current"
              placeholderTextColor={colors.inkMuted}
            />
            {editError ? <Text style={styles.error}>{editError}</Text> : null}
            <Button label="Save" onPress={() => void saveEdit()} loading={editLoading} />
            <Button label="Cancel" variant="ghost" onPress={() => setEditFarm(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.md, gap: space.sm },
  topBar: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: 4 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ui.mint,
  },
  topBarCopy: { flex: 1, gap: 2 },
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: colors.ink },
  sub: { fontSize: typography.caption.fontSize, color: colors.inkMuted, fontWeight: "600" },
  addChipHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: ui.deep,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  addChipText: { color: "#fff", fontWeight: "800", fontSize: typography.caption.fontSize },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: typography.body.fontSize, color: colors.ink, paddingVertical: 8 },
  list: { paddingBottom: 40, gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  cardActive: { borderColor: ui.deep, backgroundColor: ui.mint },
  cardMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: ui.mint,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: { flex: 1, gap: 2 },
  cardTitle: { fontSize: typography.bodyStrong.fontSize, fontWeight: "800", color: colors.ink },
  cardMeta: { fontSize: typography.caption.fontSize, color: colors.inkMuted, fontWeight: "600" },
  passwordLine: { fontSize: typography.caption.fontSize, color: ui.deep, fontWeight: "700" },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ui.mint,
  },
  emptySearch: {
    textAlign: "center",
    color: colors.inkMuted,
    marginTop: 24,
    fontWeight: "600",
  },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(2,44,34,0.45)",
    justifyContent: "center",
    padding: space.lg,
  },
  modalCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  modalTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: colors.ink },
  modalSub: { color: colors.inkMuted, fontWeight: "600", marginBottom: 4 },
  label: { fontWeight: "700", color: colors.ink, fontSize: typography.label.fontSize },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    fontWeight: "600",
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  error: { color: colors.danger, fontWeight: "600" },
});
