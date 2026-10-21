import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, StyleSheet, Text, Switch, View } from "react-native";
import { z } from "zod";

import { listFarmers, type Farmer } from "../../../../src/api/farmers";
import { getShedOverview, updateShed } from "../../../../src/api/sheds";
import { describeApiError } from "../../../../src/api/client";
import { AddFarmerModal } from "../../../../src/components/sheds/AddFarmerModal";
import { Button } from "../../../../src/components/ui/Button";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { Screen } from "../../../../src/components/ui/Screen";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { TextField } from "../../../../src/components/ui/TextField";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import {
  isCreateShedButtonEnabled,
  mergeCreatedFarmerIntoList,
  resolveFarmerSelectionAfterRefresh,
  validateCreateShedDraft,
} from "../../../../src/features/sheds/createShedForm";
import { firstRouteParam } from "../../../../src/navigation/routeParams";
import { colors, space } from "../../../../src/theme/tokens";

const schema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  location_notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

function invalidateShedQueries(
  qc: ReturnType<typeof useQueryClient>,
  ownerAccountId: string | null | undefined,
  shedId: string,
) {
  void qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] });
  void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
  void qc.invalidateQueries({ queryKey: ["shed-assignments", shedId] });
  void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
  void qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
  void qc.invalidateQueries({ queryKey: ["flocks"] });
}

