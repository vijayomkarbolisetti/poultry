import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { listFlocks } from "../../../src/api/flocks";
import {
  fetchCompliance,
  generateNotifications,
  generateSchedules,
  listNotifications,
  listScheduledDoses,
  listVaccines,
  markNotificationRead,
  recordVaccination,
} from "../../../src/api/vaccines";
import { Button } from "../../../src/components/ui/Button";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../../src/theme/tokens";

export default function DosesScreen() {
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const doses = useQuery({ queryKey: ["doses", ownerAccountId], queryFn: () => listScheduledDoses() });
  const compliance = useQuery({ queryKey: ["compliance", ownerAccountId], queryFn: fetchCompliance });
  const notes = useQuery({ queryKey: ["notifications", ownerAccountId], queryFn: listNotifications });
  const flocks = useQuery({ queryKey: ["flocks", ownerAccountId], queryFn: () => listFlocks() });
  const vaccines = useQuery({ queryKey: ["vaccines", ownerAccountId], queryFn: listVaccines });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["doses", ownerAccountId] });
    await qc.invalidateQueries({ queryKey: ["compliance", ownerAccountId] });
    await qc.invalidateQueries({ queryKey: ["notifications", ownerAccountId] });
    await qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
  };

  const onGenerate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const flock = flocks.data?.[0];
      const vaxIds = (vaccines.data ?? []).map((v) => v.id);
      if (!flock || !vaxIds.length) {
        setMsg("Create a flock and vaccine first");
        return;
      }
      await generateSchedules(flock.id, vaxIds);
      await generateNotifications();
      await refresh();
      setMsg("Schedules + alerts generated for first flock");
    } catch (e: unknown) {
      setMsg(String((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed"));
    } finally {
      setBusy(false);
    }
  };

  const onRecord = async (doseId: string) => {
    setBusy(true);
    try {
      await recordVaccination({
        scheduled_dose_id: doseId,
        birds_covered: 1,
        administration_date: new Date().toISOString().slice(0, 10),
        idempotency_key: `ui-${doseId}-${Date.now()}`,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const c = compliance.data;

  return (
    <Screen>
      <Text style={styles.title}>Doses & compliance</Text>
      <View style={styles.card}>
        <Text style={styles.meta}>
          On-time {c?.on_time ?? "—"} · Late {c?.late ?? "—"} · Overdue {c?.overdue ?? "—"} · Due today {c?.due_today ?? "—"}
        </Text>
        <Text style={styles.meta}>
          Compliance {c?.compliance_numerator ?? 0}/{c?.compliance_denominator ?? 0}
        </Text>
      </View>
      <Button label="Generate schedules + alerts" onPress={onGenerate} loading={busy} />
      {msg ? <Text style={styles.meta}>{msg}</Text> : null}

      <Text style={styles.section}>Alerts</Text>
      {(notes.data ?? []).slice(0, 5).map((n) => (
        <View key={n.id} style={styles.card}>
          <Text style={styles.name}>{n.title}</Text>
          <Text style={styles.meta}>{n.body}</Text>
          {!n.is_read ? (
            <Button label="Mark read" variant="secondary" onPress={() => markNotificationRead(n.id).then(refresh)} />
          ) : null}
        </View>
      ))}

      <Text style={styles.section}>Scheduled doses</Text>
      <FlatList
        data={doses.data ?? []}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 80 }}
        ListEmptyComponent={<Text style={styles.meta}>No doses yet</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name}>
              Dose #{item.dose_number} · {item.status}
            </Text>
            <Text style={styles.meta}>
              Due {item.due_date} · covered {item.completed_count}/{item.eligible_count}
            </Text>
            {!item.status.startsWith("completed") ? (
              <Button label="Record vaccination" onPress={() => onRecord(item.id)} loading={busy} />
            ) : null}
          </View>
        )}
      />
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
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
    marginBottom: space.xs,
  },
  name: { fontWeight: "700", color: colors.ink },
  meta: { color: colors.inkMuted, fontSize: 13 },
});
