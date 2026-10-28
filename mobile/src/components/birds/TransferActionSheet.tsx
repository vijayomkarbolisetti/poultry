import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { listFlocks, transferToShedByCohort, type Flock } from "../../api/flocks";
import { listSheds } from "../../api/sheds";
import {
  cohortAgePayload,
  resolveBandedSelectionCohort,
  validateUnbandedTransferQuantity,
  type CohortKey,
  type TransferBirdLike,
} from "../../features/birds/transferHelpers";
import { newLifecycleIdempotencyKey } from "../../features/birds/birdSelectionHelpers";
import { birdUi } from "../../theme/birdManagementUi";
import { Button } from "../ui/Button";
import { AppDatePicker } from "../ui/AppDatePicker";
import { SelectField } from "../ui/SelectField";
import { todayIsoDate } from "../ui/selectUtils";

export type TransferBandedPayload = {
  mode: "banded";
  shedId: string;
  birdIds: string[];
  labels: string[];
  birds: TransferBirdLike[];
};

export type TransferUnbandedPayload = {
  mode: "unbanded";
  shedId: string;
  flockId: string;
  label: string;
  unbandedCount: number;
  key: CohortKey;
};

type Props = {
  visible: boolean;
  payload: TransferBandedPayload | TransferUnbandedPayload | null;
  onClose: () => void;
  onSuccess: () => void;
};

export function TransferActionSheet({ visible, payload, onClose, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const [destShedId, setDestShedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [effectiveDate, setEffectiveDate] = useState(() => todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  const idem = useRef(newLifecycleIdempotencyKey("xfer-sheet"));

  const shedId = payload?.shedId;

  const sheds = useQuery({
    queryKey: ["sheds", "transfer-sheet"],
    queryFn: () => listSheds(),
    enabled: visible && !!shedId,
  });
  const sourceFlocks = useQuery({
    queryKey: ["flocks", shedId, "transfer-sheet"],
    queryFn: () => listFlocks(shedId),
    enabled: visible && !!shedId && payload?.mode === "banded",
  });

  useEffect(() => {
    if (!visible || !payload) return;
    setDestShedId(null);
    setQuantity(payload.mode === "unbanded" ? "1" : "1");
    setEffectiveDate(todayIsoDate());
    setBusy(false);
    setDone(false);
    setMsg(null);
    lock.current = false;
    idem.current = newLifecycleIdempotencyKey("xfer-sheet");
  }, [visible, payload]);

  const destOptions = useMemo(
    () =>
      (sheds.data ?? [])
        .filter((s) => s.is_active && s.id !== shedId)
        .map((s) => ({ value: s.id, label: s.name, hint: s.code })),
    [sheds.data, shedId],
  );

  const flocksById = useMemo(() => {
    const map = new Map<string, Flock>();
    for (const f of sourceFlocks.data ?? []) map.set(f.id, f);
    return map;
  }, [sourceFlocks.data]);

  const onConfirm = async () => {
    if (!payload || lock.current || done) return;
    if (!destShedId) {
      setMsg("Select a destination shed");
      return;
    }
    if (destShedId === payload.shedId) {
      setMsg("Destination must be a different shed");
      return;
    }

    lock.current = true;
    setBusy(true);
    setMsg(null);
    let succeeded = false;
    try {
      if (payload.mode === "banded") {
        const resolved = resolveBandedSelectionCohort(payload.birds, payload.birdIds, flocksById);
        if (!resolved.ok) {
          setMsg(resolved.error);
          return;
        }
        const ageFields = cohortAgePayload(resolved.key);
        if (!ageFields) {
          setMsg("Selected birds have no hatch date, so transfer cannot continue safely.");
          return;
        }
        await transferToShedByCohort({
          destination_shed_id: destShedId,
          effective_date: effectiveDate,
          bird_ids: resolved.birdIds,
          idempotency_key: idem.current,
          ...ageFields,
        });
      } else {
        if (payload.key.kind === "unknown") {
          setMsg("This unbanded population has no hatch date, so transfer is unavailable.");
          return;
        }
        const qty = Number(quantity);
        const qtyErr = validateUnbandedTransferQuantity(qty, payload.unbandedCount);
        if (qtyErr) {
          setMsg(qtyErr);
          return;
        }
        const ageFields = cohortAgePayload(payload.key);
        if (!ageFields) {
          setMsg("This unbanded population has no hatch date, so transfer is unavailable.");
          return;
        }
        await transferToShedByCohort({
          destination_shed_id: destShedId,
          source_shed_id: payload.shedId,
          quantity: qty,
          effective_date: effectiveDate,
          idempotency_key: idem.current,
          ...ageFields,
        });
      }

      setDone(true);
      succeeded = true;
      setMsg("Transfer completed.");
      onSuccess();
    } catch (e: unknown) {
      setMsg(describeApiError(e, "transfer birds"));
    } finally {
      setBusy(false);
      if (!succeeded) lock.current = false;
    }
  };

  if (!payload) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close transfer">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={[styles.iconCircle, { backgroundColor: birdUi.bluePale }]}>
              <Ionicons name="swap-horizontal" size={20} color={birdUi.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Transfer</Text>
              <Text style={styles.sub}>
                {payload.mode === "banded"
                  ? `${payload.birdIds.length} banded bird${payload.birdIds.length === 1 ? "" : "s"}`
                  : payload.label}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
            {payload.mode === "banded" ? (
              <View style={styles.listCard}>
                {(payload.labels.length ? payload.labels : payload.birdIds).slice(0, 20).map((label, i) => (
                  <Text key={`${label}-${i}`} style={styles.band}>
                    {label}
                  </Text>
                ))}
                {payload.birdIds.length > 20 ? (
                  <Text style={styles.hint}>…and {payload.birdIds.length - 20} more</Text>
                ) : null}
                <Text style={styles.hint}>
                  Birds must share the same hatch date. They stay active in the destination shed.
                </Text>
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
                  accessibilityLabel="Transfer quantity"
                />
              </>
            )}

            <SelectField
              label="Destination shed"
              value={destShedId}
              options={destOptions}
              onChange={setDestShedId}
              loading={sheds.isLoading}
              emptyMessage="No other active sheds"
            />
            <AppDatePicker
              label="Effective date"
              required
              value={effectiveDate}
              maximumDate={todayIsoDate()}
              onChange={(v) => setEffectiveDate(v ?? todayIsoDate())}
              disabled={done}
            />

            {msg ? <Text style={done ? styles.ok : styles.error}>{msg}</Text> : null}
          </ScrollView>

          {!done ? (
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Confirm transfer"
                  onPress={() => void onConfirm()}
                  loading={busy}
                  disabled={busy || !destShedId}
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
    backgroundColor: birdUi.bluePale,
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
  hint: { fontSize: 12, color: birdUi.muted, lineHeight: 17, marginTop: 4 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  error: { color: birdUi.error, fontWeight: "600", marginTop: 4 },
  ok: { color: birdUi.successText, fontWeight: "700", marginTop: 4 },
});
