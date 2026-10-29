import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  assignCatalogue,
  cloneCatalogue,
  farmCopiesOf,
  getCatalogue,
  getCatalogueAssignment,
  listCatalogues,
  type CatalogueSummary,
} from "../../../src/api/catalogues";
import { describeApiError } from "../../../src/api/client";
import { BrandLogo } from "../../../src/components/brand/BrandLogo";
import { AppDialog } from "../../../src/components/ui/AppDialog";
import { EmptyState } from "../../../src/components/ui/EmptyState";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  catalogueAgeRangeLabel,
  catalogueListMetaLine,
} from "../../../src/features/catalogues/catalogueListHelpers";
import { media } from "../../../src/theme/media";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { safeBack } from "../../../src/navigation/safeBack";
import { toast } from "../../../src/ui/toast/toastStore";

type TabKey = "all" | "farm" | "platform";
type ConfirmKind = "default" | "clone";

export default function CataloguesScreen() {
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "schedule.view");
  const canManage = hasPermission(user, ownerAccountId, "schedule.manage");
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; cat: CatalogueSummary } | null>(null);

  const catalogues = useQuery({
    queryKey: ["catalogues", ownerAccountId],
    queryFn: () => listCatalogues(),
    enabled: Boolean(ownerAccountId) && canView,
  });
  const assignment = useQuery({
    queryKey: ["catalogue-assignment", ownerAccountId],
    queryFn: () => getCatalogueAssignment(),
    enabled: Boolean(ownerAccountId) && canView,
  });

  const list = catalogues.data ?? [];
  const detailQueries = useQueries({
    queries: list.map((c) => ({
      queryKey: ["catalogue", c.id],
      queryFn: () => getCatalogue(c.id),
      enabled: Boolean(ownerAccountId) && canView && list.length > 0,
      staleTime: 60_000,
    })),
  });

  const ageById = useMemo(() => {
    const map = new Map<string, string | null>();
    detailQueries.forEach((q, i) => {
      const id = list[i]?.id;
      if (!id) return;
      if (q.data) map.set(id, catalogueAgeRangeLabel(q.data.items));
    });
    return map;
  }, [detailQueries, list]);

  useFocusEffect(
    useCallback(() => {
      if (canView) {
        void catalogues.refetch();
        void assignment.refetch();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canView, ownerAccountId]),
  );

  const filtered = useMemo(() => {
    if (tab === "farm") return list.filter((c) => !c.is_platform);
    if (tab === "platform") return list.filter((c) => c.is_platform);
    return list;
  }, [list, tab]);

  if (!canView) return <Redirect href="/(app)/settings" />;

  const defaultId = assignment.data?.catalogue_id ?? null;

  const onSetDefault = (cat: CatalogueSummary) => {
    if (!canManage) return;
    setConfirm({ kind: "default", cat });
  };

  const onClone = (cat: CatalogueSummary) => {
    if (!canManage) return;
    const copies = farmCopiesOf(cat.id, list);
    if (copies.length === 1) {
      Alert.alert(cat.name, "A farm copy of this schedule already exists.", [
        {
          text: "Open existing copy",
          onPress: () => router.push(`/(app)/catalogues/${copies[0].id}`),
        },
        { text: "Clone another copy", onPress: () => setConfirm({ kind: "clone", cat }) },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    if (copies.length > 1) {
      Alert.alert(cat.name, "Multiple farm copies already exist.", [
        {
          text: "Open first copy",
          onPress: () => router.push(`/(app)/catalogues/${copies[0].id}`),
        },
        { text: "Clone another copy", onPress: () => setConfirm({ kind: "clone", cat }) },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    setConfirm({ kind: "clone", cat });
  };

  const runConfirm = async () => {
    if (!confirm || busyId) return;
    const { kind, cat } = confirm;
    setBusyId(cat.id);
    try {
      if (kind === "default") {
        await assignCatalogue({ catalogue_id: cat.id, apply_scope: "all_active" });
        await qc.invalidateQueries({ queryKey: ["catalogue-assignment", ownerAccountId] });
        await qc.invalidateQueries({ queryKey: ["vaccination"] });
        setConfirm(null);
        toast.success("Default schedule set");
      } else {
        const cloned = await cloneCatalogue(cat.id);
        await qc.invalidateQueries({ queryKey: ["catalogues", ownerAccountId] });
        setConfirm(null);
        toast.success("Catalogue cloned");
        router.push(`/(app)/catalogues/${cloned.id}`);
      }
    } catch (e) {
      setConfirm(null);
      toast.error(describeApiError(e, kind === "default" ? "assign catalogue" : "clone catalogue"));
    } finally {
      setBusyId(null);
    }
  };

  const onCardMenu = (cat: CatalogueSummary) => {
    if (!canManage) {
      router.push(`/(app)/catalogues/${cat.id}`);
      return;
    }
    const isDefault = defaultId === cat.id;
    const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [
      { text: "Open", onPress: () => router.push(`/(app)/catalogues/${cat.id}`) },
    ];
    if (!isDefault) {
      buttons.push({ text: "Set as default", onPress: () => onSetDefault(cat) });
    }
    if (cat.is_platform) {
      buttons.push({ text: "Clone to My Farm", onPress: () => onClone(cat) });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(cat.name, undefined, buttons);
  };

  const onAdd = () => {
    if (!canManage) return;
    router.push("/(app)/catalogues/create");
  };

  const refreshing = catalogues.isRefetching && !catalogues.isLoading;
  const error = catalogues.error
    ? describeApiError(catalogues.error, "load catalogues")
    : null;

  const renderCard = (cat: CatalogueSummary, index: number) => {
    const isDefault = defaultId === cat.id;
    const borderColor = ui.iconPalette[index % ui.iconPalette.length];
    const softBg = ui.iconSoftPalette[index % ui.iconSoftPalette.length];
    const ageRange = ageById.get(cat.id) ?? null;
    const meta = catalogueListMetaLine(cat.item_count, ageRange);
    return (
      <Pressable
        style={styles.card}
        onPress={() => router.push(`/(app)/catalogues/${cat.id}`)}
        onLongPress={() => onCardMenu(cat)}
        accessibilityRole="button"
        accessibilityLabel={`${cat.name}. ${meta}${isDefault ? ". Default" : ""}`}
      >
        <View style={[styles.iconBox, { backgroundColor: softBg, borderColor }]}>
          <BrandLogo size={28} accessibilityLabel="PoultryTrack" />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {cat.name}
          </Text>
          {isDefault ? (
            <View style={styles.defaultBadge}>
              <Text style={styles.defaultBadgeText}>Default</Text>
            </View>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={ui.mutedSoft} style={styles.chevron} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack()} hitSlop={12} accessibilityLabel="Back" style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={ui.brand} />
        </Pressable>
        <Text style={styles.title}>Catalogues</Text>
        {canManage ? (
          <Pressable style={styles.addBtn} onPress={onAdd} accessibilityLabel="Add catalogue">
            <Ionicons name="add" size={16} color={ui.white} />
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        ) : (
          <View style={styles.addPlaceholder} />
        )}
      </View>

      <View style={styles.tabs}>
        {(
          [
            ["all", "All"],
            ["farm", "My Catalogues"],
            ["platform", "Platform"],
          ] as const
        ).map(([key, label]) => {
          const on = tab === key;
          return (
            <Pressable
              key={key}
              style={[styles.tab, on && styles.tabOn]}
              onPress={() => setTab(key)}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {catalogues.isLoading && !catalogues.data ? (
        <View style={styles.center}>
          <HenLoader label="Loading catalogues…" />
        </View>
      ) : error ? (
        <View style={styles.centerPad}>
          <Text style={styles.errorTitle}>Could not load catalogues</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void catalogues.refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void catalogues.refetch()} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              title="No catalogues"
              body="Ask an admin to assign a platform catalogue or create a farm catalogue."
              imageUri={media.farmMorning}
            />
          }
          renderItem={({ item, index }) => renderCard(item, index)}
        />
      )}

      <AppDialog
        visible={Boolean(confirm)}
        title={confirm?.kind === "clone" ? "Clone catalogue?" : "Set farm default?"}
        description={
          confirm?.kind === "clone"
            ? `Create an editable farm copy of “${confirm.cat.name}”.`
            : confirm
              ? `New flocks will use “${confirm.cat.name}” unless a flock override is set. Existing completed vaccinations are kept.`
              : undefined
        }
        tone="neutral"
        dismissible={!busyId}
        onDismiss={() => {
          if (!busyId) setConfirm(null);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: Boolean(busyId),
          onPress: () => setConfirm(null),
        }}
        primary={{
          label: confirm?.kind === "clone" ? "Clone" : "Set default",
          variant: "primary",
          loading: Boolean(busyId),
          onPress: () => void runConfirm(),
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: ui.horizontal,
    paddingTop: 6,
    paddingBottom: 2,
    // Keep Add / badge clear of Expo Go floating gear overlay.
    paddingRight: 52,
  },
  backBtn: { paddingVertical: 4, paddingRight: 2 },
  title: { flex: 1, fontSize: 20, fontWeight: "800", color: ui.ink },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: ui.brand,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addBtnText: { color: ui.white, fontWeight: "800", fontSize: 13 },
  addPlaceholder: { width: 56 },
  tabs: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: ui.horizontal,
    paddingTop: 8,
    paddingBottom: 6,
  },
  tab: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#EEF2F0",
  },
  tabOn: { backgroundColor: ui.brand },
  tabText: { fontSize: 12, fontWeight: "700", color: ui.muted },
  tabTextOn: { color: ui.white },
  list: {
    paddingLeft: ui.horizontal,
    // Extra right inset so card chevrons / Default badge clear Expo Go’s floating gear.
    paddingRight: Math.max(ui.horizontal, 48),
    paddingTop: 4,
    paddingBottom: 28,
    gap: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: ui.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  cardBody: { flex: 1, gap: 3, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: ui.ink, paddingRight: 4 },
  defaultBadge: {
    alignSelf: "flex-start",
    backgroundColor: ui.brandSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  defaultBadgeText: { fontSize: 10, fontWeight: "800", color: ui.brand },
  meta: { fontSize: 12, fontWeight: "600", color: ui.muted },
  chevron: { marginLeft: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { flex: 1, padding: 20, justifyContent: "center", gap: 8 },
  errorTitle: { fontSize: 17, fontWeight: "800", color: ui.ink },
  errorBody: { fontSize: 14, color: ui.muted, lineHeight: 20 },
  retry: {
    alignSelf: "flex-start",
    backgroundColor: ui.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: { color: ui.white, fontWeight: "800" },
});
