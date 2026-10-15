import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

import { listFlocks, type Flock } from "../../../src/api/flocks";
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
import { SelectField } from "../../../src/components/ui/SelectField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { colors, radius, shadow, space } from "../../../src/theme/tokens";

type DoseRow = {
  id: string;
  flock_id: string;
  vaccine_definition_id: string;
  dose_number: number;
  status: string;
  due_date: string;
  completed_count: number;
  eligible_count: number;
};

type StatusKey = "all" | "needs_action" | "due_today" | "overdue" | "upcoming" | "completed";

const STATUS_META: Record<
  string,
  { label: string; hint: string; tone: "neutral" | "warn" | "danger" | "good" | "info" }
> = {
  upcoming: { label: "Upcoming", hint: "Not due yet — plan ahead", tone: "info" },
  due_soon: { label: "Due soon", hint: "Coming up in the next few days", tone: "warn" },
  due_today: { label: "Due today", hint: "Vaccinate today", tone: "warn" },
  overdue: { label: "Overdue", hint: "Past due — do this as soon as possible", tone: "danger" },
  completed_on_time: { label: "Done on time", hint: "Recorded on or before due date", tone: "good" },
  completed_late: { label: "Done late", hint: "Recorded after the due date", tone: "warn" },
  completed_timing_unknown: { label: "Done", hint: "Completed (timing unknown)", tone: "good" },
  needs_review: { label: "Needs review", hint: "Check bird age / history before vaccinating", tone: "warn" },
  skipped: { label: "Skipped", hint: "Marked as not required", tone: "neutral" },
  inactive: { label: "Inactive", hint: "Flock closed or dose inactive", tone: "neutral" },
};

const FILTER_OPTIONS = [
  { value: "all", label: "All tasks", hint: "Everything on the schedule" },
  { value: "needs_action", label: "Needs action", hint: "Due today + overdue + due soon" },
  { value: "due_today", label: "Due today", hint: "Only today’s work" },
  { value: "overdue", label: "Overdue", hint: "Past the due date" },
  { value: "upcoming", label: "Upcoming", hint: "Future doses" },
  { value: "completed", label: "Completed", hint: "Already recorded" },
];

function toneColor(tone: string) {
  if (tone === "danger") return colors.danger;
  if (tone === "warn") return colors.accent;
  if (tone === "good") return colors.success;
  if (tone === "info") return colors.info;
  return colors.inkMuted;
}

function statusInfo(status: string) {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " "), hint: "", tone: "neutral" as const };
}

function matchesFilter(status: string, filter: StatusKey) {
  if (filter === "all") return true;
  if (filter === "needs_action") return ["due_today", "due_soon", "overdue", "needs_review"].includes(status);
  if (filter === "due_today") return status === "due_today";
  if (filter === "overdue") return status === "overdue";
  if (filter === "upcoming") return status === "upcoming" || status === "due_soon";
  if (filter === "completed") return status.startsWith("completed");
  return true;
}

function flockLabel(f: Flock) {
  const birds = `${f.current_count} birds`;
  const breed = f.breed ? ` · ${f.breed}` : "";
  return `${f.batch_code}${breed} · ${birds}`;
}

