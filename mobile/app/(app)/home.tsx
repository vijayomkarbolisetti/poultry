import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useQuery } from "@tanstack/react-query";
import { Href, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ComponentProps, ReactNode } from "react";
import {
  Dimensions,
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchDashboard } from "../../src/api/dashboard";
import { BrandLogo } from "../../src/components/brand/BrandLogo";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { dashboardArt } from "../../src/theme/media";
import { colors, radius, space } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

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
  divider: "#DCE8E2",
  white: "#FFFFFF",
  liveBg: "#F2FBF6",
  liveBorder: "#C7EBDD",
  liveIconBg: "#DDF5E8",
  liveTone: "#087443",
  dueBg: "#FFF9F1",
  dueBorder: "#FFE0B8",
  dueIconBg: "#FFF0DE",
  dueTone: "#EA6500",
  complianceBg: "#F2F8FF",
  complianceBorder: "#BFDEFF",
  complianceIconBg: "#DFEDFF",
  complianceTone: "#247FF0",
  accentBlue: "#2584F5",
  reportsTone: "#7434D4",
  snapshotIconBg: "#E8F8F0",
  searchBorder: "#E2EDE7",
  healthBadgeBg: "#E7F8EF",
  horizontal: 28,
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

function StatCard({
  label,
  value,
  icon,
  customIcon,
  bg,
  border,
  iconBg,
  tone,
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
      <View style={styles.statTop}>
        <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
          {customIcon ?? (icon ? <Ionicons name={icon} size={18} color={tone} /> : null)}
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9AA8A1" />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
    </Pressable>
  );
}

