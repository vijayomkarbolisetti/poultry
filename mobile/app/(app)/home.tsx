import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useQuery } from "@tanstack/react-query";
import { Href, router, useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ComponentProps, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  ImageBackground,
  ImageSourcePropType,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchDashboard } from "../../src/api/dashboard";
import { BrandLogo } from "../../src/components/brand/BrandLogo";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { HomeInlineSearchPanel } from "../../src/features/search/HomeInlineSearchPanel";
import {
  clearHomeSearchDraft,
  getHomeSearchDraft,
  setHomeSearchDraft,
} from "../../src/features/search/homeSearchSession";
import { normalizeSearchQuery } from "../../src/features/search/globalSearchHelpers";
import { dashboardArt, homeCardArt } from "../../src/theme/media";
import { colors, radius, space } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];
type MciName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const HEADER_ART = dashboardArt.header;
const SCREEN_W = Dimensions.get("window").width;

const ui = {
  contentBg: "#F4FAF7",
  forest: "#064E3B",
  emerald: "#047857",
  accentGreen: "#087443",
  primaryText: "#102A22",
  secondaryText: "#5B6B73",
  subtleBorder: "#D7E8E0",
  white: "#FFFFFF",
  // Overview card themes (mock)
  birdsBg: "#EEF9F2",
  birdsBorder: "#C8EBD8",
  birdsIcon: "#D8F3E5",
  birdsTone: "#0B8A52",
  shedsBg: "#EEF4FC",
  shedsBorder: "#C9DBF5",
  shedsIcon: "#D9E7FA",
  shedsTone: "#2B78E4",
  farmersBg: "#FBF3EB",
  farmersBorder: "#EED9C4",
  farmersIcon: "#F5E4D4",
  farmersTone: "#C56A2B",
  // Quick action accents
  actionShed: "#0B8A52",
  actionShedBg: "#E4F6EC",
  actionBird: "#0F6B45",
  actionBirdBg: "#E6F3EC",
  actionVax: "#2B78E4",
  actionVaxBg: "#E8F1FC",
  actionCat: "#7B4FC8",
  actionCatBg: "#F0E9FA",
  searchBorder: "#E2EDE7",
  healthBadgeBg: "#E7F8EF",
  horizontal: 20,
};

function formatLastUpdated(ts?: number): string {
  if (!ts) return "Last updated: —";
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Last updated: Today ${time}`;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Last updated: ${date} ${time}`;
}

function farmHealthLabel(liveBirds: number | undefined, activeSheds: number | undefined): string {
  if (liveBirds == null) return "—";
  if ((activeSheds ?? 0) === 0) return "Setup needed";
  if (liveBirds === 0) return "Empty sheds";
  return "Good";
}

function softCardShadow() {
  return {
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  };
}

function HeaderCurve({ width }: { width: number }) {
  const h = 28;
  return (
    <View style={styles.curveWrap} pointerEvents="none">
      <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none">
        <Path
          d={`M0 0 Q${width / 2} ${h * 1.35} ${width} 0 L${width} ${h} L0 ${h} Z`}
          fill={ui.contentBg}
        />
      </Svg>
    </View>
  );
}

/**
 * Soft pastel landscape behind card copy (subject weighted right).
 * Falls back to a faint icon if no asset is wired yet.
 */
