import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { bulkImportBirds, createBird, getFlock, listBirds, recordLifecycle } from "../../../src/api/flocks";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function FlockDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const flock = useQuery({ queryKey: ["flock", id], queryFn: () => getFlock(id!), enabled: !!id });
  const birds = useQuery({ queryKey: ["birds", id], queryFn: () => listBirds(id!), enabled: !!id });
  const [bandId, setBandId] = useState("");
  const [bulkText, setBulkText] = useState("B10\nB11\nB12");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    void qc.invalidateQueries({ queryKey: ["flock", id] });
    void qc.invalidateQueries({ queryKey: ["birds", id] });
    void qc.invalidateQueries({ queryKey: ["flocks", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
  };

  const onAddBird = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await createBird({ flock_id: id, band_id: bandId, dob_confidence: "unknown" });
      setBandId("");
      await refresh();
      setMsg("Bird added");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "save"));
    } finally {
      setBusy(false);
    }
  };

  const onBulk = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const rows = bulkText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((band_id) => ({ band_id }));
      const result = await bulkImportBirds({
        flock_id: id!,
        idempotency_key: `ui-${id}-${Date.now()}`,
        rows,
      });
      await refresh();
      setMsg(`Bulk: created ${result.created}, failed ${result.failed}`);
    } catch (e: unknown) {
      setMsg(describeApiError(e, "import birds"));
    } finally {
      setBusy(false);
    }
  };

  const onMortality = async (birdId: string) => {
    setBusy(true);
    try {
      await recordLifecycle({
        event_type: "mortality",
        effective_date: new Date().toISOString().slice(0, 10),
        bird_id: birdId,
        quantity: 1,
        reason: "Recorded from app",
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (flock.isLoading) return <Screen><Text>Loading…</Text></Screen>;
  if (!flock.data) return <Screen><Text style={styles.error}>Flock not found</Text></Screen>;
  const f = flock.data;

  return (
    <Screen scroll>
      <Text style={styles.title}>{f.batch_code}</Text>
      <View style={styles.card}>
        <Text style={styles.meta}>Mode: {f.tracking_mode}</Text>
        <Text style={styles.meta}>
          Count: {f.current_count} (banded {f.banded_count} / unbanded {f.unbanded_count})
        </Text>
        <Text style={styles.meta}>
          DOB: {f.dob_confidence}
          {f.hatch_date ? ` · hatch ${f.hatch_date}` : ""}
          {f.estimated_age_days != null ? ` · ~${f.estimated_age_days}d` : ""}
        </Text>
        {f.count_mismatch ? <Text style={styles.error}>Count mismatch flagged</Text> : null}
      </View>

      <Text style={styles.section}>Add banded bird</Text>
      <TextInput style={styles.input} value={bandId} onChangeText={setBandId} placeholder="Band ID" autoCapitalize="characters" />
      <Button label="Add bird" onPress={onAddBird} loading={busy} disabled={!bandId} />

      <Text style={styles.section}>Bulk import (one band ID per line)</Text>
      <TextInput style={[styles.input, { minHeight: 90 }]} multiline value={bulkText} onChangeText={setBulkText} />
      <Button label="Import bands" onPress={onBulk} loading={busy} variant="secondary" />

      <Text style={styles.section}>Birds ({birds.data?.length ?? 0})</Text>
      {(birds.data ?? []).map((b) => (
        <View key={b.id} style={styles.card}>
          <Text style={styles.name}>{b.band_id ?? b.id.slice(0, 8)}</Text>
          <Text style={styles.meta}>{b.lifecycle_status}</Text>
          {b.is_active ? (
            <Button label="Record mortality" variant="danger" onPress={() => onMortality(b.id)} loading={busy} />
          ) : null}
        </View>
      ))}
      {msg ? <Text style={styles.meta}>{msg}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand },
  section: { marginTop: space.sm, fontSize: 13, fontWeight: "700", color: colors.inkMuted, textTransform: "uppercase" },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { fontWeight: "700", color: colors.ink },
  meta: { color: colors.inkMuted, fontSize: 14 },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    color: colors.ink,
  },
  error: { color: colors.danger },
});
