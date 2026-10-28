import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { createFarmer } from "../../../src/api/farmers";
import { describeApiError } from "../../../src/api/client";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { MultiSelectField } from "../../../src/components/ui/MultiSelectField";
import { Screen } from "../../../src/components/ui/Screen";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { FARMER_PERM_OPTIONS, PERMISSION_LABELS, hasPermission } from "../../../src/features/auth/permissions";
import { colors, radius, shadow, space } from "../../../src/theme/tokens";

const DEFAULT_FARMER_PERMS = [
  "shed.view",
  "flock.view",
  "bird.view",
  "report.view",
];

const schema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function CreateFarmerScreen() {
  const { ownerAccountId, user } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const qc = useQueryClient();
  const sheds = useQuery({
    queryKey: ["sheds", ownerAccountId],
    queryFn: () => listSheds(),
    enabled: canManage,
  });
  const [selectedSheds, setSelectedSheds] = useState<string[]>([]);
  const [perms, setPerms] = useState<string[]>(DEFAULT_FARMER_PERMS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: "" },
  });

  const shedOptions = useMemo(
    () =>
      (sheds.data ?? [])
        .filter((s) => s.is_active)
        .map((s) => ({ value: s.id, label: s.name, hint: s.code })),
    [sheds.data],
  );

  const togglePerm = (code: string) => {
    setPerms((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  };

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    try {
      const validShedIds = selectedSheds.filter((id) => shedOptions.some((o) => o.value === id));
      const farmer = await createFarmer({
        ...values,
        role: "farmer",
        permission_codes: perms,
        shed_ids: validShedIds,
      });
      void qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      router.replace(`/(app)/farmers/${farmer.membership_id}`);
    } catch (e: unknown) {
      setError(describeApiError(e, "add the farmer"));
    } finally {
      setLoading(false);
    }
  });

  if (!canManage) return <Redirect href="/(app)/home" />;

  return (
    <Screen scroll>
      <Text style={styles.hint}>
        Create a farmer login, assign sheds, and choose only the permissions they need. You can change these later.
      </Text>

      <TextField control={control} name="full_name" label="Full name" autoCapitalize="words" leftIcon="person-outline" />
      <TextField control={control} name="email" label="Email" keyboardType="email-address" leftIcon="mail-outline" />
      <TextField control={control} name="password" label="Temp password" secureTextEntry leftIcon="lock-closed-outline" />

      <MultiSelectField
        label="Assign sheds"
        helper="Farmers only see sheds you assign here."
        values={selectedSheds}
        options={shedOptions}
        onChange={setSelectedSheds}
        searchable
        emptyMessage={sheds.isLoading ? "Loading sheds…" : "No sheds yet — create a shed first."}
      />

      <Text style={styles.section}>Permissions</Text>
      <Text style={styles.meta}>Toggle on only what this farmer should access.</Text>
      <View style={[styles.card, shadow.card]}>
        {FARMER_PERM_OPTIONS.map((code) => {
          const on = perms.includes(code);
          const label = PERMISSION_LABELS[code];
          return (
            <Pressable key={code} style={[styles.permRow, on && styles.permRowOn]} onPress={() => togglePerm(code)}>
              <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.permTitle}>{label?.title ?? code}</Text>
                <Text style={styles.permHint}>{label?.hint ?? code}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Create farmer" onPress={onSubmit} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  section: { fontSize: 13, fontWeight: "800", color: colors.inkMuted, textTransform: "uppercase", marginTop: space.sm },
  meta: { color: colors.inkMuted, fontSize: 13, marginTop: -space.sm },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  permRow: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    padding: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  permRowOn: { backgroundColor: "#F3FBF6" },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkMark: { color: "#fff", fontWeight: "800", fontSize: 13 },
  permTitle: { fontWeight: "700", color: colors.ink, fontSize: 15 },
  permHint: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  error: { color: colors.danger },
});