export default function EditShedScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = firstRouteParam(params.id);
  const { user, ownerAccountId } = useAuth();
  const canUpdate = hasPermission(user, ownerAccountId, "shed.update");
  const qc = useQueryClient();
  const [ownerManaged, setOwnerManaged] = useState(true);
  const [farmerId, setFarmerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [addFarmerOpen, setAddFarmerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const { control, handleSubmit, getValues, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", location_notes: "" },
  });

  const overview = useQuery({
    queryKey: ["shed-overview", id],
    queryFn: () => getShedOverview(id!),
    enabled: !!id && canUpdate,
  });

  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: !ownerManaged && !!ownerAccountId && canUpdate,
  });

  // Reset hydration when navigating to a different shed edit route.
  useEffect(() => {
    setHydrated(false);
  }, [id]);

  useEffect(() => {
    if (!overview.data || hydrated) return;
    const { shed, assignments } = overview.data;
    reset({
      name: shed.name,
      code: shed.code,
      location_notes: shed.location_notes ?? "",
    });
    setOwnerManaged(shed.is_owner_managed);
    const manager = assignments.find((a) => a.is_manager && a.is_active);
    setFarmerId(manager?.owner_membership_id ?? assignments[0]?.owner_membership_id ?? null);
    setHydrated(true);
  }, [overview.data, hydrated, reset]);

  const farmerOptions = useMemo(
    () =>
      (farmers.data ?? [])
        .filter((f) => f.is_active && f.role === "farmer")
        .map((f) => ({
          value: f.membership_id,
          label: f.full_name,
          hint: f.email,
        })),
    [farmers.data],
  );

  useEffect(() => {
    // Do not clear/reconcile selection until the server shed has been applied.
    if (!hydrated) return;
    if (ownerManaged) {
      setFarmerId(null);
      return;
    }
    const next = resolveFarmerSelectionAfterRefresh(farmerId, farmerOptions, {
      isRefreshing: farmers.isLoading || farmers.isFetching,
    });
    if (next !== farmerId) setFarmerId(next);
  }, [ownerManaged, farmerId, farmerOptions, farmers.isLoading, farmers.isFetching, hydrated]);

  const onToggleOwnerManaged = (value: boolean) => {
    if (value && !ownerManaged) {
      Alert.alert(
        "Switch to owner-managed?",
        "Assigned farmers will lose access to this shed. You can reassign them later if needed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Switch",
            style: "destructive",
            onPress: () => {
              setOwnerManaged(true);
              setFarmerId(null);
              setError(null);
            },
          },
        ],
      );
      return;
    }
    setOwnerManaged(value);
    setError(null);
    if (value) setFarmerId(null);
  };

  const onFarmerCreated = (farmer: Farmer) => {
    qc.setQueryData<Farmer[]>(["farmers", ownerAccountId], (prev) =>
      mergeCreatedFarmerIntoList(prev ?? [], farmer),
    );
    setFarmerId(farmer.membership_id);
    setAddFarmerOpen(false);
    setError(null);
    void qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!id || !hydrated || submitting.current || loading) return;
    const draft = {
      name: values.name,
      code: values.code,
      location_notes: values.location_notes,
      is_owner_managed: ownerManaged,
      initial_farmer_membership_id: farmerId,
    };
    const validationError = validateCreateShedDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const payload: Parameters<typeof updateShed>[1] = {
        name: values.name.trim(),
        code: values.code.trim(),
        location_notes: values.location_notes?.trim() || "",
        is_owner_managed: ownerManaged,
      };
      if (!ownerManaged && farmerId) {
        payload.initial_farmer_membership_id = farmerId;
      }
      await updateShed(id, payload);
      invalidateShedQueries(qc, ownerAccountId, id);
      router.replace({ pathname: "/(app)/sheds/[id]", params: { id: id! } });
    } catch (e: unknown) {
      setError(describeApiError(e, "save the shed"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  });

  if (!canUpdate) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to edit sheds.</Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (overview.isLoading || !hydrated) {
    return (
      <Screen>
        <HenLoader label="Loading shed…" />
      </Screen>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(overview.error, "load the shed")}</Text>
        <Button label="Retry" onPress={() => overview.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.heading}>Edit shed</Text>
      {!overview.data.shed.is_active ? (
        <Text style={styles.inactiveNote}>This shed is inactive. You can still edit details and reactivate from the overview.</Text>
      ) : null}

      <TextField control={control} name="name" label="Shed name" autoCapitalize="words" />
      <TextField control={control} name="code" label="Code" autoCapitalize="characters" />
      <TextField
        control={control}
        name="location_notes"
        label="Location / notes"
        placeholder="Optional"
        autoCapitalize="sentences"
      />

      <View style={styles.row}>
        <View style={{ flex: 1, paddingRight: space.sm }}>
          <Text style={styles.switchLabel}>Owner-managed</Text>
          <Text style={styles.switchHint}>
            {ownerManaged
              ? "You manage this shed. Farmer assignments will be revoked on save."
              : "A farmer must be assigned to manage this shed."}
          </Text>
        </View>
        <Switch
          value={ownerManaged}
          onValueChange={onToggleOwnerManaged}
          disabled={!hydrated || loading}
          trackColor={{ true: colors.brandSoft, false: colors.border }}
          thumbColor={ownerManaged ? colors.brand : "#f4f4f4"}
        />
      </View>

      {!ownerManaged ? (
        <View style={styles.farmerBlock}>
          <SelectField
            label="Assigned farmer"
            required
            helper="Select or replace the farmer manager for this shed."
            placeholder="Select a farmer"
            value={farmerId}
            options={farmerOptions}
            onChange={setFarmerId}
            searchable
            loading={farmers.isLoading || !hydrated}
            allowValues={farmerId ? [farmerId] : []}
            emptyMessage="No eligible farmers yet. Add a farmer first."
            onRetry={() => farmers.refetch()}
            error={
              farmers.isError
                ? describeApiError(farmers.error, "load farmers")
                : !farmerId && error?.toLowerCase().includes("farmer")
                  ? error
                  : undefined
            }
          />
          <Button
            label="+ Add Farmer"
            variant="secondary"
            onPress={() => {
              void getValues();
              setAddFarmerOpen(true);
            }}
            disabled={!hydrated || loading}
          />
        </View>
      ) : null}

      {error && (ownerManaged || !error.toLowerCase().includes("farmer") || farmerId) ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}

      <Button
        label="Save changes"
        onPress={onSubmit}
        loading={loading}
        disabled={!hydrated || !isCreateShedButtonEnabled(ownerManaged, farmerId, loading)}
      />

      <AddFarmerModal
        visible={addFarmerOpen}
        onClose={() => setAddFarmerOpen(false)}
        onCreated={onFarmerCreated}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 20, fontWeight: "800", color: colors.brand, marginBottom: space.sm },
  inactiveNote: { color: colors.accent, marginBottom: space.sm, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  switchLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  switchHint: { fontSize: 12, color: colors.inkMuted, marginTop: 2, lineHeight: 16 },
  farmerBlock: { gap: space.sm, marginBottom: space.sm },
  error: { color: colors.danger, marginBottom: space.sm },
});
