import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  cloneCatalogue,
  farmCopiesOf,
  getCatalogue,
  getCatalogueAssignment,
  guardsFromPreview,
  isStalePreviewError,
  listCatalogues,
  previewCatalogueUpdate,
  updateCatalogue,
  type CatalogueItem,
  type CataloguePreviewUpdate,
  type CatalogueSummary,
} from "../../../src/api/catalogues";
import { describeApiError } from "../../../src/api/client";
import { AppDialog } from "../../../src/components/ui/AppDialog";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  dayBadgeParts,
  scheduleDiseaseLine,
  scheduleDoseRouteLine,
  scheduleTypeLine,
  sortScheduleItems,
} from "../../../src/features/catalogues/catalogueDetailHelpers";
import { formatCataloguePreviewImpact } from "../../../src/features/catalogues/catalogueItemEditHelpers";
import { catalogueAgeRangeLabel } from "../../../src/features/catalogues/catalogueListHelpers";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { safeBack } from "../../../src/navigation/safeBack";
import { toast } from "../../../src/ui/toast/toastStore";

type TabKey = "schedule" | "details";

function dayTone(index: number) {
  const color = ui.dayPalette[index % ui.dayPalette.length];
  return { bg: `${color}22`, fg: color };
}

export default function CatalogueDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "schedule.view");
  const canManage = hasPermission(user, ownerAccountId, "schedule.manage");
  const qc = useQueryClient();
  const busy = useRef(false);
  const [tab, setTab] = useState<TabKey>("schedule");
  const [cloneBusy, setCloneBusy] = useState(false);
  const [showCloneConfirm, setShowCloneConfirm] = useState(false);
  const [detailsEdit, setDetailsEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [removePending, setRemovePending] = useState<{
    item: CatalogueItem;
    preview: CataloguePreviewUpdate;
  } | null>(null);
  const [removeSaving, setRemoveSaving] = useState(false);

  const query = useQuery({
    queryKey: ["catalogue", id],
    queryFn: () => getCatalogue(id!),
    enabled: Boolean(id) && canView,
  });
  const assignment = useQuery({
    queryKey: ["catalogue-assignment", ownerAccountId],
    queryFn: () => getCatalogueAssignment(),
    enabled: canView,
  });
  const catalogues = useQuery({
    queryKey: ["catalogues", ownerAccountId],
    queryFn: () => listCatalogues(),
    enabled: Boolean(ownerAccountId) && canView,
  });

  const cat = query.data;
  const editable = Boolean(cat && !cat.is_platform && canManage);
  const isDefault = Boolean(cat && assignment.data?.catalogue_id === cat.id);
  const farmCopies: CatalogueSummary[] = useMemo(() => {
    if (!cat?.is_platform || !catalogues.data) return [];
    return farmCopiesOf(cat.id, catalogues.data);
  }, [cat, catalogues.data]);

  const dayRange = useMemo(
    () => (cat?.items ? catalogueAgeRangeLabel(cat.items) : null),
    [cat],
  );

  const scheduleItems = useMemo(
    () => (cat?.items ? sortScheduleItems(cat.items) : []),
    [cat],
  );

  if (!canView) return <Redirect href="/(app)/settings" />;

  const openAddVaccine = () => {
    if (!cat || !editable) return;
    router.push({
      pathname: "/(app)/catalogues/item-edit",
      params: { catalogueId: cat.id },
    });
  };

  const openItem = (item: CatalogueItem) => {
    if (!editable || !cat || !item.id) return;
    router.push({
      pathname: "/(app)/catalogues/item-edit",
      params: { catalogueId: cat.id, itemId: item.id },
    });
  };

  const openExistingCopy = (copy: CatalogueSummary) => {
    router.replace(`/(app)/catalogues/${copy.id}`);
  };

  const runClone = async () => {
    if (!cat || !canManage || busy.current) return;
    busy.current = true;
    setCloneBusy(true);
    try {
      const cloned = await cloneCatalogue(cat.id);
      await qc.invalidateQueries({ queryKey: ["catalogues", ownerAccountId] });
      setShowCloneConfirm(false);
      toast.success("Catalogue cloned");
      router.replace(`/(app)/catalogues/${cloned.id}`);
    } catch (e) {
      toast.error(describeApiError(e, "clone catalogue"));
    } finally {
      busy.current = false;
      setCloneBusy(false);
    }
  };

  const onPlatformAction = () => {
    if (!cat?.is_platform || !canManage) return;
    if (farmCopies.length === 1) {
      Alert.alert(cat.name, "A farm copy of this schedule already exists.", [
        { text: "Open existing copy", onPress: () => openExistingCopy(farmCopies[0]) },
        { text: "Clone another copy", onPress: () => setShowCloneConfirm(true) },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    if (farmCopies.length > 1) {
      Alert.alert(
        cat.name,
        "Multiple farm copies exist. Open one from My Catalogues, or clone another copy.",
        [
          {
            text: "Open first copy",
            onPress: () => openExistingCopy(farmCopies[0]),
          },
          { text: "Clone another copy", onPress: () => setShowCloneConfirm(true) },
          { text: "Cancel", style: "cancel" },
        ],
      );
      return;
    }
    setShowCloneConfirm(true);
  };

  const startDetailsEdit = () => {
    if (!cat || !editable) return;
    setEditName(cat.name);
    setEditDescription(cat.description ?? "");
    setDetailsEdit(true);
  };

  const saveDetails = async () => {
    if (!cat || !editable || detailsSaving || busy.current) return;
    const name = editName.trim();
    if (!name) {
      toast.error("Enter a schedule name.");
      return;
    }
    busy.current = true;
    setDetailsSaving(true);
    try {
      await updateCatalogue(cat.id, {
        name,
        description: editDescription.trim() || null,
      });
      await qc.invalidateQueries({ queryKey: ["catalogue", cat.id] });
      await qc.invalidateQueries({ queryKey: ["catalogues", ownerAccountId] });
      setDetailsEdit(false);
      toast.success("Schedule details updated");
    } catch (e) {
      toast.error(describeApiError(e, "update schedule details"));
    } finally {
      busy.current = false;
      setDetailsSaving(false);
    }
  };

  const startRemoveItem = async (item: CatalogueItem) => {
    if (!cat || !editable || !item.id || busy.current) return;
    busy.current = true;
    try {
      const preview = await previewCatalogueUpdate(cat.id, {
        apply_scope: "new_flocks",
        remove_item_ids: [item.id],
      });
      setRemovePending({ item, preview });
    } catch (e) {
      toast.error(describeApiError(e, "preview removal"));
    } finally {
      busy.current = false;
    }
  };

  const confirmRemoveItem = async () => {
    if (!cat || !removePending || removeSaving || busy.current) return;
    busy.current = true;
    setRemoveSaving(true);
    try {
      const apply = async (preview: CataloguePreviewUpdate) => {
        await updateCatalogue(cat.id, {
          remove_item_ids: [removePending.item.id!],
          apply_scope: "new_flocks",
          confirm_change: true,
          ...guardsFromPreview(preview),
        });
      };
      try {
        await apply(removePending.preview);
      } catch (e) {
        if (!isStalePreviewError(e)) throw e;
        const refreshed = await previewCatalogueUpdate(cat.id, {
          apply_scope: "new_flocks",
          remove_item_ids: [removePending.item.id!],
        });
        setRemovePending({ ...removePending, preview: refreshed });
        toast.error("Schedule changed — review the updated impact and confirm again.");
        busy.current = false;
        setRemoveSaving(false);
        return;
      }
      setRemovePending(null);
      await qc.invalidateQueries({ queryKey: ["catalogue", cat.id] });
      await qc.invalidateQueries({ queryKey: ["catalogues", ownerAccountId] });
      toast.success("Vaccine removed");
    } catch (e) {
      toast.error(describeApiError(e, "remove vaccine"));
    } finally {
      busy.current = false;
      setRemoveSaving(false);
    }
  };

  const onMenu = () => {
    if (!cat || !editable) return;
    const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [
      { text: "Add vaccine", onPress: openAddVaccine },
      { text: "Edit name & description", onPress: startDetailsEdit },
    ];
    const first = scheduleItems[0];
    if (first?.id) {
      buttons.push({
        text: "Edit first vaccine",
        onPress: () => openItem(first),
      });
      buttons.push({
        text: "Remove first vaccine",
        style: "destructive",
        onPress: () => void startRemoveItem(first),
      });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(cat.name, "Manage this farm catalogue.", buttons);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={ui.brand} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={2}>
          {cat?.name ?? "Catalogue"}
        </Text>
        {editable ? (
          <Pressable onPress={onMenu} hitSlop={12} accessibilityLabel="Catalogue menu" style={styles.menuBtn}>
            <Ionicons name="ellipsis-vertical" size={18} color={ui.ink} />
          </Pressable>
        ) : cat?.is_platform && canManage ? (
          <Pressable
            onPress={onPlatformAction}
            hitSlop={12}
            accessibilityLabel="Clone or open farm copy"
            style={styles.menuBtn}
          >
            <Ionicons name="copy-outline" size={18} color={ui.brand} />
          </Pressable>
        ) : (
          <View style={styles.menuSpacer} />
        )}
      </View>

      {query.isLoading && !cat ? (
        <View style={styles.center}>
          <HenLoader label="Loading…" />
        </View>
      ) : query.error ? (
        <View style={styles.centerPad}>
          <Text style={styles.error}>{describeApiError(query.error, "load catalogue")}</Text>
        </View>
      ) : cat ? (
        <>
          <View style={styles.subheader}>
            {isDefault ? (
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText}>Default</Text>
              </View>
            ) : null}
            {cat.is_platform ? (
              <View style={styles.platformBadge}>
                <Text style={styles.platformBadgeText}>Platform · read-only</Text>
              </View>
            ) : null}
            <Text style={styles.meta}>
              {cat.items.length} vaccine{cat.items.length === 1 ? "" : "s"}
              {dayRange ? ` • ${dayRange}` : ""}
            </Text>
            {cat.is_platform && canManage ? (
              <Pressable
                style={styles.cloneCta}
                onPress={onPlatformAction}
                accessibilityRole="button"
                accessibilityLabel={
                  farmCopies.length ? "Open existing copy or clone" : "Clone to my farm"
                }
              >
                <Text style={styles.cloneCtaText}>
                  {farmCopies.length ? "Open existing / Clone" : "Clone to My Farm"}
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.tabs}>
              {(
                [
                  ["schedule", "Vaccine Schedule"],
                  ["details", "Details"],
                ] as const
              ).map(([key, label]) => {
                const on = tab === key;
                return (
                  <Pressable key={key} style={styles.tabBtn} onPress={() => setTab(key)}>
                    <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
                    {on ? <View style={styles.tabUnderline} /> : <View style={styles.tabUnderlineOff} />}
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {tab === "schedule" ? (
              scheduleItems.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.muted}>No vaccines in this catalogue yet.</Text>
                  {editable ? (
                    <Pressable
                      style={styles.addVaccineBtn}
                      onPress={openAddVaccine}
                      accessibilityRole="button"
                      accessibilityLabel="Add vaccine"
                    >
                      <Text style={styles.addVaccineBtnText}>Add vaccine</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <View style={styles.scheduleList}>
                  {scheduleItems.map((item, index) => {
                    const tone = dayTone(index);
                    const badge = dayBadgeParts(item);
                    const disease = scheduleDiseaseLine(item);
                    const doseRoute = scheduleDoseRouteLine(item);
                    const typeLine = scheduleTypeLine(item);
                    const diseaseMissing = disease === "Not specified";
                    const doseMissing = doseRoute === "Not specified";
                    return (
                      <Pressable
                        key={item.id ?? `${item.name}-${index}`}
                        style={styles.scheduleRow}
                        disabled={!editable}
                        onPress={() => openItem(item)}
                        onLongPress={
                          editable && item.id
                            ? () =>
                                Alert.alert(item.name, undefined, [
                                  { text: "Edit", onPress: () => openItem(item) },
                                  {
                                    text: "Remove",
                                    style: "destructive",
                                    onPress: () => void startRemoveItem(item),
                                  },
                                  { text: "Cancel", style: "cancel" },
                                ])
                            : undefined
                        }
                        accessibilityRole={editable ? "button" : undefined}
                        accessibilityLabel={item.name}
                      >
                        <View style={[styles.dayBadge, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.dayCaption, { color: tone.fg }]}>{badge.caption}</Text>
                          <Text style={[styles.dayValue, { color: tone.fg }]} numberOfLines={1}>
                            {badge.value}
                          </Text>
                        </View>
                        <View style={styles.scheduleBody}>
                          <Text style={styles.scheduleTitle} numberOfLines={2}>
                            {item.name}
                          </Text>
                          <Text
                            style={[styles.scheduleMeta, diseaseMissing && styles.notSpecified]}
                            numberOfLines={1}
                          >
                            {disease}
                          </Text>
                          <Text
                            style={[styles.scheduleMeta, doseMissing && styles.notSpecified]}
                            numberOfLines={1}
                          >
                            {doseRoute}
                          </Text>
                          {typeLine ? (
                            <Text style={styles.scheduleType} numberOfLines={1}>
                              {typeLine}
                            </Text>
                          ) : null}
                        </View>
                        {editable ? (
                          <Ionicons name="chevron-forward" size={16} color={ui.mutedSoft} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              )
            ) : (
              <View style={styles.detailsCard}>
                <DetailRow label="Type" value={cat.is_platform ? "Platform" : "Farm catalogue"} />
                <DetailRow label="Version" value={`v${cat.version}`} />
                <DetailRow label="Status" value={cat.status} />
                <DetailRow
                  label="Schedule"
                  value={`${cat.items.length} vaccine${cat.items.length === 1 ? "" : "s"}${
                    dayRange ? ` • ${dayRange}` : ""
                  }`}
                />
                {cat.description?.trim() ? (
                  <DetailRow label="Description" value={cat.description.trim()} />
                ) : null}
                {editable ? (
                  <Pressable style={styles.editDetailsBtn} onPress={startDetailsEdit}>
                    <Text style={styles.editDetailsBtnText}>Edit name & description</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </ScrollView>
        </>
      ) : null}

      <AppDialog
        visible={showCloneConfirm}
        title="Clone to My Farm?"
        description={`Create an editable farm copy of “${cat?.name ?? "this schedule"}”. The platform schedule stays read-only.`}
        tone="neutral"
        dismissible={!cloneBusy}
        onDismiss={() => {
          if (!cloneBusy) setShowCloneConfirm(false);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: cloneBusy,
          onPress: () => setShowCloneConfirm(false),
        }}
        primary={{
          label: "Clone",
          variant: "primary",
          loading: cloneBusy,
          onPress: () => void runClone(),
        }}
      />

      <AppDialog
        visible={detailsEdit}
        title="Edit schedule details"
        description="Name and description only. Vaccine entries are unchanged."
        tone="neutral"
        dismissible={!detailsSaving}
        onDismiss={() => {
          if (!detailsSaving) setDetailsEdit(false);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: detailsSaving,
          onPress: () => setDetailsEdit(false),
        }}
        primary={{
          label: "Save",
          variant: "primary",
          loading: detailsSaving,
          onPress: () => void saveDetails(),
        }}
      >
        <View style={styles.dialogFields}>
          <Text style={styles.dialogLabel}>Name</Text>
          <TextInput
            style={styles.dialogInput}
            value={editName}
            onChangeText={setEditName}
            placeholder="Schedule name"
            placeholderTextColor="#9AABA4"
          />
          <Text style={styles.dialogLabel}>Description</Text>
          <TextInput
            style={[styles.dialogInput, styles.dialogInputMulti]}
            value={editDescription}
            onChangeText={setEditDescription}
            placeholder="Optional"
            placeholderTextColor="#9AABA4"
            multiline
          />
        </View>
      </AppDialog>

      <AppDialog
        visible={Boolean(removePending)}
        title="Remove vaccine?"
        description={
          removePending
            ? `${removePending.item.name}\n\n${formatCataloguePreviewImpact(removePending.preview)}`
            : undefined
        }
        tone="warning"
        dismissible={!removeSaving}
        onDismiss={() => {
          if (!removeSaving) setRemovePending(null);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: removeSaving,
          onPress: () => setRemovePending(null),
        }}
        primary={{
          label: "Remove",
          variant: "destructive",
          loading: removeSaving,
          onPress: () => void confirmRemoveItem(),
        }}
      />
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: ui.horizontal,
    paddingRight: 48,
    paddingTop: 2,
    paddingBottom: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    color: ui.ink,
    lineHeight: 22,
  },
  menuBtn: { padding: 4 },
  menuSpacer: { width: 26 },
  subheader: {
    paddingLeft: ui.horizontal,
    paddingRight: Math.max(ui.horizontal, 52),
    paddingTop: 0,
    gap: 3,
  },
  defaultBadge: {
    alignSelf: "flex-start",
    backgroundColor: ui.brandSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  defaultBadgeText: { fontSize: 10, fontWeight: "800", color: ui.brand },
  platformBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF2F0",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  platformBadgeText: { fontSize: 10, fontWeight: "800", color: ui.muted },
  meta: { fontSize: 12, fontWeight: "600", color: ui.muted },
  cloneCta: {
    alignSelf: "flex-start",
    marginTop: 4,
    backgroundColor: ui.brand,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cloneCtaText: { color: ui.white, fontWeight: "800", fontSize: 13 },
  tabs: { flexDirection: "row", gap: 18, marginTop: 2 },
  tabBtn: { paddingBottom: 2 },
  tabText: { fontSize: 14, fontWeight: "700", color: ui.muted },
  tabTextOn: { color: ui.brand },
  tabUnderline: { marginTop: 3, height: 3, borderRadius: 2, backgroundColor: ui.brand },
  tabUnderlineOff: { marginTop: 3, height: 3 },
  scroll: { flex: 1 },
  content: {
    paddingLeft: ui.horizontal,
    paddingRight: Math.max(ui.horizontal, 52),
    paddingTop: 6,
    paddingBottom: 36,
  },
  scheduleList: { gap: 5 },
  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: ui.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  dayBadge: {
    width: 40,
    minHeight: 40,
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCaption: { fontSize: 9, fontWeight: "700", letterSpacing: 0.2 },
  dayValue: { fontSize: 15, fontWeight: "800", marginTop: 0 },
  scheduleBody: { flex: 1, gap: 1, minWidth: 0 },
  scheduleTitle: { fontSize: 14, fontWeight: "800", color: ui.ink },
  scheduleMeta: { fontSize: 12, fontWeight: "600", color: ui.muted },
  scheduleType: { fontSize: 11, fontWeight: "500", color: ui.mutedSoft },
  notSpecified: { fontWeight: "500", color: ui.mutedSoft, fontStyle: "italic" },
  detailsCard: {
    backgroundColor: ui.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  detailLabel: {
    width: 92,
    fontSize: 12,
    fontWeight: "700",
    color: ui.muted,
    paddingTop: 1,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: ui.ink,
    lineHeight: 19,
  },
  editDetailsBtn: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 6,
  },
  editDetailsBtnText: { color: ui.brand, fontWeight: "800", fontSize: 13 },
  muted: { color: ui.muted, fontWeight: "600" },
  emptyBox: { gap: 12, paddingTop: 8 },
  addVaccineBtn: {
    alignSelf: "flex-start",
    backgroundColor: ui.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addVaccineBtnText: { color: ui.white, fontWeight: "800", fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { padding: 20 },
  error: { color: ui.muted, fontSize: 14 },
  dialogFields: { gap: 8, marginTop: 8 },
  dialogLabel: { fontSize: 12, fontWeight: "700", color: ui.muted },
  dialogInput: {
    backgroundColor: "#F8FAF9",
    borderWidth: 1,
    borderColor: ui.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: ui.ink,
    fontWeight: "600",
  },
  dialogInputMulti: { minHeight: 72, textAlignVertical: "top" },
});
