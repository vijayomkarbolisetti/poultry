import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { createVaccine, listVaccines } from "../../../src/api/vaccines";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function VaccinesScreen() {
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const vaccines = useQuery({ queryKey: ["vaccines", ownerAccountId], queryFn: listVaccines });
  const [name, setName] = useState("");
  const [ageDays, setAgeDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onCreate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await createVaccine({
        name,
        rules: [{ target_age_days: Number(ageDays) || 1, grace_period_days: 0, reminder_lead_days: 3 }],
      });
      setName("");
      void qc.invalidateQueries({ queryKey: ["vaccines", ownerAccountId] });
      setMsg("Vaccine created (example schedule — confirm with your vet)");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "create the vaccine"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.form}>
        <Text style={styles.formTitle}>Add a vaccine</Text>
        <Text style={styles.label}>Vaccine name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Newcastle (Lasota)"
          placeholderTextColor={colors.inkMuted}
          value={name}
          onChangeText={setName}
        />
        <Text style={styles.label}>Give at bird age (days)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 7"
          placeholderTextColor={colors.inkMuted}
          value={ageDays}
          onChangeText={setAgeDays}
          keyboardType="number-pad"
        />
        <Text style={styles.note}>
          Reminder 3 days before. Schedules are set by you — confirm doses with your vet.
        </Text>
        <Button label="Add vaccine" onPress={onCreate} loading={busy} disabled={!name.trim()} />
        {msg ? <Text style={styles.meta}>{msg}</Text> : null}
      </View>
      <Text style={styles.section}>
        Your vaccines{vaccines.data ? ` (${vaccines.data.length})` : ""}
      </Text>
      <FlatList
        data={vaccines.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 40 }}
        ListEmptyComponent={
          vaccines.isLoading ? null : <Text style={styles.meta}>No vaccines yet. Add your first one above.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.category}</Text>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
  },
  formTitle: { fontSize: 17, fontWeight: "800", color: colors.ink, marginBottom: space.xs },
  label: { fontSize: 14, fontWeight: "600", color: colors.ink },
  section: { fontSize: 13, fontWeight: "800", color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  note: { color: colors.inkMuted, fontSize: 13, marginBottom: space.sm },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    color: colors.ink,
    fontSize: 16,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { fontWeight: "700", color: colors.ink },
  meta: { color: colors.inkMuted, fontSize: 13 },
});