export default function DosesScreen() {
  const { ownerAccountId, user } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "schedule.manage");
  const canRecord = hasPermission(user, ownerAccountId, "vaccination.record");
  const qc = useQueryClient();

  const [filter, setFilter] = useState<StatusKey>("needs_action");
  const [flockFilter, setFlockFilter] = useState<string | null>("all");
  const [planFlockId, setPlanFlockId] = useState<string | null>(null);
  const [planVaccineId, setPlanVaccineId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const doses = useQuery({
    queryKey: ["doses", ownerAccountId],
    queryFn: () => listScheduledDoses() as Promise<DoseRow[]>,
  });
  const notes = useQuery({
    queryKey: ["notifications", ownerAccountId],
    queryFn: listNotifications,
  });
  const flocks = useQuery({
    queryKey: ["flocks", ownerAccountId],
    queryFn: () => listFlocks(),
  });
  const vaccines = useQuery({
    queryKey: ["vaccines", ownerAccountId],
    queryFn: listVaccines,
    enabled: canManage,
  });

  useEffect(() => {
    if (!planFlockId && (flocks.data?.length ?? 0) > 0) setPlanFlockId(flocks.data![0].id);
    if (!planVaccineId && (vaccines.data?.length ?? 0) > 0) setPlanVaccineId(vaccines.data![0].id);
  }, [flocks.data, vaccines.data, planFlockId, planVaccineId]);

  const flockMap = useMemo(() => {
    const m = new Map<string, Flock>();
    for (const f of flocks.data ?? []) m.set(f.id, f);
    return m;
  }, [flocks.data]);

  const vaccineMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of vaccines.data ?? []) m.set(v.id, v.name);
    return m;
  }, [vaccines.data]);

  const summary = useMemo(() => {
    const rows = doses.data ?? [];
    return {
      due_today: rows.filter((d) => d.status === "due_today").length,
      overdue: rows.filter((d) => d.status === "overdue").length,
      upcoming: rows.filter((d) => d.status === "upcoming" || d.status === "due_soon").length,
      done: rows.filter((d) => d.status.startsWith("completed")).length,
    };
  }, [doses.data]);

  const filtered = useMemo(() => {
    return (doses.data ?? []).filter((d) => {
      if (!matchesFilter(d.status, filter)) return false;
      if (flockFilter && flockFilter !== "all" && d.flock_id !== flockFilter) return false;
      return true;
    });
  }, [doses.data, filter, flockFilter]);

  const flockOptions = useMemo(
    () => [
      { value: "all", label: "All flocks", hint: "Show every flock’s tasks" },
      ...(flocks.data ?? []).map((f) => ({
        value: f.id,
        label: f.batch_code,
        hint: flockLabel(f),
      })),
    ],
    [flocks.data],
  );

  const planFlockOptions = useMemo(
    () =>
      (flocks.data ?? []).map((f) => ({
        value: f.id,
        label: f.batch_code,
        hint: flockLabel(f),
      })),
    [flocks.data],
  );

  const planVaccineOptions = useMemo(
    () =>
      (vaccines.data ?? []).map((v) => ({
        value: v.id,
        label: v.name,
        hint: v.category || "Vaccine",
      })),
    [vaccines.data],
  );

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["doses", ownerAccountId] }),
      qc.invalidateQueries({ queryKey: ["notifications", ownerAccountId] }),
      qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] }),
    ]);
  };

  const onCreatePlan = async () => {
    if (!planFlockId || !planVaccineId) {
      setMsg("Please select a flock and a vaccine first.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await generateSchedules(planFlockId, [planVaccineId]);
      await generateNotifications();
      await refresh();
      setFilter("needs_action");
      setFlockFilter(planFlockId);
      setMsg("Vaccination plan created. Tasks below are ready.");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "create the plan"));
    } finally {
      setBusy(false);
    }
  };

  const onRecord = async (dose: DoseRow) => {
    setBusy(true);
    setMsg(null);
    try {
      await recordVaccination({
        scheduled_dose_id: dose.id,
        birds_covered: Math.max(dose.eligible_count - dose.completed_count, 1),
        administration_date: new Date().toISOString().slice(0, 10),
        idempotency_key: `ui-${dose.id}-${Date.now()}`,
      });
      await refresh();
      setMsg("Vaccination recorded.");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "record vaccination"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ paddingTop: space.md }}>
      <Text style={styles.pageTitle}>Vaccination tasks</Text>
      <Text style={styles.pageSub}>
        Each card is one vaccine dose for a flock. Open filters to focus on what needs action today.
      </Text>

      <View style={styles.summaryRow}>
        <SummaryChip label="Due today" value={summary.due_today} tone="warn" />
        <SummaryChip label="Overdue" value={summary.overdue} tone="danger" />
        <SummaryChip label="Upcoming" value={summary.upcoming} tone="info" />
        <SummaryChip label="Done" value={summary.done} tone="good" />
      </View>

      <SelectField
        label="Show tasks"
        helper="Pick what kind of work you want to see"
        value={filter}
        options={FILTER_OPTIONS}
        onChange={(v) => setFilter(v as StatusKey)}
      />
      <SelectField
        label="Flock"
        helper="Optional — narrow to one flock"
        value={flockFilter}
        options={flockOptions}
        onChange={setFlockFilter}
      />

      {canManage ? (
        <View style={[styles.planCard, shadow.card]}>
          <Text style={styles.planTitle}>Create a vaccination plan</Text>
          <Text style={styles.planHint}>
            Choose which flock and which vaccine. We’ll create the due dates (tasks) automatically.
          </Text>
          <SelectField
            label="1. Select flock"
            placeholder="Choose flock"
            value={planFlockId}
            options={planFlockOptions}
            onChange={setPlanFlockId}
          />
          <SelectField
            label="2. Select vaccine"
            placeholder="Choose vaccine"
            value={planVaccineId}
            options={planVaccineOptions}
            onChange={setPlanVaccineId}
          />
          <Button label="Create plan & reminders" onPress={onCreatePlan} loading={busy} />
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}
        </View>
      ) : msg ? (
        <Text style={styles.msg}>{msg}</Text>
      ) : null}

      {(notes.data ?? []).filter((n) => !n.is_read).length > 0 ? (
        <>
          <Text style={styles.section}>Reminders</Text>
          {(notes.data ?? [])
            .filter((n) => !n.is_read)
            .slice(0, 3)
            .map((n) => (
              <View key={n.id} style={styles.card}>
                <Text style={styles.name}>{n.title}</Text>
                <Text style={styles.meta}>{n.body}</Text>
                <Button label="Dismiss" variant="secondary" onPress={() => markNotificationRead(n.id).then(refresh)} />
              </View>
            ))}
        </>
      ) : null}

      <Text style={styles.section}>Task list ({filtered.length})</Text>
      <FlatList
        style={{ flex: 1 }}
        data={filtered}
        keyExtractor={(i) => i.id}
        initialNumToRender={12}
        contentContainerStyle={{ gap: space.sm, paddingBottom: 100 }}
        ListEmptyComponent={
          <Text style={styles.meta}>
            {doses.isLoading
              ? "Loading tasks…"
              : canManage
                ? "No tasks in this view. Create a plan above, or change the filter."
                : "No tasks assigned yet. Ask your farm owner to create a vaccination plan."}
          </Text>
        }
        renderItem={({ item }) => {
          const st = statusInfo(item.status);
          const flock = flockMap.get(item.flock_id);
          const vaccineName = vaccineMap.get(item.vaccine_definition_id) ?? "Vaccine";
          const remaining = Math.max(item.eligible_count - item.completed_count, 0);
          return (
            <View style={[styles.card, shadow.card]}>
              <View style={styles.cardTop}>
                <Text style={styles.name}>
                  {vaccineName} · Dose {item.dose_number}
                </Text>
                <View style={[styles.badge, { backgroundColor: `${toneColor(st.tone)}22` }]}>
                  <Text style={[styles.badgeText, { color: toneColor(st.tone) }]}>{st.label}</Text>
                </View>
              </View>
              <Text style={styles.meta}>Flock: {flock ? flockLabel(flock) : "Unknown flock"}</Text>
              <Text style={styles.meta}>Due date: {item.due_date}</Text>
              <Text style={styles.meta}>
                Progress: {item.completed_count} of {item.eligible_count} birds done
                {remaining > 0 ? ` · ${remaining} left` : ""}
              </Text>
              {st.hint ? <Text style={styles.hint}>{st.hint}</Text> : null}
              {canRecord && !item.status.startsWith("completed") && item.status !== "skipped" ? (
                <Button
                  label={remaining > 0 ? `Mark vaccinated (${remaining} birds)` : "Mark vaccinated"}
                  onPress={() => onRecord(item)}
                  loading={busy}
                />
              ) : null}
            </View>
          );
        }}
      />
    </Screen>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "warn" | "danger" | "info" | "good";
}) {
  const c = toneColor(tone);
  return (
    <View style={[styles.chip, { borderColor: `${c}55` }]}>
      <Text style={[styles.chipValue, { color: c }]}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pageTitle: { fontSize: 22, fontWeight: "800", color: colors.brand },
  pageSub: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, marginTop: -space.sm },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    flexGrow: 1,
    minWidth: "22%",
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  chipValue: { fontSize: 20, fontWeight: "800" },
  chipLabel: { fontSize: 11, color: colors.inkMuted, fontWeight: "700", marginTop: 2 },
  planCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.md,
  },
  planTitle: { fontSize: 16, fontWeight: "800", color: colors.ink },
  planHint: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: -space.sm },
  section: {
    marginTop: space.sm,
    fontSize: 13,
    fontWeight: "800",
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  name: { fontWeight: "800", color: colors.ink, flex: 1, fontSize: 15 },
  meta: { color: colors.inkMuted, fontSize: 13 },
  hint: { color: colors.ink, fontSize: 12, fontWeight: "600" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: 11, fontWeight: "800" },
  msg: { color: colors.brand, fontWeight: "700", fontSize: 13 },
});
