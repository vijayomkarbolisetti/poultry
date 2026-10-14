import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { createFarmer } from "../../../src/api/farmers";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

const DEFAULT_FARMER_PERMS = [
  "shed.view",
  "flock.view",
  "bird.view",
  "vaccination.view",
  "vaccination.record",
  "schedule.view",
  "report.view",
  "lifecycle.record",
];

const schema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function CreateFarmerScreen() {
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: listSheds });
  const [selectedSheds, setSelectedSheds] = useState<string[]>([]);
  const [perms, setPerms] = useState<string[]>(DEFAULT_FARMER_PERMS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: "" },
  });

  const toggleShed = (id: string) => {
    setSelectedSheds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const togglePerm = (code: string) => {
    setPerms((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  };

  const permOptions = useMemo(() => DEFAULT_FARMER_PERMS, []);

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    try {
      await createFarmer({
        ...values,
        role: "farmer",
        permission_codes: perms,
        shed_ids: selectedSheds,
      });
      await qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
      await qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      router.replace("/(app)/farmers/index");
    } catch (e: unknown) {
      setError(String((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <Text style={styles.title}>Add farmer</Text>
      <TextField control={control} name="full_name" label="Full name" autoCapitalize="words" />
      <TextField control={control} name="email" label="Email" keyboardType="email-address" />
      <TextField control={control} name="password" label="Temp password" secureTextEntry />

      <Text style={styles.section}>Assign sheds</Text>
      {(sheds.data ?? []).map((s) => {
        const on = selectedSheds.includes(s.id);
        return (
          <Pressable key={s.id} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleShed(s.id)}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>
              {s.name} ({s.code})
            </Text>
          </Pressable>
        );
      })}

      <Text style={styles.section}>Permissions</Text>
      {permOptions.map((code) => {
        const on = perms.includes(code);
        return (
          <Pressable key={code} style={[styles.chip, on && styles.chipOn]} onPress={() => togglePerm(code)}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{code}</Text>
          </Pressable>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Create farmer" onPress={onSubmit} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  section: { fontSize: 13, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase", marginTop: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.sm,
    backgroundColor: colors.bgElevated,
  },
  chipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  chipText: { color: colors.ink },
  chipTextOn: { color: colors.brand, fontWeight: "700" },
  error: { color: colors.danger },
});
