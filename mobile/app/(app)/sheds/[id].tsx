import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { listFarmers } from "../../../src/api/farmers";
import { describeApiError } from "../../../src/api/client";
import { assignFarmer, getShed, listAssignments } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function ShedDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ownerAccountId, user } = useAuth();
  const qc = useQueryClient();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const canUpdate = hasPermission(user, ownerAccountId, "shed.update");

  const shed = useQuery({ queryKey: ["shed", id], queryFn: () => getShed(id!), enabled: !!id });
  const assignments = useQuery({
    queryKey: ["shed-assignments", id],
    queryFn: () => listAssignments(id!),
    enabled: !!id,
  });
  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: canManage,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onAssign = async (membershipId: string) => {
    setBusy(membershipId);
    setError(null);
    try {
      await assignFarmer(id!, { owner_membership_id: membershipId, is_manager: true });
      void qc.invalidateQueries({ queryKey: ["shed-assignments", id] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    } catch (e: unknown) {
      setError(describeApiError(e, "assign the farmer"));
    } finally {
      setBusy(null);
    }
  };

  if (shed.isLoading) return <Screen><HenLoader label="Loading this shed…" /></Screen>;
  if (shed.isError || !shed.data) return <Screen><Text style={styles.error}>Shed not found or access denied</Text></Screen>;

  const assignedIds = new Set((assignments.data ?? []).map((a) => a.owner_membership_id));
  const unassigned = (farmers.data ?? []).filter(
    (f) => f.is_active && f.role === "farmer" && !assignedIds.has(f.membership_id),
  );

  return (
    <Screen scroll>
      <Text style={styles.title}>{shed.data.name}</Text>
      <Text style={styles.meta}>
        {shed.data.code} · {shed.data.is_owner_managed ? "Owner-managed" : "Farmer-managed"}
      </Text>
      {shed.data.location_notes ? <Text style={styles.notes}>{shed.data.location_notes}</Text> : null}

      <Text style={styles.section}>Assigned farmers</Text>
      {(assignments.data ?? []).length === 0 ? <Text style={styles.meta}>None yet</Text> : null}
      {(assignments.data ?? []).map((a) => (
        <View key={a.id} style={styles.card}>
          <Text style={styles.cardTitle}>{a.farmer_name ?? "Farmer"}</Text>
          <Text style={styles.meta}>
            {a.farmer_email} {a.is_manager ? "· manager" : ""}
          </Text>
        </View>
      ))}

      {canManage ? (
        <>
          <Text style={styles.section}>Assign farmer</Text>
          {farmers.data && unassigned.length === 0 ? (
            <Text style={styles.meta}>
              No farmers available. Add farmers from Home → Farmers, then assign them here.
            </Text>
          ) : null}
          {unassigned
            .map((f) => (
              <View key={f.membership_id} style={styles.card}>
                <Text style={styles.cardTitle}>{f.full_name}</Text>
                <Text style={styles.meta}>{f.email}</Text>
                <Button
                  label="Assign as manager"
                  variant="secondary"
                  loading={busy === f.membership_id}
                  onPress={() => onAssign(f.membership_id)}
                />
              </View>
            ))}
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "800", color: colors.brand },
  meta: { color: colors.inkMuted, fontSize: 14 },
  notes: { color: colors.ink, fontSize: 15 },
  section: { marginTop: space.sm, fontSize: 13, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase" },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontWeight: "700", color: colors.ink, fontSize: 16 },
  error: { color: colors.danger },
});
