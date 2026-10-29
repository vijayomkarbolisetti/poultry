import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getCatalogue, getCatalogueAssignment, type CatalogueItem } from "../../../src/api/catalogues";
import { describeApiError } from "../../../src/api/client";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  catalogueHasQaNoise,
  dayBadgeParts,
  scheduleDiseaseLine,
  scheduleDoseRouteLine,
  scheduleTypeLine,
  sortScheduleItems,
} from "../../../src/features/catalogues/catalogueDetailHelpers";
import { catalogueAgeRangeLabel } from "../../../src/features/catalogues/catalogueListHelpers";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { safeBack } from "../../../src/navigation/safeBack";

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
  const [tab, setTab] = useState<TabKey>("schedule");

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

  const cat = query.data;
  const editable = Boolean(cat && !cat.is_platform && canManage);
  const isDefault = Boolean(cat && assignment.data?.catalogue_id === cat.id);

  const dayRange = useMemo(
    () => (cat?.items ? catalogueAgeRangeLabel(cat.items) : null),
    [cat],
  );

  const scheduleItems = useMemo(
    () => (cat?.items ? sortScheduleItems(cat.items) : []),
    [cat],
  );

  const showQaNote = useMemo(
    () => (cat ? catalogueHasQaNoise(cat.items, cat.description) : false),
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

  const onMenu = () => {
    if (!cat || !editable) return;
    const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [
      { text: "Add vaccine", onPress: openAddVaccine },
    ];
    const first = scheduleItems[0];
    if (first?.id) {
      buttons.push({
        text: "Edit first vaccine",
        onPress: () =>
          router.push({
            pathname: "/(app)/catalogues/item-edit",
            params: { catalogueId: cat.id, itemId: first.id },
          }),
      });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(cat.name, "Manage vaccines in this catalogue.", buttons);
  };

  const openItem = (item: CatalogueItem) => {
    if (!editable || !cat || !item.id) return;
    router.push({
      pathname: "/(app)/catalogues/item-edit",
      params: { catalogueId: cat.id, itemId: item.id },
    });
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
            <Text style={styles.meta}>
              {cat.items.length} vaccine{cat.items.length === 1 ? "" : "s"}
              {dayRange ? ` • ${dayRange}` : ""}
            </Text>
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
                  {showQaNote ? (
                    <Text style={styles.qaNote}>
                      Some entries are illustrative templates — not veterinarian-approved guidance.
                    </Text>
                  ) : null}
                </View>
              )
            ) : (
              <View style={styles.detailsCard}>
                <DetailRow label="Type" value={cat.is_platform ? "Platform (read-only)" : "Farm catalogue"} />
                <DetailRow label="Version" value={`v${cat.version}`} />
                <DetailRow label="Status" value={cat.status} />
                <DetailRow
                  label="Schedule"
                  value={`${cat.items.length} vaccine${cat.items.length === 1 ? "" : "s"}${
                    dayRange ? ` • ${dayRange}` : ""
                  }`}
                />
                <DetailRow
                  label="Description"
                  value={cat.description?.trim() || "Not specified"}
                />
                {cat.is_platform && canManage ? (
                  <Text style={styles.hint}>
                    Clone this catalogue from the list to edit product details on a farm copy.
                  </Text>
                ) : null}
              </View>
            )}
          </ScrollView>
        </>
      ) : null}
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
  meta: { fontSize: 12, fontWeight: "600", color: ui.muted },
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
  qaNote: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "500",
    color: ui.mutedSoft,
    lineHeight: 15,
  },
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
  hint: {
    marginTop: 2,
    fontSize: 11,
    color: ui.muted,
    fontWeight: "500",
    lineHeight: 15,
  },
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
});
