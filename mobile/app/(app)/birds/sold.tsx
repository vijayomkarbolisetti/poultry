import Ionicons from "@expo/vector-icons/Ionicons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { listSoldBirds, type SoldBirdHit } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { BirdListExportSheet } from "../../../src/components/birds/BirdListExportSheet";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { ImmersiveHeroHeader } from "../../../src/components/ui/ImmersiveHeroHeader";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { useResetSearchOnContextChange } from "../../../src/features/search/searchLifecycle";
import { useTransientSearchQuery } from "../../../src/features/search/useTransientSearchQuery";
import { formatDisplayDate } from "../../../src/components/ui/selectUtils";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { birdIcons, heroArt } from "../../../src/theme/media";
import { typography } from "../../../src/theme/tokens";


type PeriodKey = "all" | "month" | "quarter" | "custom";

function periodRange(key: PeriodKey): { from: string | null; to: string | null } {
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (key === "all" || key === "custom") return { from: null, to: null };
  if (key === "month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: iso(from), to: iso(today) };
  }
  const from = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  return { from: iso(from), to: iso(today) };
}

export default function SoldBirdsScreen() {
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const { query, debouncedQuery, setQuery, clearSearch } = useTransientSearchQuery();
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [exportOpen, setExportOpen] = useState(false);

  useResetSearchOnContextChange(ownerAccountId, clearSearch);

  const range = useMemo(() => periodRange(period), [period]);

  const list = useInfiniteQuery({
    queryKey: ["sold-birds", ownerAccountId, debouncedQuery, period, range.from, range.to],
    enabled: canView,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listSoldBirds({
        q: debouncedQuery || undefined,
        soldFrom: range.from,
        soldTo: range.to,
        limit: 20,
        offset: pageParam,
      }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view sold birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack("/(app)/settings")} />
      </Screen>
    );
  }

  return (
    <Screen edges={["left", "right", "bottom"]} style={{ backgroundColor: birdUi.bg, padding: 0 }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={() => void list.refetch()}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View>
            <ImmersiveHeroHeader
              source={heroArt.home}
              curveFill={birdUi.bg}
              accessibilityLabel="Sold birds farm illustration"
              contentStyle={styles.heroCopy}
            >
              <View style={styles.heroTopRow}>
                <Pressable
                  onPress={() => safeBack("/(app)/settings")}
                  style={styles.backBtn}
                  accessibilityLabel="Back"
                >
                  <Ionicons name="arrow-back" size={22} color={birdUi.text} />
                </Pressable>
                <Pressable
                  onPress={() => setExportOpen(true)}
                  style={styles.downloadBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Download sold birds export"
                >
                  <Ionicons name="download-outline" size={20} color={birdUi.primary} />
                </Pressable>
              </View>
              <View style={styles.heroTitles}>
                <Text style={styles.title}>Sold Birds</Text>
                <Text style={styles.subtitle}>Birds that have been sold</Text>
              </View>
            </ImmersiveHeroHeader>

            <View style={styles.headerBody}>
              <View style={styles.countCard} accessibilityLabel={`${total} sold birds`}>
                <View style={[styles.countIcon, { backgroundColor: birdUi.orangePale }]}>
                  <Ionicons name="pricetag-outline" size={18} color={birdUi.orange} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.countValue}>{total}</Text>
                  <Text style={styles.countLabel}>
                    {total === 1 ? "sold bird" : "sold birds"}
                    {period !== "all" && period !== "custom" ? " in this period" : ""}
                  </Text>
                </View>
              </View>

              <View style={styles.searchRow}>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={18} color={birdUi.muted} />
                  <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search by Band no or id"
                    placeholderTextColor={birdUi.muted}
                    accessibilityLabel="Search sold birds"
                  />
                </View>
              </View>

              <View style={styles.chips}>
                {(
                  [
                    ["all", "All"],
                    ["month", "This Month"],
                    ["quarter", "Last 3 Months"],
                  ] as const
                ).map(([key, label]) => (
                  <Pressable
                    key={key}
                    onPress={() => setPeriod(key)}
                    style={[styles.chip, period === key && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: period === key }}
                  >
                    <Text style={[styles.chipText, period === key && styles.chipTextOn]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          list.isLoading ? (
            <HenLoader label="Loading sold birds…" />
          ) : list.isError ? (
            <View style={styles.emptyBox}>
              <Text style={styles.error}>{describeApiError(list.error, "load sold birds")}</Text>
              <Button label="Retry" onPress={() => void list.refetch()} />
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No sold birds yet</Text>
              <Text style={styles.emptyBody}>
                When you mark birds as sold from a shed, they appear here with buyer details.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <SoldCard item={item} />}
      />
      <BirdListExportSheet
        visible={exportOpen}
        kind="sold"
        onClose={() => setExportOpen(false)}
      />
    </Screen>
  );
}

function SoldCard({ item }: { item: SoldBirdHit }) {
  const title = item.band_id ?? item.display_code ?? item.id.slice(0, 8);
  const onCall = () => {
    if (!item.buyer_mobile) return;
    void Linking.openURL(`tel:${item.buyer_mobile}`);
  };

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: "/(app)/birds/[id]", params: { id: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open profile for ${title}`}
    >
      <View style={styles.cardLeft}>
        <View style={styles.avatar}>
          <Image source={birdIcons.bird} style={styles.avatarImg} resizeMode="cover" />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.band}>{title}</Text>
          {item.breed ? (
            <View style={styles.breedPill}>
              <Text style={styles.breedText}>{item.breed}</Text>
            </View>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            Batch {item.batch_code}
          </Text>
          <View style={styles.soldPill}>
            <Ionicons name="pricetag" size={12} color="#fff" />
            <Text style={styles.soldPillText}>Sold</Text>
          </View>
        </View>
      </View>

      <View style={styles.cardMid}>
        <InfoRow icon="calendar-outline" label="Sold on" value={formatDisplayDate(item.sold_on) || item.sold_on} />
        <InfoRow icon="person-outline" label="Buyer" value={item.buyer_name?.trim() || "—"} />
        <InfoRow icon="call-outline" label="Mobile" value={item.buyer_mobile?.trim() || "—"} />
      </View>

      <View style={styles.cardRight}>
        {item.buyer_mobile ? (
          <Pressable
            onPress={onCall}
            style={styles.callBtn}
            accessibilityLabel={`Call ${item.buyer_name ?? "buyer"}`}
          >
            <Ionicons name="call" size={18} color="#fff" />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
      </View>
    </Pressable>
  );
}

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color={birdUi.muted} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 28, gap: 10 },
  heroCopy: { flexGrow: 1, gap: 10, justifyContent: "space-between" },
  heroTitles: { gap: 2, paddingBottom: 2 },
  headerBody: {
    paddingHorizontal: birdUi.horizontal,
    gap: 8,
    marginBottom: 8,
    marginTop: -4,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  downloadBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.text, letterSpacing: -0.3 },
  subtitle: { fontSize: typography.sectionTitle.fontSize, color: birdUi.muted },
  countCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  countIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  countValue: {
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.text,
    lineHeight: 26,
  },
  countLabel: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted },
  searchRow: { marginTop: 4 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: typography.body.fontSize, color: birdUi.text, fontWeight: "600", paddingVertical: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: birdUi.white,
    borderWidth: 1,
    borderColor: birdUi.border,
  },
  chipOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  chipText: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.text },
  chipTextOn: { color: "#fff" },
  emptyBox: { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.text },
  emptyBody: { fontSize: typography.label.fontSize, color: birdUi.muted, textAlign: "center", lineHeight: 20 },
  error: { color: birdUi.error, fontWeight: "600", textAlign: "center" },
  card: {
    marginHorizontal: birdUi.horizontal,
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  cardLeft: { flex: 1.1, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  band: { fontSize: typography.button.fontSize, fontWeight: "800", color: birdUi.text },
  breedPill: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF1F0",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  breedText: { fontSize: typography.overline.fontSize, fontWeight: "700", color: birdUi.muted },
  meta: { fontSize: typography.caption.fontSize, color: birdUi.muted },
  soldPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: birdUi.error,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  soldPillText: { color: "#fff", fontSize: typography.overline.fontSize, fontWeight: "800" },
  cardMid: { flex: 1.2, gap: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoLabel: { fontSize: typography.overline.fontSize, color: birdUi.muted, width: 52 },
  infoValue: { flex: 1, fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.text },
  cardRight: { alignItems: "center", gap: 10 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
