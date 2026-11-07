import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { describeApiError } from "../../api/client";
import { recoverSickness } from "../../api/sickness";
import { AppDatePicker } from "../ui/AppDatePicker";
import { Button } from "../ui/Button";
import { FormBottomSheet } from "../ui/FormBottomSheet";
import { compareIsoDates, formatDisplayDate, todayIsoDate } from "../ui/selectUtils";
import { birdUi } from "../../theme/birdManagementUi";
import { typography } from "../../theme/tokens";
import { toast } from "../../ui/toast/toastStore";

export type RecoverSicknessTarget = {
  recordId: string;
  label: string;
  sickDate: string;
};

type Props = {
  visible: boolean;
  target: RecoverSicknessTarget | null;
  onClose: () => void;
  onSuccess: () => void;
};

export function RecoverSicknessSheet({ visible, target, onClose, onSuccess }: Props) {
  const [recoveryDate, setRecoveryDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const confirm = async () => {
    if (!target || lock.current || busy) return;
    if (!recoveryDate) {
      setError("Recovery date is required.");
      return;
    }
    if (compareIsoDates(recoveryDate, todayIsoDate()) > 0) {
      setError("Recovery date cannot be in the future.");
      return;
    }
    if (compareIsoDates(recoveryDate, target.sickDate) < 0) {
      setError("Recovery date must be on or after the sick date.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await recoverSickness(target.recordId, {
        recovery_date: recoveryDate,
        notes: notes.trim() || null,
      });
      toast.success("Recovery recorded");
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(describeApiError(e, "record recovery"));
      lock.current = false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormBottomSheet
      visible={visible && !!target}
      onClose={onClose}
      header={
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-done-outline" size={20} color={birdUi.successText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Record recovery</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {target?.label ?? "Selected bird"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>
        </View>
      }
      footer={
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Confirm recovery" onPress={() => void confirm()} loading={busy} />
          </View>
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Sick since</Text>
          <Text style={styles.summaryValue}>
            {target ? formatDisplayDate(target.sickDate) || target.sickDate : "—"}
          </Text>
        </View>
        <AppDatePicker
          label="Recovery date"
          value={recoveryDate}
          onChange={(value) => setRecoveryDate(value ?? todayIsoDate())}
          minimumDate={target?.sickDate ?? null}
          maximumDate={todayIsoDate()}
          required
          disabled={busy}
        />
        <Text style={styles.label}>Recovery notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.notes]}
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. eating normally, back with the group"
          placeholderTextColor={birdUi.muted}
          multiline
          editable={!busy}
        />
        <Text style={styles.hint}>
          Recovery is an explicit action. A follow-up date passing does not recover a bird
          automatically.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </FormBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 4, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: birdUi.successBg,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text },
  subtitle: { fontSize: typography.caption.fontSize, color: birdUi.muted, fontWeight: "600" },
  body: { paddingHorizontal: 20, gap: 12, paddingBottom: 8 },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: birdUi.paleMint,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryLabel: { fontSize: typography.secondary.fontSize, color: birdUi.muted, fontWeight: "700" },
  summaryValue: { fontSize: typography.body.fontSize, color: birdUi.text, fontWeight: "800" },
  label: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.text },
  input: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: typography.body.fontSize,
    color: birdUi.text,
  },
  notes: { minHeight: 80, textAlignVertical: "top" },
  hint: { fontSize: typography.caption.fontSize, color: birdUi.muted, lineHeight: 17 },
  error: { color: birdUi.error, fontSize: typography.secondary.fontSize, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingTop: 4 },
});
