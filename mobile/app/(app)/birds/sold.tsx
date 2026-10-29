import Ionicons from "@expo/vector-icons/Ionicons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { listSoldBirds, type SoldBirdHit } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { ImmersiveHeroHeader } from "../../../src/components/ui/ImmersiveHeroHeader";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { formatDisplayDate } from "../../../src/components/ui/selectUtils";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { heroArt } from "../../../src/theme/media";

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
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q]);

  const range = useMemo(() => periodRange(period), [period]);

  const list = useInfiniteQuery({
    queryKey: ["sold-birds", ownerAccountId, debouncedQ, period, range.from, range.to],
    enabled: canView,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      listSoldBirds({
        q: debouncedQ || undefined,
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
              minHeight={140}
              accessibilityLabel="Sold birds farm illustration"
              contentStyle={styles.heroCopy}
            >
              <Pressable
                onPress={() => safeBack("/(app)/settings")}
                style={styles.backBtn}
                accessibilityLabel="Back"
              >
                <Ionicons name="arrow-back" size={22} color={birdUi.text} />
              </Pressable>
              <View style={styles.heroTitles}>
                <Text style={styles.title}>Sold Birds</Text>
                <Text style={styles.subtitle}>Birds that have been sold</Text>
              </View>
            </ImmersiveHeroHeader>

            <View style={styles.headerBody}>
              <View style={styles.searchRow}>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={18} color={birdUi.muted} />
                  <TextInput
                    style={styles.searchInput}
                    value={q}
                    onChangeText={setQ}
                    placeholder="Search by band no., breed, batch, buyer name or mobile…"
                    placeholderTextColor={birdUi.muted}
                    accessibilityLabel="Search sold birds"
                  />
                </View>
              </View>

              <View style={styles.chips}>
                {(
                  [
                    ["all", `All (${total})`],
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
          <Ionicons name="egg-outline" size={22} color={birdUi.primary} />
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
  heroCopy: { gap: 10, justifyContent: "space-between", minHeight: 100 },
  heroTitles: { gap: 2, paddingBottom: 2 },
  headerBody: {
    paddingHorizontal: birdUi.horizontal,
    gap: 8,
    marginBottom: 8,
    marginTop: -4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 26, fontWeight: "800", color: birdUi.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, color: birdUi.muted },
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
  searchInput: { flex: 1, fontSize: 15, color: birdUi.text, fontWeight: "600", paddingVertical: 10 },
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
  chipText: { fontSize: 13, fontWeight: "700", color: birdUi.text },
  chipTextOn: { color: "#fff" },
  emptyBox: { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: birdUi.text },
  emptyBody: { fontSize: 14, color: birdUi.muted, textAlign: "center", lineHeight: 20 },
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
  },
  band: { fontSize: 17, fontWeight: "800", color: birdUi.text },
  breedPill: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF1F0",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  breedText: { fontSize: 11, fontWeight: "700", color: birdUi.muted },
  meta: { fontSize: 12, color: birdUi.muted },
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
  soldPillText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  cardMid: { flex: 1.2, gap: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoLabel: { fontSize: 11, color: birdUi.muted, width: 52 },
  infoValue: { flex: 1, fontSize: 12, fontWeight: "700", color: birdUi.text },
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