function QuickAction({
  title,
  subtitle,
  icon,
  iconColor,
  iconBg,
  href,
}: {
  title: string;
  subtitle: string;
  icon: IconName;
  iconColor: string;
  iconBg: string;
  href: Href;
}) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.quick, softCardShadow(), pressed && { opacity: 0.88 }]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.quickIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.quickText}>
        <Text style={styles.quickTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.quickSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#9AA8A1" />
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, ownerAccountId } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const farmName = membership?.organization_name?.trim() || "Your farm";
  const farmTitle =
    user?.full_name?.trim().split(/\s+/).filter(Boolean)[0] || farmName;

  const canSheds = hasPermission(user, ownerAccountId, "shed.view");
  const canBirds = hasPermission(user, ownerAccountId, "flock.view");
  const canBirdSearch = hasPermission(user, ownerAccountId, "bird.view");
  // Match global search screen: birds + sheds only (no batch search entry).
  const canSearch = canBirdSearch || canSheds;

  const dash = useQuery({
    queryKey: ["dashboard", ownerAccountId],
    queryFn: fetchDashboard,
    enabled: Boolean(ownerAccountId),
  });

  const d = dash.data;
  const health = farmHealthLabel(d?.active_birds, d?.active_sheds);
  const lastUpdated = formatLastUpdated(dash.dataUpdatedAt || undefined);

  const goSearch = () => {
    if (canSearch) router.push("/(app)/search");
  };
  const goSnapshotDetails = () => {
    if (canSheds) router.push("/(app)/sheds");
    else if (canBirdSearch) router.push("/(app)/search");
    else router.push("/(app)/settings");
  };

  return (
    <Screen edges={["left", "right"]} style={{ padding: 0, gap: 0, backgroundColor: ui.contentBg }}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: space.xl + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={dash.isRefetching}
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
          style={[styles.header, { paddingTop: Math.max(insets.top, 10) + 6 }]}
          imageStyle={styles.headerImg}
          resizeMode="cover"
        >
          <View style={styles.headerTop}>
            <View style={styles.brandRow}>
              <BrandLogo size={26} preferPng accessibilityLabel="PoultryTrack logo" />
              <Text style={styles.brandName}>PoultryTrack</Text>
            </View>
            <View style={styles.headerActions}>
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
          </View>

          <View style={styles.farmRow}>
            <View style={styles.farmIdentity}>
              <Text style={styles.farmTitle} numberOfLines={1}>
                {farmTitle}
              </Text>
              <View style={styles.farmNameRow}>
                <Ionicons name="location-sharp" size={13} color="rgba(255,255,255,0.92)" />
                <Text style={styles.farmName} numberOfLines={1}>
                  {farmName}
                </Text>
              </View>
            </View>
            <View style={styles.healthBadge}>
              <Ionicons name="pulse" size={14} color={ui.accentGreen} />
              <Text style={styles.healthText} numberOfLines={1}>
                Farm health · {health}
              </Text>
            </View>
          </View>

          <HeaderCurve width={SCREEN_W} />
        </ImageBackground>

        <View style={styles.sheet}>
          <Pressable
            onPress={goSearch}
            disabled={!canSearch}
            style={({ pressed }) => [
              styles.searchBar,
              softCardShadow(),
              pressed && canSearch ? { opacity: 0.92 } : null,
              !canSearch ? { opacity: 0.7 } : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Search birds and sheds"
          >
            <Ionicons name="search" size={18} color="#8A9A93" />
            <Text style={styles.searchPlaceholder}>Search birds and sheds...</Text>
          </Pressable>

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

          <View style={styles.grid}>
            <StatCard
              label="Live birds"
              value={d?.active_birds ?? "—"}
              customIcon={
                <MaterialCommunityIcons name="bird" size={18} color={ui.liveTone} />
              }
              bg={ui.liveBg}
              border={ui.liveBorder}
              iconBg={ui.liveIconBg}
              tone={ui.liveTone}
              onPress={
                canSheds
                  ? () => router.push("/(app)/sheds")
                  : canBirdSearch
                    ? () => router.push("/(app)/search")
                    : undefined
              }
            />
            <StatCard
              label="Active sheds"
              value={d?.active_sheds ?? "—"}
              icon="business-outline"
              bg={ui.complianceBg}
              border={ui.complianceBorder}
              iconBg={ui.complianceIconBg}
              tone={ui.complianceTone}
              onPress={canSheds ? () => router.push("/(app)/sheds") : undefined}
            />
            <StatCard
              label="Farmers"
              value={d?.active_farmers ?? "—"}
              icon="people-outline"
              bg={ui.liveBg}
              border={ui.liveBorder}
              iconBg={ui.liveIconBg}
              tone={ui.liveTone}
              onPress={() => router.push("/(app)/settings")}
            />
          </View>

          <View style={[styles.sectionHead, { marginTop: 22 }]}>
            <Text style={styles.sectionTitle}>Farm snapshot</Text>
            <Pressable
              onPress={goSnapshotDetails}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="View farm details"
            >
              <Text style={styles.viewDetails}>
                View details <Text style={styles.viewDetailsChevron}>›</Text>
              </Text>
            </Pressable>
          </View>

          <View style={[styles.snapshot, softCardShadow()]}>
            <SnapshotMetric
              icon="business-outline"
              value={d?.active_sheds ?? "—"}
              label="Active sheds"
            />
            <View style={styles.snapshotDivider} />
            <SnapshotMetric
              icon="egg-outline"
              value={d?.active_birds ?? "—"}
              label="Live birds"
            />
            <View style={styles.snapshotDivider} />
            <SnapshotMetric
              icon="people-outline"
              value={d?.active_farmers ?? "—"}
              label="Farmers"
            />
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 22, marginBottom: 12 }]}>Quick actions</Text>
          <View style={styles.quickGrid}>
            {canSheds ? (
              <QuickAction
                title="Manage sheds"
                subtitle="View and manage your sheds"
                icon="business-outline"
                iconColor={ui.accentGreen}
                iconBg="#E8F8F0"
                href="/(app)/sheds"
              />
            ) : null}
            {canSheds ? (
              <QuickAction
                title="Manage birds"
                subtitle="Open sheds to view and add birds"
                icon="egg-outline"
                iconColor={ui.accentGreen}
                iconBg="#E8F8F0"
                href="/(app)/sheds"
              />
            ) : canBirdSearch ? (
              <QuickAction
                title="Find birds"
                subtitle="Search birds by band number"
                icon="egg-outline"
                iconColor={ui.accentGreen}
                iconBg="#E8F8F0"
                href="/(app)/search"
              />
            ) : null}
            {canSearch ? (
              <QuickAction
                title="Search"
                subtitle="Find birds or sheds"
                icon="search-outline"
                iconColor={ui.accentBlue}
                iconBg="#EAF3FE"
                href="/(app)/search"
              />
            ) : null}
          </View>

          {!canSheds && !canBirds && !canSearch ? (
            <Text style={styles.muted}>No modules granted yet. Ask your farm owner for permissions.</Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function SnapshotMetric({
  icon,
  value,
  label,
}: {
  icon: IconName;
  value: number | string;
  label: string;
}) {
  return (
    <View style={styles.snapshotMetric}>
      <View style={styles.snapshotIcon}>
        <Ionicons name={icon} size={16} color={ui.accentGreen} />
      </View>
      <Text style={styles.snapshotValue}>{value}</Text>
      <Text style={styles.snapshotLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: ui.contentBg },
  header: {
    minHeight: 196,
    paddingHorizontal: ui.horizontal,
    paddingBottom: 44,
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
    color: ui.white,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  notifDot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#E52626",
    borderWidth: 1.5,
    borderColor: ui.forest,
  },
  profileBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F3F6F4",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  farmRow: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 8,
  },
  farmIdentity: { flex: 1, minWidth: 0, gap: 4 },
  farmTitle: {
    color: ui.white,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  farmNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  farmName: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "600",
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
    maxWidth: "54%",
    marginTop: 4,
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
    marginBottom: 20,
  },
  searchPlaceholder: {
    flex: 1,
    color: "#8A9A93",
    fontSize: 14,
    fontWeight: "500",
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  stat: {
    width: "47.5%",
    flexGrow: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    minHeight: 118,
  },
  statTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: ui.secondaryText,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  viewDetails: {
    color: ui.accentGreen,
    fontSize: 13,
    fontWeight: "700",
  },
  viewDetailsChevron: { fontSize: 15, fontWeight: "700" },
  snapshot: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: ui.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ui.subtleBorder,
    paddingVertical: 16,
    paddingHorizontal: 6,
    marginBottom: 18,
  },
  snapshotMetric: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 4,
  },
  snapshotIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ui.snapshotIconBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  snapshotValue: {
    fontSize: 20,
    fontWeight: "800",
    color: ui.primaryText,
  },
  snapshotLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: ui.secondaryText,
    textAlign: "center",
  },
  snapshotDivider: {
    width: 1,
    backgroundColor: ui.divider,
    marginVertical: 6,
  },
  vaxBanner: {
    height: 124,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: ui.forest,
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
  },
  vaxArtClip: {
    width: "36%",
    height: "100%",
    overflow: "hidden",
  },
  vaxArtWide: {
    height: "100%",
    width: SCREEN_W,
  },
  vaxDivider: {
    width: 1,
    height: "56%",
    backgroundColor: "rgba(255,255,255,0.35)",
    marginHorizontal: 10,
  },
  vaxCopy: {
    flex: 1,
    gap: 3,
    paddingVertical: 10,
    paddingRight: 6,
    minWidth: 0,
  },
  vaxTitle: {
    color: ui.white,
    fontSize: 15,
    fontWeight: "800",
  },
  vaxDesc: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
  },
  vaxBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: ui.white,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  vaxBtnText: {
    color: ui.primaryText,
    fontSize: 12,
    fontWeight: "700",
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  quick: {
    width: "47.5%",
    flexGrow: 1,
    minHeight: 96,
    backgroundColor: ui.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ui.subtleBorder,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  quickText: { flex: 1, gap: 2, minWidth: 0 },
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
