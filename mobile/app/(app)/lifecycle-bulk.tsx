import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { describeApiError } from "../../src/api/client";
import { recordLifecycleBulk } from "../../src/api/flocks";
import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { BIRD_LIFECYCLE_ACTIONS } from "../../src/features/birds/birdListHelpers";
import { newLifecycleIdempotencyKey } from "../../src/features/birds/birdSelectionHelpers";
import { safeBack } from "../../src/navigation/safeBack";
import { colors, radius, space } from "../../src/theme/tokens";

type EventValue = "mortality" | "sale" | "transfer";

export default function BulkLifecycleScreen() {
  const params = useLocalSearchParams<{
    shedId: string;
    eventType: EventValue;
    birdIds: string;
    labels?: string;
  }>();
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");

  const birdIds = useMemo(
    () =>
      String(params.birdIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [params.birdIds],
  );
  const labels = useMemo(
    () =>
      String(params.labels ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    [params.labels],
  );

  const action = BIRD_LIFECYCLE_ACTIONS.find((a) => a.value === params.eventType);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  const idemKey = useRef(newLifecycleIdempotencyKey(`bulk-${params.eventType ?? "life"}`));
  const paramsKey = `${params.eventType ?? ""}|${birdIds.join(",")}`;

  // Expo Router may reuse this screen across deep-links; reset confirm state for a new selection.
  useEffect(() => {
    setReason("");
    setBusy(false);
    setMsg(null);
    setDone(false);
    lock.current = false;
    idemKey.current = newLifecycleIdempotencyKey(`bulk-${params.eventType ?? "life"}`);
  }, [paramsKey, params.eventType]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["shed-birds", params.shedId] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", params.shedId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["search"] });
    void qc.invalidateQueries({ queryKey: ["bird-profile"] });
  };

  const onConfirm = async () => {
    if (!canLifecycle || !action || lock.current || done || birdIds.length === 0) return;
    lock.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const result = await recordLifecycleBulk({
        event_type: action.value as EventValue,
        effective_date: new Date().toISOString().slice(0, 10),
        bird_ids: birdIds,
        reason: reason.trim() || `Bulk ${action.value} from shed overview`,
        idempotency_key: idemKey.current,
      });
      invalidate();
      setDone(true);
      setMsg(
        result.idempotent_replay
          ? `Already recorded (${result.applied} bird${result.applied === 1 ? "" : "s"}). Safe retry — no duplicates.`
          : `Recorded ${action.label.toLowerCase()} for ${result.applied} bird${result.applied === 1 ? "" : "s"}.`,
      );
    } catch (e: unknown) {
      setMsg(describeApiError(e, "record bulk lifecycle"));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };

  if (!canLifecycle) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to record lifecycle events.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (!action || birdIds.length === 0) {
    return (
      <Screen>
        <Text style={styles.error}>No birds selected for this action.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(`/(app)/sheds/${params.shedId}`)} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Text style={styles.title}>{action.confirmTitle}</Text>
      <Text style={styles.meta}>{action.consequence}</Text>
      <Text style={styles.section}>
        Affects {birdIds.length} registered bird{birdIds.length === 1 ? "" : "s"} (selection is only birds you
        checked — not an entire batch):
      </Text>
      <View style={styles.card}>
        {(labels.length ? labels : birdIds).slice(0, 40).map((label, i) => (
          <Text key={`${label}-${i}`} style={styles.band}>
            {label}
          </Text>
        ))}
        {birdIds.length > 40 ? <Text style={styles.meta}>…and {birdIds.length - 40} more</Text> : null}
      </View>

      <Text style={styles.label}>Reason (optional)</Text>
      <TextInput
        style={styles.input}
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. market sale / disease / transfer"
        editable={!done}
      />

      {msg ? <Text style={done ? styles.ok : styles.error}>{msg}</Text> : null}

      {!done ? (
        <>
          <Button label={action.label} onPress={onConfirm} loading={busy} disabled={busy} />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={busy}
            onPress={() => safeBack(`/(app)/sheds/${params.shedId}`)}
          />
        </>
      ) : (
        <Button label="Done" onPress={() => safeBack(`/(app)/sheds/${params.shedId}`)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand, marginBottom: space.xs },
  meta: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, marginBottom: space.sm },
  section: { fontSize: 13, fontWeight: "700", color: colors.inkMuted, marginBottom: space.xs },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
    marginBottom: space.md,
  },
  band: { fontWeight: "700", color: colors.ink, fontSize: 15 },
  label: { fontSize: 13, fontWeight: "700", color: colors.inkMuted, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    backgroundColor: colors.bgElevated,
    color: colors.ink,
    fontSize: 16,
    marginBottom: space.md,
  },
  error: { color: colors.danger, marginBottom: space.sm },
  ok: { color: colors.brand, fontWeight: "700", marginBottom: space.sm },
});
