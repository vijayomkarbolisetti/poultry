import Ionicons from "@expo/vector-icons/Ionicons";
import { Href, router } from "expo-router";
import { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { colors, radius, shadow, space } from "../../src/theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

function MenuRow({
  label,
  icon,
  href,
  danger,
}: {
  label: string;
  icon: IconName;
  href?: Href;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={() => (href ? router.push(href) : undefined)}
      style={({ pressed }) => [styles.row, pressed && href && { opacity: 0.75 }]}
    >
      <View style={[styles.rowIcon, danger && { backgroundColor: "#FDECEA" }]}>
        <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.brand} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
      {href ? <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} /> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { user, ownerAccountId, setActiveOwner, signOut } = useAuth();
  const membership =
    user?.memberships.find((m) => m.owner_account_id === ownerAccountId) ?? user?.memberships[0];
  const canFarmers = hasPermission(user, ownerAccountId, "farmer.manage");
  const canSearch =
    hasPermission(user, ownerAccountId, "bird.view") ||
    hasPermission(user, ownerAccountId, "shed.view") ||
    hasPermission(user, ownerAccountId, "flock.view");

  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");

  };

  return (
    <Screen scroll>
      <View style={[styles.profile, shadow.card]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.full_name?.[0] ?? "U").toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user?.full_name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <Text style={styles.role}>
            {membership?.organization_name ?? "Farm"} · {membership?.role?.replace("_", " ")}
          </Text>
        </View>
      </View>

      <Text style={styles.section}>Manage</Text>
      <View style={[styles.card, shadow.card]}>
        {canFarmers ? <MenuRow label="Farmers" icon="people-outline" href="/(app)/farmers" /> : null}
        {canSearch ? <MenuRow label="Search" icon="search-outline" href="/(app)/search" /> : null}
        {!canFarmers && !canSearch ? (
          <Text style={{ padding: space.md, color: colors.inkMuted }}>No manage modules granted.</Text>
        ) : null}
      </View>

      <Text style={styles.section}>Organizations</Text>
      {user?.memberships.map((m) => (
        <View key={m.id} style={[styles.card, shadow.card, { padding: space.md, gap: space.sm }]}>
          <Text style={styles.orgName}>{m.organization_name}</Text>
          <Text style={styles.meta}>
            {m.role} {m.owner_account_id === ownerAccountId ? "· active" : ""}
          </Text>
          {m.owner_account_id !== ownerAccountId ? (
            <Button label="Switch to this org" variant="secondary" onPress={() => setActiveOwner(m.owner_account_id)} />
          ) : null}
        </View>
      ))}

      <Button label="Log out" onPress={onSignOut} variant="danger" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontWeight: "800", color: colors.brand },
  name: { fontSize: 18, fontWeight: "800", color: colors.ink },
  email: { fontSize: 14, color: colors.inkMuted, marginTop: 2 },
  role: { fontSize: 13, color: colors.brand, fontWeight: "700", marginTop: 4, textTransform: "capitalize" },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: space.sm,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  orgName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 13, color: colors.inkMuted, textTransform: "capitalize" },
});