function CardWatermark({
  source,
  fallbackIcon,
  fallbackMci,
  color,
  variant = "stat",
}: {
  source?: ImageSourcePropType;
  fallbackIcon?: IconName;
  fallbackMci?: MciName;
  color: string;
  variant?: "stat" | "action";
}) {
  if (source) {
    return (
      <View
        style={variant === "stat" ? styles.statArtClip : styles.actionArtClip}
        pointerEvents="none"
      >
        <Image
          source={source}
          style={variant === "stat" ? styles.statArtImg : styles.actionArtImg}
          resizeMode="cover"
        />
      </View>
    );
  }
  return (
    <View
      style={[styles.watermarkFallback, variant === "stat" ? { width: 52, height: 52 } : { width: 64, height: 64 }]}
      pointerEvents="none"
    >
      {fallbackMci ? (
        <MaterialCommunityIcons name={fallbackMci} size={variant === "stat" ? 38 : 46} color={color} />
      ) : fallbackIcon ? (
        <Ionicons name={fallbackIcon} size={variant === "stat" ? 38 : 46} color={color} />
      ) : null}
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
  customIcon,
  bg,
  border,
  iconBg,
  tone,
  watermark,
  watermarkIcon,
  watermarkMci,
  onPress,
}: {
  label: string;
  value: number | string;
  icon?: IconName;
  customIcon?: ReactNode;
  bg: string;
  border: string;
  iconBg: string;
  tone: string;
  watermark?: ImageSourcePropType;
  watermarkIcon?: IconName;
  watermarkMci?: MciName;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.stat,
        softCardShadow(),
        { backgroundColor: bg, borderColor: border },
        pressed && onPress ? { opacity: 0.88 } : null,
      ]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${value}`}
    >
      <CardWatermark
        source={watermark}
        fallbackIcon={watermarkIcon}
        fallbackMci={watermarkMci}
        color={`${tone}33`}
        variant="stat"
      />
      <View style={styles.statTop}>
        <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
          {customIcon ?? (icon ? <Ionicons name={icon} size={16} color={tone} /> : null)}
        </View>
        <Ionicons name="chevron-forward" size={14} color="#9AA8A1" />
      </View>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color: ui.primaryText }]} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

function QuickAction({
  title,
  subtitle,
  icon,
  iconColor,
  iconBg,
  watermark,
  watermarkIcon,
  watermarkMci,
  href,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  iconColor: string;
  iconBg: string;
  watermark?: ImageSourcePropType;
  watermarkIcon?: IconName;
  watermarkMci?: MciName;
  href?: Href;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        if (onPress) onPress();
        else if (href) router.push(href);
      }}
      style={({ pressed }) => [styles.quick, softCardShadow(), pressed && { opacity: 0.88 }]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <CardWatermark
        source={watermark}
        fallbackIcon={watermarkIcon}
        fallbackMci={watermarkMci}
        color={`${iconColor}28`}
        variant="action"
      />
      <View style={[styles.quickIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.quickText}>
        <Text style={styles.quickTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.quickSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color="#9AA8A1" />
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, ownerAccountId } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const farmName = membership?.organization_name?.trim() || "Your farm";
  const farmTitle = user?.full_name?.trim().split(/\s+/).filter(Boolean)[0] || farmName;

  const canSheds = hasPermission(user, ownerAccountId, "shed.view");
  const canBirds = hasPermission(user, ownerAccountId, "flock.view");
  const canBirdSearch = hasPermission(user, ownerAccountId, "bird.view");
  const canSearch = canBirdSearch || canSheds;
  const canVaccination = hasPermission(user, ownerAccountId, "vaccination.view");
  const canCatalogues = hasPermission(user, ownerAccountId, "schedule.view");
  const canFarmers = hasPermission(user, ownerAccountId, "farmer.manage");

  const searchRef = useRef<TextInput>(null);
  const [searchDraft, setSearchDraft] = useState(() => getHomeSearchDraft());
  const searchActive = normalizeSearchQuery(searchDraft).length > 0;

  useEffect(() => {
    setHomeSearchDraft(searchDraft);
  }, [searchDraft]);

  useFocusEffect(
    useCallback(() => {
      setSearchDraft(getHomeSearchDraft());
    }, []),
  );

  const focusHomeSearch = useCallback(() => {
    if (!canSearch) return;
    searchRef.current?.focus();
  }, [canSearch]);

  const clearSearch = useCallback(() => {
    setSearchDraft("");
    clearHomeSearchDraft();
  }, []);

  const dash = useQuery({
    queryKey: ["dashboard", ownerAccountId],
    queryFn: fetchDashboard,
    enabled: Boolean(ownerAccountId),
  });

  const d = dash.data;
  const health = farmHealthLabel(d?.active_birds, d?.active_sheds);
  const lastUpdated = formatLastUpdated(dash.dataUpdatedAt || undefined);

  const hasQuickActions = canSheds || canBirdSearch || canVaccination || canCatalogues;

  return (
    <Screen edges={["left", "right"]} style={{ padding: 0, gap: 0, backgroundColor: ui.contentBg }}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: space.xl + 8 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={dash.isRefetching && !searchActive}
            onRefresh={() => {
              void dash.refetch();
            }}
            tintColor={ui.emerald}
            colors={[ui.emerald]}
          />
        }
      >
        <ImageBackground
          source={HEADER_ART}
          style={[styles.header, { paddingTop: Math.max(insets.top, 10) + 4 }]}
          imageStyle={styles.headerImg}
          resizeMode="cover"
        >
          <View style={styles.headerTop}>
            <View style={styles.brandRow}>
              <BrandLogo size={26} preferPng accessibilityLabel="PoultryTrack logo" />
              <Text style={styles.brandName}>PoultryTrack</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Account"
              onPress={() => router.push("/(app)/settings")}
              style={styles.profileBtn}
              hitSlop={8}
            >
              <Ionicons name="person" size={17} color={ui.forest} />
            </Pressable>
          </View>

          <View style={styles.farmRow}>
            <View style={styles.farmIdentity}>
              <Text style={styles.farmTitle} numberOfLines={1}>
                {farmTitle}
              </Text>
              <View style={styles.farmNameRow}>
                <Ionicons name="location-sharp" size={13} color={ui.accentGreen} />
                <Text style={styles.farmName} numberOfLines={1}>
                  {farmName}
                </Text>
              </View>
            </View>
            <View style={styles.healthBadge}>
              <Ionicons name="pulse" size={13} color={ui.accentGreen} />
              <Text style={styles.healthText} numberOfLines={1}>
                Farm health · {health}
              </Text>
            </View>
          </View>

          <HeaderCurve width={SCREEN_W} />
        </ImageBackground>

        <View style={styles.sheet}>
          <View style={[styles.searchBar, softCardShadow(), !canSearch ? { opacity: 0.7 } : null]}>
            <Ionicons name="search" size={18} color="#8A9A93" />
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
              value={searchDraft}
              onChangeText={setSearchDraft}
              placeholder="Search birds and sheds..."
              placeholderTextColor="#8A9A93"
              editable={canSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="never"
              accessibilityLabel="Search birds and sheds"
            />
            {searchDraft.length > 0 ? (
              <Pressable
                onPress={clearSearch}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={20} color="#8A9A93" />
              </Pressable>
            ) : (
              <View
                style={styles.searchFilter}
                pointerEvents="none"
                importantForAccessibility="no"
                accessibilityElementsHidden
              >
                <Ionicons name="options-outline" size={18} color="#8A9A93" />
              </View>
            )}
          </View>

          {searchActive && canSearch ? (
            <HomeInlineSearchPanel
              draft={searchDraft}
              colors={{
                white: ui.white,
                primaryText: ui.primaryText,
                secondaryText: ui.secondaryText,
                subtleBorder: ui.subtleBorder,
                accentGreen: ui.accentGreen,
                forest: ui.forest,
              }}
            />
          ) : null}

          {!searchActive ? (
            <>
              {dash.isError ? (
                <Pressable style={styles.errorBox} onPress={() => dash.refetch()}>
                  <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
                  <Text style={styles.errorText}>Could not load dashboard. Tap to retry.</Text>
                </Pressable>
              ) : null}

              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Overview</Text>
                <View style={styles.refreshRow}>
                  <Text style={styles.lastUpdated} numberOfLines={1}>
                    {lastUpdated}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Refresh dashboard"
                    onPress={() => dash.refetch()}
                    hitSlop={10}
                    style={styles.refreshBtn}
                  >
                    <Ionicons name="refresh" size={15} color={ui.secondaryText} />
                  </Pressable>
                </View>
              </View>

              {/* Three equal cards in one row — mock layout */}
              <View style={styles.statRow}>
                <StatCard
                  label="Live birds"
                  value={d?.active_birds ?? "—"}
                  customIcon={<MaterialCommunityIcons name="bird" size={16} color={ui.birdsTone} />}
                  bg={ui.birdsBg}
                  border={ui.birdsBorder}
                  iconBg={ui.birdsIcon}
                  tone={ui.birdsTone}
                  watermark={homeCardArt.liveBirds}
                  watermarkMci="bird"
                  onPress={
                    canSheds
                      ? () => router.push("/(app)/sheds")
                      : canBirdSearch
                        ? focusHomeSearch
                        : undefined
                  }
                />
                <StatCard
                  label="Active sheds"
                  value={d?.active_sheds ?? "—"}
                  icon="business"
                  bg={ui.shedsBg}
                  border={ui.shedsBorder}
                  iconBg={ui.shedsIcon}
                  tone={ui.shedsTone}
                  watermark={homeCardArt.activeSheds}
                  watermarkIcon="business"
                  onPress={canSheds ? () => router.push("/(app)/sheds") : undefined}
                />
                <StatCard
                  label="Farmers"
                  value={d?.active_farmers ?? "—"}
                  icon="people"
                  bg={ui.farmersBg}
                  border={ui.farmersBorder}
                  iconBg={ui.farmersIcon}
                  tone={ui.farmersTone}
                  watermark={homeCardArt.farmers}
                  watermarkIcon="people"
                  onPress={
                    canFarmers
                      ? () => router.push("/(app)/farmers")
                      : () => router.push("/(app)/settings")
                  }
                />
              </View>

              <Text style={[styles.sectionTitle, { marginTop: 22, marginBottom: 12 }]}>
                Quick actions
              </Text>
              <View style={styles.quickGrid}>
                {canSheds ? (
                  <QuickAction
                    title="Manage sheds"
                    subtitle="View and manage your sheds"
                    icon="home-outline"
                    iconColor={ui.actionShed}
                    iconBg={ui.actionShedBg}
                    watermark={homeCardArt.manageSheds}
                    watermarkIcon="home"
                    href="/(app)/sheds"
                  />
                ) : null}
                {canSheds ? (
                  <QuickAction
                    title="Manage birds"
                    subtitle="Open sheds to view and add birds"
                    icon="egg-outline"
                    iconColor={ui.actionBird}
                    iconBg={ui.actionBirdBg}
                    watermark={homeCardArt.manageBirds}
                    watermarkMci="bird"
                    href="/(app)/sheds"
                  />
                ) : canBirdSearch ? (
                  <QuickAction
                    title="Find birds"
                    subtitle="Search birds by band number"
                    icon="egg-outline"
                    iconColor={ui.actionBird}
                    iconBg={ui.actionBirdBg}
                    watermark={homeCardArt.manageBirds}
                    watermarkMci="bird"
                    onPress={focusHomeSearch}
                  />
                ) : null}
                {canVaccination ? (
                  <QuickAction
                    title="Vaccination"
                    subtitle="View vaccination tasks and records"
                    icon="medkit-outline"
                    iconColor={ui.actionVax}
                    iconBg={ui.actionVaxBg}
                    watermark={homeCardArt.vaccination}
                    watermarkIcon="medkit"
                    href="/(app)/vaccination"
                  />
                ) : null}
                {canCatalogues ? (
                  <QuickAction
                    title="Catalogues"
                    subtitle="Manage vaccination catalogues"
                    icon="book-outline"
                    iconColor={ui.actionCat}
                    iconBg={ui.actionCatBg}
                    watermark={homeCardArt.catalogues}
                    watermarkIcon="book"
                    href="/(app)/catalogues"
                  />
                ) : null}
              </View>

              {!hasQuickActions ? (
                <Text style={styles.muted}>
                  No modules granted yet. Ask your farm owner for permissions.
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: ui.contentBg },
  header: {
    minHeight: 188,
    paddingHorizontal: ui.horizontal,
    paddingBottom: 40,
    overflow: "hidden",
  },
  headerImg: { resizeMode: "cover" },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandName: {
    color: ui.forest,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  profileBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ui.white,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
    ...softCardShadow(),
  },
  farmRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 6,
  },
  farmIdentity: { flex: 1, minWidth: 0, gap: 4 },
  farmTitle: {
    color: ui.primaryText,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  farmNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  farmName: {
    color: ui.accentGreen,
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  healthBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: ui.healthBadgeBg,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#C7EBDD",
    maxWidth: "52%",
    marginTop: 6,
  },
  healthText: {
    color: ui.accentGreen,
    fontSize: 12,
    fontWeight: "700",
  },
  curveWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    marginTop: -18,
    backgroundColor: ui.contentBg,
    paddingHorizontal: ui.horizontal,
    paddingTop: 0,
    minHeight: 400,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: ui.white,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: ui.searchBorder,
    paddingHorizontal: 16,
    height: 50,
    marginTop: -8,
    marginBottom: 18,
  },
  searchInput: {
    flex: 1,
    color: ui.primaryText,
    fontSize: 14,
    fontWeight: "500",
    paddingVertical: 0,
    margin: 0,
  },
  searchFilter: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: ui.primaryText,
    letterSpacing: -0.2,
  },
  refreshRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  lastUpdated: {
    fontSize: 11,
    color: ui.secondaryText,
    fontWeight: "500",
    flexShrink: 1,
  },
  refreshBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  statRow: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 112,
    overflow: "hidden",
  },
  /** Overview KPI — art fills card, subject sits on the right. */
  statArtClip: {
    ...StyleSheet.absoluteFill,
    opacity: 0.55,
  },
  statArtImg: {
    width: "100%",
    height: "100%",
  },
  /** Quick action — softer fill so title/subtitle stay readable. */
  actionArtClip: {
    ...StyleSheet.absoluteFill,
    opacity: 0.28,
  },
  actionArtImg: {
    width: "100%",
    height: "100%",
  },
  watermarkFallback: {
    position: "absolute",
    right: -4,
    bottom: -2,
    opacity: 0.9,
    alignItems: "center",
    justifyContent: "center",
  },
  statTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    zIndex: 1,
  },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: ui.secondaryText,
    marginBottom: 2,
    zIndex: 1,
  },
  statValue: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    zIndex: 1,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  quick: {
    width: "47.5%",
    flexGrow: 1,
    minHeight: 88,
    backgroundColor: ui.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: ui.subtleBorder,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  quickText: { flex: 1, gap: 2, minWidth: 0, zIndex: 1 },
  quickTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: ui.primaryText,
  },
  quickSubtitle: {
    fontSize: 11,
    fontWeight: "500",
    color: ui.secondaryText,
    lineHeight: 14,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: "#FDECEA",
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: 12,
  },
  errorText: { color: colors.danger, fontWeight: "600", flex: 1, fontSize: 13 },
  muted: { color: ui.secondaryText, fontSize: 14, lineHeight: 20, marginTop: 8 },
});
