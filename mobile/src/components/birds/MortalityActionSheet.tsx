import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeApiError } from "../../api/client";
import {
  recordLifecycleBulk,
  recordUnbandedLifecycleByCohort,
} from "../../api/flocks";
import {
  newLifecycleIdempotencyKey,
  validateUnbandedQuantity,
} from "../../features/birds/birdSelectionHelpers";
import {
  cohortAgePayload,
  cohortKeyFromAge,
  type CohortKey,
} from "../../features/birds/transferHelpers";
import { birdUi } from "../../theme/birdManagementUi";
import { Button } from "../ui/Button";
import { AppDatePicker } from "../ui/AppDatePicker";
import { todayIsoDate } from "../ui/selectUtils";

export type MortalityBandedPayload = {
  mode: "banded";
  birdIds: string[];
  labels: string[];
};

export type MortalityUnbandedPayload = {
  mode: "unbanded";
  flockId: string;
  label: string;
  unbandedCount: number;
  key: CohortKey;
  shedId: string;
};

type Props = {
  visible: boolean;
  payload: MortalityBandedPayload | MortalityUnbandedPayload | null;
  onClose: () => void;
  onSuccess: () => void;
};

export function MortalityActionSheet({ visible, payload, onClose, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [effectiveDate, setEffectiveDate] = useState(() => todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  const idem = useRef(newLifecycleIdempotencyKey("mortality-sheet"));

  useEffect(() => {
    if (!visible || !payload) return;
    setReason("");
    setQuantity(payload.mode === "unbanded" ? String(Math.min(1, payload.unbandedCount) || "1") : "1");
    setEffectiveDate(todayIsoDate());
    setBusy(false);
    setDone(false);
    setMsg(null);
    lock.current = false;
    idem.current = newLifecycleIdempotencyKey("mortality-sheet");
  }, [visible, payload]);

  const onConfirm = async () => {
    if (!payload || lock.current || done) return;
    lock.current = true;
    setBusy(true);
    setMsg(null);
    let succeeded = false;
    try {
      if (payload.mode === "banded") {
        if (payload.birdIds.length === 0) {
          setMsg("No birds selected");
          return;
        }
        const result = await recordLifecycleBulk({
          event_type: "mortality",
          effective_date: effectiveDate,
          bird_ids: payload.birdIds,
          reason: reason.trim() || "Mortality from shed bird management",
          idempotency_key: idem.current,
        });
        setDone(true);
        succeeded = true;
        setMsg(
          result.idempotent_replay
            ? `Already recorded (${result.applied}). Safe retry — no duplicates.`
            : `Recorded mortality for ${result.applied} bird${result.applied === 1 ? "" : "s"}.`,
        );
        onSuccess();
        return;
      }

      const qty = Number(quantity);
      const qtyErr = validateUnbandedQuantity(qty, payload.unbandedCount);
      if (qtyErr) {
        setMsg(qtyErr);
        return;
      }
      const ageFields = cohortAgePayload(payload.key);
      if (!ageFields) {
        setMsg("This population has no hatch date, so count mortality is not available.");
        return;
      }
      await recordUnbandedLifecycleByCohort({
        shed_id: payload.shedId,
        event_type: "mortality",
        effective_date: effectiveDate,
        quantity: qty,
        reason: reason.trim() || "Unbanded mortality from shed bird management",
        idempotency_key: idem.current,
        ...ageFields,
      });
      setDone(true);
      succeeded = true;
      setMsg(`Recorded mortality for ${qty} unbanded bird${qty === 1 ? "" : "s"}.`);
      onSuccess();
    } catch (e: unknown) {
      setMsg(describeApiError(e, "record mortality"));
    } finally {
      setBusy(false);
      // Hold lock after success so a pre-paint double-tap cannot re-submit.
      // Backend idempotency_key remains the second line of defense.
      if (!succeeded) lock.current = false;
    }
  };

  if (!payload) return null;

  const titleCount =
    payload.mode === "banded" ? payload.birdIds.length : Number(quantity) || 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close mortality">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={[styles.iconCircle, { backgroundColor: birdUi.errorPale }]}>
              <Ionicons name="skull-outline" size={20} color={birdUi.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Record mortality</Text>
              <Text style={styles.sub}>
                {payload.mode === "banded"
                  ? `${payload.birdIds.length} banded bird${payload.birdIds.length === 1 ? "" : "s"} selected`
                  : payload.label}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
            {payload.mode === "banded" ? (
              <View style={styles.listCard}>
                {(payload.labels.length ? payload.labels : payload.birdIds).slice(0, 30).map((label, i) => (
                  <Text key={`${label}-${i}`} style={styles.band}>
                    {label}
                  </Text>
                ))}
                {payload.birdIds.length > 30 ? (
                  <Text style={styles.hint}>…and {payload.birdIds.length - 30} more</Text>
                ) : null}
              </View>
            ) : (
              <>
                <Text style={styles.label}>Quantity (max {payload.unbandedCount})</Text>
                <TextInput
                  style={styles.input}
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="number-pad"
                  editable={!done}
                  accessibilityLabel="Mortality quantity"
                />
              </>
            )}

            <AppDatePicker
              label="Effective date"
              required
              value={effectiveDate}
              maximumDate={todayIsoDate()}
              onChange={(v) => setEffectiveDate(v ?? todayIsoDate())}
              disabled={done}
            />

            <Text style={styles.label}>Reason (optional)</Text>
            <TextInput
              style={[styles.input, styles.reason]}
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. disease, predator, unknown"
              editable={!done}
              multiline
            />

            <Text style={styles.warn}>
              This marks {titleCount || "selected"} bird
              {(titleCount === 1 ? "" : "s")} as dead and removes them from the live population.
              History is preserved.
            </Text>

            {msg ? <Text style={done ? styles.ok : styles.error}>{msg}</Text> : null}
          </ScrollView>

          {!done ? (
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Confirm mortality"
                  variant="danger"
                  onPress={() => void onConfirm()}
                  loading={busy}
                  disabled={busy}
                />
              </View>
            </View>
          ) : (
            <Button label="Done" onPress={onClose} />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Build unbanded mortality payload from cohort age fields already known on the list row. */
export function unbandedMortalityPayload(opts: {
  shedId: string;
  flockId: string;
  label: string;
  unbandedCount: number;
  hatch_date: string | null;
  estimated_age_days: number | null;
  age_reported_on?: string | null;
}): MortalityUnbandedPayload {
  return {
    mode: "unbanded",
    shedId: opts.shedId,
    flockId: opts.flockId,
    label: opts.label,
    unbandedCount: opts.unbandedCount,
    key: cohortKeyFromAge({
      hatch_date: opts.hatch_date,
      estimated_age_days: opts.estimated_age_days,
      age_reported_on: opts.age_reported_on ?? null,
    }),
  };
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(2, 44, 34, 0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: birdUi.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: birdUi.horizontal,
    paddingTop: 10,
    gap: 10,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: birdUi.divider,
    marginBottom: 6,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "800", color: birdUi.text },
  sub: { fontSize: 13, color: birdUi.muted, marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: birdUi.paleMint,
  },
  listCard: {
    backgroundColor: birdUi.paleMint,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    marginBottom: 8,
  },
  band: { fontSize: 14, fontWeight: "700", color: birdUi.text },
  label: { fontSize: 13, fontWeight: "700", color: birdUi.muted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    fontWeight: "600",
    backgroundColor: birdUi.white,
    color: birdUi.text,
    marginBottom: 10,
  },
  reason: { minHeight: 64, textAlignVertical: "top" },
  hint: { fontSize: 12, color: birdUi.muted },
  warn: {
    fontSize: 13,
    color: birdUi.orange,
    backgroundColor: birdUi.orangePale,
    padding: 10,
    borderRadius: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  error: { color: birdUi.error, fontWeight: "600", marginTop: 4 },
  ok: { color: birdUi.successText, fontWeight: "700", marginTop: 4 },
});
