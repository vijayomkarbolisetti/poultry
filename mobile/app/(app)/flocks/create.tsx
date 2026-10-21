import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { StyleSheet, Text } from "react-native";
import { z } from "zod";

import { createFlock } from "../../../src/api/flocks";
import { describeApiError } from "../../../src/api/client";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { DateField } from "../../../src/components/ui/DateField";
import { RadioChips } from "../../../src/components/ui/RadioChips";
import { Screen } from "../../../src/components/ui/Screen";
import { SelectField } from "../../../src/components/ui/SelectField";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors } from "../../../src/theme/tokens";

const schema = z
  .object({
    batch_code: z.string().min(1, "Required"),
    initial_count: z.string().min(1, "Required"),
    estimated_age_days: z.string().optional(),
    breed: z.string().optional(),
  })
  .superRefine((vals, ctx) => {
    const count = Number(vals.initial_count);
    if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a whole number ≥ 0", path: ["initial_count"] });
    }
  });

type FormValues = z.infer<typeof schema>;

const DOB_OPTIONS = [
  { value: "exact", label: "Exact hatch date", hint: "You know the hatch / DOB day" },
  { value: "estimated", label: "Estimated age", hint: "Age in days is approximate" },
  { value: "unknown", label: "Unknown", hint: "Age unknown — schedules may need review" },
];

const MODE_OPTIONS = [
  { value: "batch", label: "Batch counts", hint: "Track by headcount in the batch" },
  { value: "individual", label: "Individual", hint: "Track banded birds" },
  { value: "mixed", label: "Mixed", hint: "Banded + unbanded together" },
];

export default function CreateFlockScreen() {
  const { shedId: shedIdParam } = useLocalSearchParams<{ shedId?: string }>();
  const lockedShedId = typeof shedIdParam === "string" && shedIdParam.length > 0 ? shedIdParam : null;
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: () => listSheds() });
  const [shedId, setShedId] = useState<string | null>(lockedShedId);
  const [shedError, setShedError] = useState<string | null>(null);

  useEffect(() => {
    if (lockedShedId) setShedId(lockedShedId);
  }, [lockedShedId]);
  const [mode, setMode] = useState<"batch" | "individual" | "mixed">("batch");
  const [dobConfidence, setDobConfidence] = useState<"exact" | "estimated" | "unknown">("estimated");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [dobError, setDobError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { batch_code: "", initial_count: "100", estimated_age_days: "45", breed: "" },
  });

  const shedOptions = useMemo(() => {
    const rows = (sheds.data ?? [])
      .filter((s) => s.is_active)
      .filter((s) => (lockedShedId ? s.id === lockedShedId : true))
      .map((s) => ({
        value: s.id,
        label: s.name,
        hint: `${s.code}${s.is_owner_managed ? " · owner-managed" : " · farmer-managed"}`,
      }));
    return rows;
  }, [sheds.data, lockedShedId]);

  const onDobChange = (v: string) => {
    const next = v as typeof dobConfidence;
    setDobConfidence(next);
    setDobError(null);
    if (next === "exact") {
      setValue("estimated_age_days", "");
    } else if (next === "estimated") {
      setHatchDate(null);
      setValue("estimated_age_days", "45");
    } else {
      setHatchDate(null);
      setValue("estimated_age_days", "");
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!shedId) {
      setShedError("Select a shed");
      return;
    }
    if (dobConfidence === "exact" && !hatchDate) {
      setDobError("Hatch date is required for exact DOB");
      return;
    }
    if (dobConfidence === "estimated") {
      const age = Number(values.estimated_age_days);
      if (!Number.isFinite(age) || age < 0 || !Number.isInteger(age)) {
        setDobError("Estimated age (days) is required");
        return;
      }
    }
    setLoading(true);
    setError(null);
    setShedError(null);
    setDobError(null);
    try {
      const count = Number(values.initial_count);
      const age =
        dobConfidence === "estimated" && values.estimated_age_days
          ? Number(values.estimated_age_days)
          : undefined;
      const flock = await createFlock({
        shed_id: shedId,
        batch_code: values.batch_code,
        initial_count: count,
        tracking_mode: mode,
        dob_confidence: dobConfidence,
        hatch_date: dobConfidence === "exact" ? hatchDate : undefined,
        estimated_age_days: age,
        age_reported_on: age != null ? new Date().toISOString().slice(0, 10) : undefined,
        breed: values.breed || undefined,
        unbanded_count: mode === "individual" ? 0 : count,
      });
      void qc.invalidateQueries({ queryKey: ["flocks", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      if (lockedShedId) {
        void qc.invalidateQueries({ queryKey: ["shed-overview", lockedShedId] });
        router.replace(`/(app)/sheds/${lockedShedId}`);
      } else {
        router.replace(`/(app)/flocks/${flock.id}`);
      }
    } catch (e: unknown) {
      setError(describeApiError(e, "create the batch"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <SelectField
        label="Shed"
        required
        searchable={!lockedShedId}
        disabled={Boolean(lockedShedId)}
        placeholder="Choose shed"
        value={shedId}
        options={shedOptions}
        onChange={(v) => {
          if (lockedShedId) return;
          setShedId(v);
          setShedError(null);
        }}
        loading={sheds.isLoading}
        error={shedError ?? (sheds.isError ? "Could not load sheds" : undefined)}
        onRetry={() => sheds.refetch()}
        emptyMessage="No active sheds yet — create a shed first"
        helper={
          lockedShedId
            ? "This batch will be created in the selected shed"
            : "Required — batches belong to one shed"
        }
      />

      <RadioChips
        label="Tracking mode"
        required
        value={mode}
        options={MODE_OPTIONS}
        onChange={(v) => setMode(v as typeof mode)}
      />

      <RadioChips
        label="Date of birth confidence"
        required
        value={dobConfidence}
        options={DOB_OPTIONS}
        onChange={onDobChange}
        error={dobError ?? undefined}
        helper="Schedules use hatch date or estimated age when available"
      />

      {dobConfidence === "exact" ? (
        <DateField
          label="Hatch / DOB date"
          required
          value={hatchDate}
          onChange={(v) => {
            setHatchDate(v);
            setDobError(null);
          }}
          error={dobError ?? undefined}
        />
      ) : null}

      {dobConfidence === "estimated" ? (
        <TextField control={control} name="estimated_age_days" label="Estimated age (days)" />
      ) : null}

      <TextField control={control} name="batch_code" label="Batch code" autoCapitalize="characters" />
      <TextField control={control} name="initial_count" label="Initial count" keyboardType="default" />
      <TextField control={control} name="breed" label="Breed (optional)" autoCapitalize="words" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Create batch" onPress={onSubmit} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
});
