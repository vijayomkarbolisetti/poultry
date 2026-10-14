import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { createFlock } from "../../../src/api/flocks";
import { describeApiError } from "../../../src/api/client";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

const schema = z.object({
  batch_code: z.string().min(1),
  initial_count: z.string().min(1),
  estimated_age_days: z.string().optional(),
  breed: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function CreateFlockScreen() {
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: listSheds });
  const [shedId, setShedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"batch" | "individual" | "mixed">("batch");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { batch_code: "", initial_count: "100", estimated_age_days: "45", breed: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!shedId) {
      setError("Select a shed");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const count = Number(values.initial_count);
      const age = values.estimated_age_days ? Number(values.estimated_age_days) : undefined;
      const flock = await createFlock({
        shed_id: shedId,
        batch_code: values.batch_code,
        initial_count: count,
        tracking_mode: mode,
        dob_confidence: age != null ? "estimated" : "unknown",
        estimated_age_days: age,
        age_reported_on: age != null ? new Date().toISOString().slice(0, 10) : undefined,
        breed: values.breed || undefined,
        unbanded_count: mode === "individual" ? 0 : count,
      });
      void qc.invalidateQueries({ queryKey: ["flocks", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      router.replace(`/(app)/flocks/${flock.id}`);
    } catch (e: unknown) {
      setError(describeApiError(e, "create the flock"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <Text style={styles.section}>Shed</Text>
      {(sheds.data ?? []).map((s) => (
        <Pressable key={s.id} style={[styles.chip, shedId === s.id && styles.chipOn]} onPress={() => setShedId(s.id)}>
          <Text style={styles.chipText}>{s.name}</Text>
        </Pressable>
      ))}
      <Text style={styles.section}>Tracking mode</Text>
      {(["batch", "individual", "mixed"] as const).map((m) => (
        <Pressable key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(m)}>
          <Text style={styles.chipText}>{m}</Text>
        </Pressable>
      ))}
      <TextField control={control} name="batch_code" label="Batch code" autoCapitalize="characters" />
      <TextField control={control} name="initial_count" label="Initial count" keyboardType="default" />
      <TextField control={control} name="estimated_age_days" label="Estimated age (days)" />
      <TextField control={control} name="breed" label="Breed (optional)" autoCapitalize="words" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Create flock" onPress={onSubmit} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  section: { fontSize: 13, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase" },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.sm,
    backgroundColor: colors.bgElevated,
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { color: colors.ink, fontWeight: "600" },
  error: { color: colors.danger },
});
