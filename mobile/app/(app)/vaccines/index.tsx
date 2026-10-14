import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";

import { createVaccine, listVaccines } from "../../../src/api/vaccines";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function VaccinesScreen() {
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const vaccines = useQuery({ queryKey: ["vaccines", ownerAccountId], queryFn: listVaccines });
  const [name, setName] = useState("");
  const [ageDays, setAgeDays] = useState("1");
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
      await qc.invalidateQueries({ queryKey: ["vaccines", ownerAccountId] });
      setMsg("Vaccine created (example schedule — confirm with your vet)");
    } catch (e: unknown) {
      setMsg(String((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.title}>Vaccine catalogue</Text>
      <Text style={styles.note}>Schedules are owner-configured. Examples are not universal medical advice.</Text>
      <TextInput style={styles.input} placeholder="Vaccine name" value={name} onChangeText={setName} />
      <TextInput style={styles.input} placeholder="Target age (days)" value={ageDays} onChangeText={setAgeDays} keyboardType="number-pad" />
      <Button label="Add vaccine + day rule" onPress={onCreate} loading={busy} disabled={!name} />
      {msg ? <Text style={styles.meta}>{msg}</Text> : null}
      <FlatList
        data={vaccines.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: space.sm, paddingTop: space.md, paddingBottom: 40 }}
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
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  note: { color: colors.inkMuted, fontSize: 13, marginBottom: space.sm },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    color: colors.ink,
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
