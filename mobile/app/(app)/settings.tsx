import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../src/theme/tokens";

export default function SettingsScreen() {
  const { user, ownerAccountId, setActiveOwner, signOut } = useAuth();

  const onSignOut = async () => {
    await signOut();
    router.replace("/(auth)/login");
  };

  return (
    <Screen scroll>
      <View style={styles.card}>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.value}>{user?.full_name}</Text>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email}</Text>
      </View>

      <Text style={styles.section}>Organizations</Text>
      {user?.memberships.map((m) => (
        <View key={m.id} style={styles.card}>
          <Text style={styles.value}>{m.organization_name}</Text>
          <Text style={styles.meta}>
            {m.role} {m.owner_account_id === ownerAccountId ? "· active" : ""}
          </Text>
          {m.owner_account_id !== ownerAccountId ? (
            <Button label="Switch to this org" variant="secondary" onPress={() => setActiveOwner(m.owner_account_id)} />
          ) : null}
        </View>
      ))}

      <Button label="Sign out" onPress={onSignOut} variant="danger" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  section: { fontSize: 14, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase" },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: 12, color: colors.inkMuted, fontWeight: "700" },
  value: { fontSize: 16, color: colors.ink, fontWeight: "600" },
  meta: { fontSize: 13, color: colors.inkMuted },
});
