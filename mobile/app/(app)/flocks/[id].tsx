import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { bulkImportBirds, createBird, getFlock, listBirds, recordLifecycle } from "../../../src/api/flocks";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { DataQualityBanner } from "../../../src/components/ui/DataQualityBanner";
import { DateField } from "../../../src/components/ui/DateField";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { SelectField } from "../../../src/components/ui/SelectField";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { colors, radius, space } from "../../../src/theme/tokens";

/** Bird-level lifecycle events supported by the API for active hens. */
const BIRD_EVENT_OPTIONS = [
  { value: "mortality", label: "Mortality", hint: "Mark hen as dead" },
  { value: "sale", label: "Sale", hint: "Sold / moved out by sale" },
  { value: "transfer", label: "Transfer", hint: "Transferred out of this batch" },
];

export default function FlockDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ownerAccountId, user } = useAuth();
  const qc = useQueryClient();
  const canCreateBird = hasPermission(user, ownerAccountId, "bird.create");
  const canViewBird = hasPermission(user, ownerAccountId, "bird.view");
  const canRecordLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");
  const flock = useQuery({ queryKey: ["flock", id], queryFn: () => getFlock(id!), enabled: !!id });
  const birds = useQuery({ queryKey: ["birds", id], queryFn: () => listBirds(id!), enabled: !!id });
  const [bandId, setBandId] = useState("");
  const [bulkText, setBulkText] = useState("B10\nB11\nB12");
  const [eventType, setEventType] = useState<string | null>("mortality");
  const [eventDate, setEventDate] = useState<string>(todayIsoDate());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    void qc.invalidateQueries({ queryKey: ["flock", id] });
    void qc.invalidateQueries({ queryKey: ["birds", id] });
    void qc.invalidateQueries({ queryKey: ["flocks", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    if (flock.data?.shed_id) {
      void qc.invalidateQueries({ queryKey: ["shed-overview", flock.data.shed_id] });
    }
  };

  const onAddBird = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await createBird({ flock_id: id, band_id: bandId, dob_confidence: "unknown" });
      setBandId("");
      await refresh();
      setMsg("Hen added");
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

  const onLifecycle = async (birdId: string) => {
    if (!eventType) {
      setMsg("Select an event type");
      return;
    }
    if (!eventDate) {
      setMsg("Select an effective date");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await recordLifecycle({
        event_type: eventType,
        effective_date: eventDate,
        bird_id: birdId,
        quantity: 1,
        reason: `Recorded from app (${eventType})`,
      });
      await refresh();
      setMsg("Lifecycle event recorded");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "record lifecycle event"));
    } finally {
      setBusy(false);
    }
  };

  if (flock.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading this batch…" />
      </Screen>
    );
  }
  if (!flock.data) {
    return (
      <Screen>
        <Text style={styles.error}>Batch not found</Text>
      </Screen>
    );
  }
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
        {f.count_mismatch ? (
          <DataQualityBanner message="Bird counts need reconciliation. Banded + unbanded birds do not match the live total." />
        ) : null}
      </View>

      {f.unbanded_count > 0 ? (
        <View style={styles.unbandedCard}>
          <Text style={styles.unbandedTitle}>{f.unbanded_count} unbanded birds</Text>
          <Text style={styles.meta}>
            Unbanded birds are a batch population count — they are not individual profiles until banded.
          </Text>
          {canCreateBird ? (
            <Text style={styles.meta}>Use Add banded hen or Bulk import below to register bands.</Text>
          ) : null}
        </View>
      ) : null}

      {canViewBird ? (
        <Button
          label="Search farm records"
          variant="secondary"
          onPress={() => router.push("/(app)/search")}
        />
      ) : null}

      {canCreateBird ? (
        <>
          <Text style={styles.section}>Band birds</Text>
          <Text style={styles.section}>Add banded hen</Text>
          <TextInput
            style={styles.input}
            value={bandId}
            onChangeText={setBandId}
            placeholder="Band ID"
            autoCapitalize="characters"
          />
          <Button label="Add hen" onPress={onAddBird} loading={busy} disabled={!bandId} />

          <Text style={styles.section}>Bulk import (one band ID per line)</Text>
          <TextInput
            style={[styles.input, { minHeight: 90 }]}
            multiline
            value={bulkText}
            onChangeText={setBulkText}
          />
          <Button label="Import bands" onPress={onBulk} loading={busy} variant="secondary" />
        </>
      ) : null}

      {canRecordLifecycle ? (
        <>
          <Text style={styles.section}>Lifecycle event defaults</Text>
          <SelectField
            label="Event type"
            value={eventType}
            options={BIRD_EVENT_OPTIONS}
            onChange={setEventType}
            required
          />
          <DateField
            label="Effective date"
            required
            value={eventDate}
            onChange={(v) => setEventDate(v ?? todayIsoDate())}
          />
        </>
      ) : null}

      <Text style={styles.section}>Registered birds ({birds.data?.length ?? 0})</Text>
      {(birds.data ?? []).length === 0 ? (
        <Text style={styles.meta}>No banded birds registered in this batch yet.</Text>
      ) : null}
      {(birds.data ?? []).map((b) => (
        <View key={b.id} style={styles.card}>
          {canViewBird ? (
            <Pressable onPress={() => router.push(`/(app)/birds/${b.id}`)}>
              <Text style={styles.name}>{b.band_id ?? b.id.slice(0, 8)}</Text>
              <Text style={styles.link}>Open profile</Text>
            </Pressable>
          ) : (
            <Text style={styles.name}>{b.band_id ?? b.id.slice(0, 8)}</Text>
          )}
          <Text style={styles.meta}>{b.lifecycle_status}</Text>
          {b.is_active && canRecordLifecycle ? (
            <Button
              label={`Record ${eventType ?? "event"}`}
              variant="danger"
              onPress={() => onLifecycle(b.id)}
              loading={busy}
            />
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
  link: { color: colors.brand, fontSize: 13, fontWeight: "700", marginTop: 2 },
  meta: { color: colors.inkMuted, fontSize: 14 },
  unbandedCard: {
    backgroundColor: "#FFF4E5",
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    borderWidth: 1,
    borderColor: "#F5D9A8",
    marginBottom: space.sm,
  },
  unbandedTitle: { fontWeight: "800", color: colors.accent },
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
