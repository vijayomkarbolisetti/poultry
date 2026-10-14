import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchDashboard } from "../../src/api/dashboard";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../src/theme/tokens";

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { user, ownerAccountId } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const dash = useQuery({ queryKey: ["dashboard", ownerAccountId], queryFn: fetchDashboard });

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={dash.isFetching} onRefresh={() => dash.refetch()} />}
      >
        <Text style={styles.brand}>Poultry Vaccine Tracker</Text>
        <Text style={styles.hello}>
          {membership?.organization_name ?? "Farm"} · {membership?.role}
        </Text>

        {dash.isError ? (
          <Text style={styles.error}>Could not load dashboard. Pull to retry.</Text>
        ) : (
          <View style={styles.grid}>
            <Metric label="Active sheds" value={dash.data?.active_sheds ?? "—"} />
            <Metric label="Active farmers" value={dash.data?.active_farmers ?? "—"} />
            <Metric label="Active flocks" value={dash.data?.active_flocks ?? 0} />
            <Metric label="Active birds" value={dash.data?.active_birds ?? 0} />
            <Metric label="Due today" value={dash.data?.due_today ?? 0} />
            <Metric label="Overdue" value={dash.data?.overdue_doses ?? 0} />
            <Metric label="Upcoming" value={dash.data?.upcoming_doses ?? 0} />
            <Metric
              label="Compliance"
              value={
                dash.data && dash.data.compliance_denominator > 0
                  ? `${Math.round((dash.data.compliance_numerator / dash.data.compliance_denominator) * 100)}%`
                  : "—"
              }
            />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick links</Text>
          <Link href="/(app)/doses/index" style={styles.link}>
            Doses & alerts →
          </Link>
          <Link href="/(app)/flocks/index" style={styles.link}>
            Flocks →
          </Link>
          <Link href="/(app)/sheds/index" style={styles.link}>
            Manage sheds →
          </Link>
          <Link href="/(app)/vaccines/index" style={styles.link}>
            Vaccines →
          </Link>
          {(membership?.role === "owner" || membership?.role === "org_admin") && (
            <Link href="/(app)/farmers/index" style={styles.link}>
              Manage farmers →
            </Link>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: space.md, paddingBottom: space.xl },
  brand: { fontSize: 22, fontWeight: "800", color: colors.brand },
  hello: { fontSize: 15, color: colors.inkMuted },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  metric: {
    width: "48%",
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricValue: { fontSize: 28, fontWeight: "800", color: colors.ink },
  metricLabel: { fontSize: 13, color: colors.inkMuted, marginTop: 4 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontWeight: "700", color: colors.ink },
  link: { color: colors.brand, fontWeight: "700", fontSize: 16 },
  error: { color: colors.danger },
});
