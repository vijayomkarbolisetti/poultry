import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { describeApiError } from "../../src/api/client";
import { getFlock, recordUnbandedLifecycleByCohort } from "../../src/api/flocks";
import { Button } from "../../src/components/ui/Button";
import { HenLoader } from "../../src/components/ui/HenLoader";
import { Screen } from "../../src/components/ui/Screen";
import { SelectField } from "../../src/components/ui/SelectField";
import { useAuth } from "../../src/features/auth/AuthContext";
import { hasPermission } from "../../src/features/auth/permissions";
import { BIRD_LIFECYCLE_ACTIONS, formatBirdAge } from "../../src/features/birds/birdListHelpers";
import {
  batchCountActionAllowed,
  newLifecycleIdempotencyKey,
  validateUnbandedQuantity,
} from "../../src/features/birds/birdSelectionHelpers";
import { cohortAgePayload, cohortKeyFromAge } from "../../src/features/birds/transferHelpers";
import { safeBack } from "../../src/navigation/safeBack";
import { colors, radius, space } from "../../src/theme/tokens";

type EventValue = "mortality" | "sale" | "transfer";

export default function BatchLifecycleScreen() {
  const { shedId, flockId: flockIdParam, eventType: eventParam } = useLocalSearchParams<{
    shedId: string;
    flockId?: string;
    eventType?: EventValue;
  }>();
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");

  const [eventType, setEventType] = useState<string | null>(eventParam ?? "mortality");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  const idemKey = useRef(newLifecycleIdempotencyKey(`count-${eventParam ?? "mortality"}`));
  const paramsKey = `${shedId ?? ""}|${flockIdParam ?? ""}|${eventParam ?? ""}`;

  useEffect(() => {
    setEventType(eventParam ?? "mortality");
    setQuantity("1");
    setReason("");
    setBusy(false);
    setMsg(null);
    setDone(false);
    lock.current = false;
    idemKey.current = newLifecycleIdempotencyKey(`count-${eventParam ?? "mortality"}`);
  }, [paramsKey, eventParam]);

  const flock = useQuery({
    queryKey: ["flock", flockIdParam],
    queryFn: () => getFlock(flockIdParam!),
    enabled: !!flockIdParam && canLifecycle,
  });

  const action = BIRD_LIFECYCLE_ACTIONS.find((a) => a.value === eventType);
  const scopeError = useMemo(() => {
    if (!flock.data) return null;
    return batchCountActionAllowed({
      trackingMode: flock.data.tracking_mode,
      unbandedCount: flock.data.unbanded_count,
      bandedCount: flock.data.banded_count,
      currentCount: flock.data.current_count,
    });
  }, [flock.data]);

  const onConfirm = async () => {
    if (!canLifecycle || !action || !flock.data || lock.current || done) return;
    if (scopeError) {
      setMsg(scopeError);
      return;
    }
    const qty = Number(quantity);
    const qtyErr = validateUnbandedQuantity(qty, flock.data.unbanded_count);
    if (qtyErr) {
      setMsg(qtyErr);
      return;
    }
    if (!shedId) {
      setMsg("Missing shed. Open this screen from a shed birds list.");
      return;
    }
    const key = cohortKeyFromAge({
      hatch_date: flock.data.hatch_date,
      estimated_age_days: flock.data.estimated_age_days,
      age_reported_on: flock.data.age_reported_on,
    });
    const ageFields = cohortAgePayload(key);
    if (!ageFields) {
      setMsg(
        "This population has no hatch date or estimated age key, so count actions by cohort are not available.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setMsg(null);
    try {
      await recordUnbandedLifecycleByCohort({
        shed_id: shedId,
        event_type: action.value as EventValue,
        effective_date: new Date().toISOString().slice(0, 10),
        quantity: qty,
        reason: reason.trim() || `Unbanded count ${action.value}`,
        idempotency_key: idemKey.current,
        ...ageFields,
      });
      void qc.invalidateQueries({ queryKey: ["shed-birds", shedId] });
      void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
      void qc.invalidateQueries({ queryKey: ["flock", flock.data.id] });
      void qc.invalidateQueries({ queryKey: ["flocks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      setDone(true);
      setMsg(`Recorded ${action.label.toLowerCase()} for ${qty} unbanded bird${qty === 1 ? "" : "s"}.`);
    } catch (e: unknown) {
      setMsg(describeApiError(e, "record count action"));
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

  if (!flockIdParam) {
    return (
      <Screen>
        <Text style={styles.error}>
          Missing unbanded population. Open this screen from a shed birds list row.
        </Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (flock.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading unbanded population…" />
      </Screen>
    );
  }

  if (flock.isError || !flock.data) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(flock.error, "load unbanded population")}</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(`/(app)/sheds/${shedId}`)} />
      </Screen>
    );
  }

  const f = flock.data;
  const ageLabel = formatBirdAge({
    hatch_date: f.hatch_date,
    estimated_age_days: f.estimated_age_days,
  });

  return (
    <Screen scroll>
      <Text style={styles.title}>Unbanded count action</Text>
      <Text style={styles.meta}>
        This adjusts the unbanded population count only. It does not select or fabricate individual bird
        records, and it does not create individual vaccination events.
      </Text>

      <View style={styles.card}>
        <Text style={styles.band}>{ageLabel}</Text>
        <Text style={styles.meta}>Live: {f.current_count}</Text>
        <Text style={styles.meta}>Banded: {f.banded_count}</Text>
        <Text style={styles.meta}>Unbanded: {f.unbanded_count}</Text>
      </View>

      <SelectField
        label="Action"
        value={eventType}
        options={BIRD_LIFECYCLE_ACTIONS.map((a) => ({
          value: a.value,
          label: a.label,
          hint: a.consequence.slice(0, 80),
        }))}
        onChange={(v) => {
          setEventType(v);
          idemKey.current = newLifecycleIdempotencyKey(`count-${v}`);
        }}
      />

      {action ? <Text style={styles.meta}>{action.consequence}</Text> : null}
      {scopeError ? <Text style={styles.error}>{scopeError}</Text> : null}

      <Text style={styles.label}>Quantity (unbanded only) *</Text>
      <TextInput
        style={styles.input}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="number-pad"
        editable={!done}
      />

      <Text style={styles.label}>Reason (optional)</Text>
      <TextInput style={styles.input} value={reason} onChangeText={setReason} editable={!done} />

      {msg ? <Text style={done ? styles.ok : styles.error}>{msg}</Text> : null}

      {!done ? (
        <>
          <Button
            label={action?.label ?? "Confirm"}
            onPress={onConfirm}
            loading={busy}
            disabled={busy || !!scopeError}
          />
          <Button
            label="Cancel"
            variant="secondary"
            disabled={busy}
            onPress={() => safeBack(`/(app)/sheds/${shedId}`)}
          />
        </>
      ) : (
        <Button label="Done" onPress={() => safeBack(`/(app)/sheds/${shedId}`)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: "800", color: colors.brand, marginBottom: space.xs },
  meta: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, marginBottom: space.sm },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
    marginBottom: space.md,
  },
  band: { fontWeight: "800", fontSize: 17, color: colors.ink },
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
