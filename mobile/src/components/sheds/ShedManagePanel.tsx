import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { listFarmers } from "../../api/farmers";
import { describeApiError } from "../../api/client";
import {
  assignFarmer,
  deactivateShed,
  getShedDependencies,
  reactivateShed,
  type Shed,
  type ShedAssignment,
  type ShedDependencies,
} from "../../api/sheds";
import { useAuth } from "../../features/auth/AuthContext";
import { hasPermission } from "../../features/auth/permissions";
import { birdUi } from "../../theme/birdManagementUi";
import { space } from "../../theme/tokens";
import { toast } from "../../ui/toast/toastStore";
import { AppDialog } from "../ui/AppDialog";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/SelectField";

type Props = {
  shedId: string;
  shed: Shed;
  assignments: ShedAssignment[];
  /** Called after shed state changes so parent can refresh overview/birds. */
  onChanged?: () => void;
};

/** Shed admin actions: edit, activate/deactivate, farmer assignment. */
export function ShedManagePanel({ shedId, shed, assignments, onChanged }: Props) {
  const { ownerAccountId, user } = useAuth();
  const qc = useQueryClient();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const canUpdate = hasPermission(user, ownerAccountId, "shed.update");

  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: canManage,
  });

  const [selectedFarmer, setSelectedFarmer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deactivateDeps, setDeactivateDeps] = useState<ShedDependencies | null>(null);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
    void qc.invalidateQueries({ queryKey: ["shed-birds", shedId] });
    void qc.invalidateQueries({ queryKey: ["shed-birds-summary", shedId] });
    void qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
    onChanged?.();
  };

  const assignedIds = useMemo(
    () => new Set(assignments.map((a) => a.owner_membership_id)),
    [assignments],
  );
  const farmerOptions = useMemo(
    () =>
      (farmers.data ?? [])
        .filter((f) => f.is_active && f.role === "farmer" && !assignedIds.has(f.membership_id))
        .map((f) => ({ value: f.membership_id, label: f.full_name, hint: f.email })),
    [farmers.data, assignedIds],
  );

  if (!canUpdate) return null;

  const onAssign = async () => {
    if (!selectedFarmer) {
      setError("Select a farmer to assign");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await assignFarmer(shedId, { owner_membership_id: selectedFarmer, is_manager: true });
      setSelectedFarmer(null);
      invalidateAll();
      toast.success("Farmer assigned");
    } catch (e: unknown) {
      setError(describeApiError(e, "assign the farmer"));
    } finally {
      setBusy(false);
    }
  };

  const onDeactivate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const deps = await getShedDependencies(shedId);
      setDeactivateDeps(deps);
    } catch (e: unknown) {
      setError(describeApiError(e, "load shed dependencies"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeactivate = async () => {
    setBusy(true);
    try {
      await deactivateShed(shedId);
      setDeactivateDeps(null);
      invalidateAll();
      toast.success("Shed deactivated");
    } catch (e: unknown) {
      setDeactivateDeps(null);
      setError(describeApiError(e, "deactivate the shed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmReactivate = async () => {
    setBusy(true);
    try {
      await reactivateShed(shedId);
      setReactivateOpen(false);
      invalidateAll();
      toast.success("Shed reactivated");
    } catch (e: unknown) {
      setReactivateOpen(false);
      setError(describeApiError(e, "reactivate the shed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.manageCard}>
        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <Button
              label="Edit shed"
              variant="secondary"
              onPress={() => router.push(`/(app)/sheds/edit/${shedId}`)}
            />
          </View>
          <View style={{ flex: 1 }}>
            {shed.is_active ? (
              <Button label="Deactivate" variant="secondary" onPress={onDeactivate} loading={busy} />
            ) : (
              <Button label="Reactivate" onPress={() => setReactivateOpen(true)} loading={busy} />
            )}
          </View>
        </View>
        {shed.location_notes ? <Text style={styles.notes}>{shed.location_notes}</Text> : null}
        <Text style={styles.eyebrow}>Assigned farmers</Text>
        {assignments.length === 0 ? <Text style={styles.muted}>None yet</Text> : null}
        {assignments.map((a) => (
          <Text key={a.id} style={styles.assignLine}>
            {a.farmer_name ?? "Farmer"} · {a.farmer_email}
            {a.is_manager ? " · manager" : ""}
          </Text>
        ))}
        {canManage ? (
          <>
            <SelectField
              label="Assign farmer"
              searchable
              value={selectedFarmer}
              options={farmerOptions}
              onChange={setSelectedFarmer}
              loading={farmers.isLoading}
              emptyMessage="No farmers available"
              clearable
            />
            <Button
              label="Assign as manager"
              onPress={() => void onAssign()}
              loading={busy}
              disabled={!selectedFarmer}
            />
          </>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <AppDialog
        visible={Boolean(deactivateDeps)}
        title="Deactivate this shed?"
        description={
          deactivateDeps
            ? `${deactivateDeps.note}\n\n${deactivateDeps.active_batch_count} active hatch-date populations, ${deactivateDeps.total_live_birds} live birds.`
            : undefined
        }
        tone="danger"
        dismissible={!busy}
        onDismiss={() => {
          if (!busy) setDeactivateDeps(null);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: busy,
          onPress: () => setDeactivateDeps(null),
        }}
        primary={{
          label: "Deactivate",
          variant: "destructive",
          loading: busy,
          onPress: () => void confirmDeactivate(),
        }}
      />

      <AppDialog
        visible={reactivateOpen}
        title="Reactivate this shed?"
        description="New birds and schedules can be added again."
        tone="success"
        dismissible={!busy}
        onDismiss={() => {
          if (!busy) setReactivateOpen(false);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: busy,
          onPress: () => setReactivateOpen(false),
        }}
        primary={{
          label: "Reactivate",
          variant: "primary",
          loading: busy,
          onPress: () => void confirmReactivate(),
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  manageCard: {
    marginHorizontal: birdUi.horizontal,
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 8,
  },
  actionRow: { flexDirection: "row", gap: space.sm },
  notes: { fontSize: 14, color: birdUi.text },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    color: birdUi.muted,
    textTransform: "uppercase",
    marginTop: 4,
  },
  muted: { color: birdUi.muted, fontSize: 14 },
  assignLine: { fontSize: 14, color: birdUi.text, fontWeight: "600" },
  error: { color: birdUi.error, fontWeight: "600" },
});
