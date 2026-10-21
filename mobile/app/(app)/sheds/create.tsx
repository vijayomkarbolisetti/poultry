import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { StyleSheet, Text, Switch, View } from "react-native";
import { z } from "zod";

import { listFarmers, type Farmer } from "../../../src/api/farmers";
import { createShed } from "../../../src/api/sheds";
import { describeApiError } from "../../../src/api/client";
import { AddFarmerModal } from "../../../src/components/sheds/AddFarmerModal";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { SelectField } from "../../../src/components/ui/SelectField";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import {
  createShedPayload,
  isCreateShedButtonEnabled,
  mergeCreatedFarmerIntoList,
  resolveFarmerSelectionAfterRefresh,
  validateCreateShedDraft,
} from "../../../src/features/sheds/createShedForm";
import { colors, space } from "../../../src/theme/tokens";

const schema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  location_notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function CreateShedScreen() {
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const [ownerManaged, setOwnerManaged] = useState(true);
  const [farmerId, setFarmerId] = useState<string | null>(null);
  const [addFarmerOpen, setAddFarmerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const { control, handleSubmit, getValues } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", location_notes: "" },
  });

  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: !ownerManaged && !!ownerAccountId,
  });

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
    if (ownerManaged) {
      setFarmerId(null);
      return;
    }
    const next = resolveFarmerSelectionAfterRefresh(farmerId, farmerOptions, {
      // Keep auto-select while the farmers query refreshes after Add Farmer.
      isRefreshing: farmers.isLoading || farmers.isFetching,
    });
    if (next !== farmerId) setFarmerId(next);
  }, [ownerManaged, farmerId, farmerOptions, farmers.isLoading, farmers.isFetching]);

  const onToggleOwnerManaged = (value: boolean) => {
    setOwnerManaged(value);
    setError(null);
    if (value) setFarmerId(null);
  };

  const onFarmerCreated = (farmer: Farmer) => {
    // Seed cache before selecting so SelectField/options see membership_id immediately
    // (avoids clear-stale race that reset selection to "Select a farmer").
    qc.setQueryData<Farmer[]>(["farmers", ownerAccountId], (prev) =>
      mergeCreatedFarmerIntoList(prev ?? [], farmer),
    );
    setFarmerId(farmer.membership_id);
    setAddFarmerOpen(false);
    setError(null);
    void qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
  };

  const onSubmit = handleSubmit(async (values) => {
    if (submitting.current || loading) return;
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
      const shed = await createShed(createShedPayload(draft));
      // Await list/dashboard invalidation so the next screen does not flash stale empty state.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] }),
        qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] }),
        qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] }),
      ]);
      // Explicit params avoid Expo Router string|string[] ambiguity on dynamic [id] routes.
      router.replace({ pathname: "/(app)/sheds/[id]", params: { id: shed.id } });
    } catch (e: unknown) {
      setError(describeApiError(e, "create the shed"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  });

  return (
    <Screen scroll>
      <TextField control={control} name="name" label="Shed name" placeholder="North Barn" autoCapitalize="words" />
      <TextField control={control} name="code" label="Code" placeholder="N1" autoCapitalize="characters" />
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
              ? "You manage this shed. No farmer assignment required."
              : "A farmer must be assigned to manage this shed."}
          </Text>
        </View>
        <Switch
          value={ownerManaged}
          onValueChange={onToggleOwnerManaged}
          trackColor={{ true: colors.brandSoft, false: colors.border }}
          thumbColor={ownerManaged ? colors.brand : "#f4f4f4"}
        />
      </View>

      {!ownerManaged ? (
        <View style={styles.farmerBlock}>
          <SelectField
            label="Assigned farmer"
            required
            helper="Select the farmer responsible for managing this shed."
            placeholder="Select a farmer"
            value={farmerId}
            options={farmerOptions}
            onChange={setFarmerId}
            searchable
            loading={farmers.isLoading}
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
              // Preserve draft by staying on this screen — modal overlays without navigation.
              void getValues();
              setAddFarmerOpen(true);
            }}
          />
        </View>
      ) : null}

      {error && (ownerManaged || !error.toLowerCase().includes("farmer")) ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
      {error && !ownerManaged && error.toLowerCase().includes("farmer") && farmerId ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}

      <Button
        label="Create shed"
        onPress={onSubmit}
        loading={loading}
        disabled={!isCreateShedButtonEnabled(ownerManaged, farmerId, loading)}
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
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  switchLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  switchHint: { fontSize: 12, color: colors.inkMuted, marginTop: 2, lineHeight: 16 },
  farmerBlock: { gap: space.sm, marginBottom: space.sm },
  error: { color: colors.danger, marginBottom: space.sm },
});
