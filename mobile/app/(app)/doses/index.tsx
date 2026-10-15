import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { listFlocks } from "../../../src/api/flocks";
import { describeApiError } from "../../../src/api/client";
import {
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

type DoseRow = {
  id: string;
  dose_number: number;
  status: string;
  due_date: string;
  completed_count: number;
  eligible_count: number;
};

function summarize(doses: DoseRow[]) {
  let on_time = 0;
  let late = 0;
  let overdue = 0;
  let due_today = 0;
  for (const d of doses) {
    if (d.status === "completed_on_time") on_time += 1;
    else if (d.status === "completed_late") late += 1;
    else if (d.status === "overdue") overdue += 1;
    else if (d.status === "due_today") due_today += 1;
  }
  return {
    on_time,
    late,
    overdue,
    due_today,
    compliance_numerator: on_time,
    compliance_denominator: on_time + late + overdue,
  };
}

export default function DosesScreen() {
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const doses = useQuery({
    queryKey: ["doses", ownerAccountId],
    queryFn: () => listScheduledDoses() as Promise<DoseRow[]>,
  });
  const notes = useQuery({
    queryKey: ["notifications", ownerAccountId],
    queryFn: listNotifications,
  });
  // Loaded only when generating schedules — avoids 2 extra API calls on every tab open.
  const flocks = useQuery({
    queryKey: ["flocks", ownerAccountId],
    queryFn: () => listFlocks(),
    enabled: false,
  });
  const vaccines = useQuery({
    queryKey: ["vaccines", ownerAccountId],
    queryFn: listVaccines,
    enabled: false,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const c = useMemo(() => summarize(doses.data ?? []), [doses.data]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["doses", ownerAccountId] }),
      qc.invalidateQueries({ queryKey: ["notifications", ownerAccountId] }),
      qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] }),
    ]);
  };

  const onGenerate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const [flockRes, vaxRes] = await Promise.all([flocks.refetch(), vaccines.refetch()]);
      const flock = flockRes.data?.[0];
      const vaxIds = (vaxRes.data ?? []).map((v: { id: string }) => v.id);
      if (!flock || !vaxIds.length) {
        setMsg("Create a flock and vaccine first");
        return;
      }
      await generateSchedules(flock.id, vaxIds);
      await generateNotifications();
      await refresh();
      setMsg("Schedules + alerts generated for first flock");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "save"));
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

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.meta}>
          On-time {c.on_time} · Late {c.late} · Overdue {c.overdue} · Due today {c.due_today}
        </Text>
        <Text style={styles.meta}>
          Compliance {c.compliance_numerator}/{c.compliance_denominator}
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
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ gap: space.sm, paddingBottom: 80 }}
        ListEmptyComponent={<Text style={styles.meta}>{doses.isLoading ? "Loading…" : "No doses yet"}</Text>}
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
