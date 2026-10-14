import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { listFarmers, setFarmerPermissions, updateFarmer } from "../../../src/api/farmers";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function FarmerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const farmers = useQuery({ queryKey: ["farmers", ownerAccountId], queryFn: listFarmers });
  const farmer = (farmers.data ?? []).find((f) => f.membership_id === id);

  const toggleActive = useMutation({
    mutationFn: () => updateFarmer(id!, { is_active: !farmer?.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] }),
  });

  const grantView = useMutation({
    mutationFn: () =>
      setFarmerPermissions(id!, Array.from(new Set([...(farmer?.permission_codes ?? []), "shed.view", "report.view"]))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] }),
  });

  if (farmers.isLoading) return <Screen><Text>Loading…</Text></Screen>;
  if (!farmer) return <Screen><Text style={styles.error}>Farmer not found</Text></Screen>;

  return (
    <Screen scroll>
      <Text style={styles.title}>{farmer.full_name}</Text>
      <View style={styles.card}>
        <Text style={styles.meta}>{farmer.email}</Text>
        <Text style={styles.meta}>
          Role: {farmer.role} · {farmer.is_active ? "Active" : "Inactive"}
        </Text>
        <Text style={styles.meta}>Permissions: {farmer.permission_codes.join(", ") || "none"}</Text>
        <Text style={styles.meta}>Sheds: {farmer.assigned_shed_ids.length}</Text>
      </View>
      <Button
        label={farmer.is_active ? "Deactivate" : "Reactivate"}
        variant="secondary"
        loading={toggleActive.isPending}
        onPress={() => toggleActive.mutate()}
      />
      <Button label="Ensure shed.view + report.view" loading={grantView.isPending} onPress={() => grantView.mutate()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meta: { color: colors.ink, fontSize: 14 },
  error: { color: colors.danger },
});
