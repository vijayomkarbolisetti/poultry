import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { StyleSheet, Text, Switch, View } from "react-native";
import { z } from "zod";

import { createShed } from "../../../src/api/sheds";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "", location_notes: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    try {
      const shed = await createShed({
        name: values.name,
        code: values.code,
        location_notes: values.location_notes || undefined,
        is_owner_managed: ownerManaged,
      });
      void qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      router.replace(`/(app)/sheds/${shed.id}`);
    } catch (e: unknown) {
      setError(describeApiError(e, "create the shed"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <TextField control={control} name="name" label="Shed name" placeholder="North Barn" autoCapitalize="words" />
      <TextField control={control} name="code" label="Code" placeholder="N1" autoCapitalize="characters" />
      <TextField control={control} name="location_notes" label="Location / notes" placeholder="Optional" autoCapitalize="sentences" />
      <View style={styles.row}>
        <Text style={styles.switchLabel}>Owner-managed</Text>
        <Switch
          value={ownerManaged}
          onValueChange={setOwnerManaged}
          trackColor={{ true: colors.brandSoft, false: colors.border }}
          thumbColor={ownerManaged ? colors.brand : "#f4f4f4"}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Create shed" onPress={onSubmit} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  error: { color: colors.danger },
});
