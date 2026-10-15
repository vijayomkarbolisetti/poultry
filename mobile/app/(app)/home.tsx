import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Href, router } from "expo-router";
import { ComponentProps } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchDashboard } from "../../src/api/dashboard";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

function Metric({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  icon: IconName;
  tone?: "neutral" | "warn" | "danger" | "good";
}) {
  const tint = { neutral: colors.brand, warn: colors.accent, danger: colors.danger, good: colors.success }[tone];
  return (
    <View style={styles.metric}>
      <View style={[styles.metricIcon, { backgroundColor: `${tint}1A` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={[styles.metricValue, tone !== "neutral" && { color: tint }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Action({ label, icon, href }: { label: string; icon: IconName; href: Href }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={colors.brand} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { user, ownerAccountId } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const isOwnerLike = membership?.role === "owner" || membership?.role === "org_admin";
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
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Hello, {firstName}</Text>
            <Text style={styles.org} numberOfLines={1}>
              {membership?.organization_name ?? "Your farm"}
              {membership?.role ? ` · ${membership.role.replace("_", " ")}` : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Account"
            hitSlop={12}
            onPress={() => router.push("/(app)/settings")}
          >
            <Ionicons name="person-circle-outline" size={34} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.body}>
          {dash.isError ? (
            <Pressable style={styles.errorBox} onPress={() => dash.refetch()}>
              <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
              <Text style={styles.errorText}>Could not load dashboard. Tap to retry.</Text>
            </Pressable>
          ) : null}
          {dash.isLoading ? <Text style={styles.muted}>Loading your farm… (first load can take up to a minute)</Text> : null}

          <Text style={styles.section}>Vaccinations</Text>
          <View style={styles.grid}>
            <Metric label="Due today" value={d?.due_today ?? "—"} icon="today-outline" tone="warn" />
            <Metric label="Overdue" value={d?.overdue_doses ?? "—"} icon="alert-circle-outline" tone="danger" />
            <Metric label="Upcoming" value={d?.upcoming_doses ?? "—"} icon="time-outline" />
            <Metric label="Compliance" value={compliance} icon="shield-checkmark-outline" tone="good" />
          </View>

          <Text style={styles.section}>Farm</Text>
          <View style={styles.grid}>
            <Metric label="Sheds" value={d?.active_sheds ?? "—"} icon="business-outline" />
            <Metric label="Flocks" value={d?.active_flocks ?? "—"} icon="egg-outline" />
            <Metric label="Birds" value={d?.active_birds ?? "—"} icon="analytics-outline" />
            <Metric label="Farmers" value={d?.active_farmers ?? "—"} icon="people-outline" />
          </View>

          <Text style={styles.section}>Quick actions</Text>
          <View style={styles.actions}>
            <Action label="Doses due" icon="calendar-outline" href="/(app)/doses" />
            <Action label="New flock" icon="add-circle-outline" href="/(app)/flocks/create" />
            {membership?.role === "owner" ? (
              <Action label="New shed" icon="business-outline" href="/(app)/sheds/create" />
            ) : null}
            <Action label="Vaccines" icon="medkit-outline" href="/(app)/vaccines" />
            {isOwnerLike ? <Action label="Farmers" icon="people-outline" href="/(app)/farmers" /> : null}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xl },
  hero: {
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  hello: { fontSize: 24, fontWeight: "800", color: "#fff" },
  org: { fontSize: 14, color: "#CFE3D7", marginTop: 4, textTransform: "capitalize" },
  body: { padding: space.lg, gap: space.md },
  section: { fontSize: 13, fontWeight: "800", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  metric: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  metricIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  metricValue: { fontSize: 26, fontWeight: "800", color: colors.ink, marginTop: 4 },
  metricLabel: { fontSize: 13, color: colors.inkMuted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  action: {
    width: "31%",
    flexGrow: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.md,
    alignItems: "center",
    gap: 6,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 13, fontWeight: "700", color: colors.ink, textAlign: "center" },
  muted: { color: colors.inkMuted },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: "#FDECEA",
    borderRadius: radius.md,
    padding: space.md,
  },
  errorText: { color: colors.danger, fontWeight: "600", flex: 1 },
});
