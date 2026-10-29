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
import { toast } from "../../ui/toast/toastStore";
import { Button } from "../ui/Button";
import { AppDatePicker } from "../ui/AppDatePicker";
import { todayIsoDate } from "../ui/selectUtils";

export type SaleBandedPayload = {
  mode: "banded";
  birdIds: string[];
  labels: string[];
};

export type SaleUnbandedPayload = {
  mode: "unbanded";
  flockId: string;
  label: string;
  unbandedCount: number;
  key: CohortKey;
  shedId: string;
};

type Props = {
  visible: boolean;
  payload: SaleBandedPayload | SaleUnbandedPayload | null;
  onClose: () => void;
  onSuccess: () => void;
};

const MOBILE_RE = /^\+?\d{10,15}$/;

function validateBuyerName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Person name is required";
  if (name.length > 120) return "Person name is too long";
  return null;
}

function validateBuyerMobile(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, "").trim();
  if (!cleaned) return "Person mobile number is required";
  if (!MOBILE_RE.test(cleaned)) return "Enter a valid mobile number (10–15 digits)";
  return null;
}

function normalizeMobile(raw: string): string {
  return raw.replace(/[\s\-().]/g, "").trim();
}

export function SaleActionSheet({ visible, payload, onClose, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const [soldDate, setSoldDate] = useState(() => todayIsoDate());
  const [buyerName, setBuyerName] = useState("");
  const [buyerMobile, setBuyerMobile] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  const idem = useRef(newLifecycleIdempotencyKey("sale-sheet"));

  useEffect(() => {
    if (!visible || !payload) return;
    setSoldDate(todayIsoDate());
    setBuyerName("");
    setBuyerMobile("");
    setQuantity(payload.mode === "unbanded" ? String(Math.min(1, payload.unbandedCount) || "1") : "1");
    setConfirmBulk(false);
    setBusy(false);
    setDone(false);
    setMsg(null);
    lock.current = false;
    idem.current = newLifecycleIdempotencyKey("sale-sheet");
  }, [visible, payload]);

  const multiBanded = payload?.mode === "banded" && payload.birdIds.length > 1;

  const onConfirm = async () => {
    if (!payload || lock.current || done) return;

    const nameErr = validateBuyerName(buyerName);
    if (nameErr) {
      setMsg(nameErr);
      return;
    }
    const mobileErr = validateBuyerMobile(buyerMobile);
    if (mobileErr) {
      setMsg(mobileErr);
      return;
    }
    if (!soldDate) {
      setMsg("Sold date is required");
      return;
    }
    if (multiBanded && !confirmBulk) {
      setMsg(
        `You are selling ${payload.birdIds.length} birds to the same buyer. Tick the confirmation below, then confirm again.`,
      );
      return;
    }

    lock.current = true;
    setBusy(true);
    setMsg(null);
    let succeeded = false;
    const name = buyerName.trim();
    const mobile = normalizeMobile(buyerMobile);
    try {
      if (payload.mode === "banded") {
        if (payload.birdIds.length === 0) {
          setMsg("No birds selected");
          return;
        }
        const result = await recordLifecycleBulk({
          event_type: "sale",
          effective_date: soldDate,
          bird_ids: payload.birdIds,
          buyer_name: name,
          buyer_mobile: mobile,
          reason: `Sold to ${name}`,
          idempotency_key: idem.current,
        });
        setDone(true);
        succeeded = true;
        const okMsg = result.idempotent_replay
          ? `Already recorded (${result.applied}). Safe retry — no duplicates.`
          : `Sold ${result.applied} bird${result.applied === 1 ? "" : "s"} successfully.`;
        setMsg(okMsg);
        toast.success(okMsg);
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
        setMsg("This population has no hatch date, so count sale is not available.");
        return;
      }
      await recordUnbandedLifecycleByCohort({
        shed_id: payload.shedId,
        event_type: "sale",
        effective_date: soldDate,
        quantity: qty,
        buyer_name: name,
        buyer_mobile: mobile,
        reason: `Sold to ${name}`,
        idempotency_key: idem.current,
        ...ageFields,
      });
      setDone(true);
      succeeded = true;
      const okMsg = `Sold ${qty} unbanded bird${qty === 1 ? "" : "s"} successfully.`;
      setMsg(okMsg);
      toast.success(okMsg);
      onSuccess();
    } catch (e: unknown) {
      setMsg(describeApiError(e, "record sale"));
    } finally {
      setBusy(false);
      if (!succeeded) lock.current = false;
    }
  };

  if (!payload) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close sale">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={[styles.iconCircle, { backgroundColor: birdUi.orangePale }]}>
              <Ionicons name="pricetag-outline" size={20} color={birdUi.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Sell bird{payload.mode === "banded" && payload.birdIds.length > 1 ? "s" : ""}</Text>
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

          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
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
                  accessibilityLabel="Sale quantity"
                />
              </>
            )}

            <AppDatePicker
              label="Sold date"
              required
              value={soldDate}
              maximumDate={todayIsoDate()}
              onChange={(v) => setSoldDate(v ?? todayIsoDate())}
              disabled={done}
            />

            <Text style={styles.label}>Person name *</Text>
            <TextInput
              style={styles.input}
              value={buyerName}
              onChangeText={setBuyerName}
              placeholder="Buyer / person name"
              editable={!done}
              autoCapitalize="words"
              accessibilityLabel="Person name"
            />

            <Text style={styles.label}>Person mobile *</Text>
            <TextInput
              style={styles.input}
              value={buyerMobile}
              onChangeText={setBuyerMobile}
              placeholder="+91 98765 43210"
              editable={!done}
              keyboardType="phone-pad"
              accessibilityLabel="Person mobile number"
            />

            <Text style={styles.warn}>
              This marks the bird(s) as sold and removes them from active management and future
              vaccination tracking. Identity and history are preserved. Sale cannot be undone in-app.
            </Text>

            {msg ? <Text style={done ? styles.ok : styles.error}>{msg}</Text> : null}
          </ScrollView>

          {multiBanded && !done ? (
            <Pressable
              onPress={() => setConfirmBulk((v) => !v)}
              style={styles.confirmRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmBulk }}
              accessibilityLabel={`Confirm selling ${payload.birdIds.length} birds to the same buyer`}
            >
              <Ionicons
                name={confirmBulk ? "checkbox" : "square-outline"}
                size={22}
                color={birdUi.primary}
              />
              <Text style={styles.confirmText}>
                I confirm selling {payload.birdIds.length} birds to the same buyer
              </Text>
            </Pressable>
          ) : null}

          {!done ? (
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Confirm sale"
                  onPress={() => void onConfirm()}
                  loading={busy}
                  disabled={busy || (multiBanded && !confirmBulk)}
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

export function unbandedSalePayload(opts: {
  shedId: string;
  flockId: string;
  label: string;
  unbandedCount: number;
  hatch_date: string | null;
  estimated_age_days: number | null;
  age_reported_on?: string | null;
}): SaleUnbandedPayload {
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
  hint: { fontSize: 12, color: birdUi.muted },
  confirmRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 8,
    marginBottom: 4,
  },
  confirmText: { flex: 1, fontSize: 14, fontWeight: "600", color: birdUi.text, lineHeight: 20 },
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
