import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Href, router } from "expo-router";
import { ComponentProps } from "react";
import { ImageBackground, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchDashboard } from "../../src/api/dashboard";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { media } from "../../src/theme/media";
import { colors, radius, shadow, space } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

function StatCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  icon: IconName;
  tone?: "neutral" | "warn" | "danger" | "info";
}) {
  const tint = {
    neutral: colors.brand,
    warn: colors.accent,
    danger: colors.danger,
    info: colors.info,
  }[tone];
  return (
    <View style={[styles.stat, shadow.card]}>
      <View style={[styles.statIcon, { backgroundColor: `${tint}18` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={[styles.statValue, { color: tint }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuickLink({ label, icon, href }: { label: string; icon: IconName; href: Href }) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.quick, shadow.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={20} color={colors.brand} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const { user, ownerAccountId } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const canSheds = hasPermission(user, ownerAccountId, "shed.view");
  const canBirds = hasPermission(user, ownerAccountId, "flock.view");
  const canTasks = hasPermission(user, ownerAccountId, "vaccination.view");
  const canVaccines = hasPermission(user, ownerAccountId, "schedule.view");
  const canFarmers = hasPermission(user, ownerAccountId, "farmer.manage");
  const dash = useQuery({
    queryKey: ["dashboard", ownerAccountId],
    queryFn: fetchDashboard,
    enabled: Boolean(ownerAccountId),
  });
  const d = dash.data;
  const compliance =
    d && d.compliance_denominator > 0
      ? `${Math.round((d.compliance_numerator / d.compliance_denominator) * 100)}%`
      : "—";
  const rawName = user?.full_name?.trim().split(" ")[0] ?? "";
  const firstName = rawName ? rawName[0].toUpperCase() + rawName.slice(1) : "there";

  return (
    <Screen edges={["top", "left", "right"]} style={{ padding: 0 }}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={dash.isRefetching} onRefresh={() => dash.refetch()} tintColor={colors.brand} />
        }
      >
        <ImageBackground source={{ uri: media.farmMorning }} style={styles.hero} imageStyle={styles.heroImg}>
          <View style={styles.heroScrim}>
            <View style={{ flex: 1 }}>
              <Text style={styles.brandMark}>PoultryTrack</Text>
              <Text style={styles.hello}>Hello, {firstName}</Text>
              <Text style={styles.org} numberOfLines={1}>
                {membership?.organization_name ?? "Your farm"} · healthy hens
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Account"
              onPress={() => router.push("/(app)/settings")}
              style={styles.avatar}
            >
              <Ionicons name="person" size={22} color={colors.brand} />
            </Pressable>
          </View>
        </ImageBackground>

        <View style={styles.body}>
          {dash.isError ? (
            <Pressable style={styles.errorBox} onPress={() => dash.refetch()}>
              <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
              <Text style={styles.errorText}>Could not load dashboard. Tap to retry.</Text>
            </Pressable>
          ) : null}

          <Text style={styles.section}>Overview</Text>
          <View style={styles.grid}>
            <StatCard label="Hens" value={d?.active_birds ?? "—"} icon="egg-outline" />
            <StatCard label="Due today" value={d?.due_today ?? "—"} icon="today-outline" tone="warn" />
            <StatCard label="Overdue" value={d?.overdue_doses ?? "—"} icon="alert-circle-outline" tone="danger" />
            <StatCard label="Compliance" value={compliance} icon="shield-checkmark-outline" tone="info" />
          </View>

          <Text style={styles.section}>Farm snapshot</Text>
          <View style={[styles.snapshot, shadow.card]}>
            <Row label="Active sheds" value={d?.active_sheds ?? "—"} />
            <Row label="Active flocks" value={d?.active_flocks ?? "—"} />
            <Row label="Farmers" value={d?.active_farmers ?? "—"} />
            <Row label="Upcoming doses" value={d?.upcoming_doses ?? "—"} last />
          </View>

          <Text style={styles.section}>Quick links</Text>
          {canTasks ? <QuickLink label="Vaccination tasks" icon="checkbox-outline" href="/(app)/doses" /> : null}
          {canSheds ? <QuickLink label="Manage sheds" icon="business-outline" href="/(app)/sheds" /> : null}
          {canBirds ? <QuickLink label="Hens & flocks" icon="egg-outline" href="/(app)/flocks" /> : null}
          {canVaccines ? <QuickLink label="Vaccine catalogue" icon="medkit-outline" href="/(app)/vaccines" /> : null}
          {canFarmers ? <QuickLink label="Farmers" icon="people-outline" href="/(app)/farmers" /> : null}
          {!canTasks && !canSheds && !canBirds && !canVaccines && !canFarmers ? (
            <Text style={styles.muted}>No modules granted yet. Ask your farm owner for permissions.</Text>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row({ label, value, last }: { label: string; value: number | string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xl },
  hero: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: "hidden",
    minHeight: 150,
  },
  heroImg: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  heroScrim: {
    flex: 1,
    backgroundColor: "rgba(8,40,24,0.72)",
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  brandMark: { color: "#B7E0C7", fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  hello: { fontSize: 26, fontWeight: "800", color: "#fff", marginTop: 4 },
  org: { fontSize: 14, color: "#CFE3D7", marginTop: 4 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: space.lg, gap: space.md },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: space.xs,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  stat: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  statIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 26, fontWeight: "800", marginTop: 4 },
  statLabel: { fontSize: 13, color: colors.inkMuted },
  snapshot: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { color: colors.inkMuted, fontSize: 14 },
  rowValue: { color: colors.ink, fontWeight: "800", fontSize: 15 },
  quick: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: "#FDECEA",
    borderRadius: radius.md,
    padding: space.md,
  },
  errorText: { color: colors.danger, fontWeight: "600", flex: 1 },
  muted: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
});
