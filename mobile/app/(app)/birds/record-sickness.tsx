/**
 * Record a sickness episode for one or more individually registered (banded) birds.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { describeApiError } from "../../../src/api/client";
import { recordBirdSickness, recordBulkSickness } from "../../../src/api/sickness";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { AppDialog } from "../../../src/components/ui/AppDialog";
import { compareIsoDates, todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { newLifecycleIdempotencyKey } from "../../../src/features/birds/birdSelectionHelpers";
import {
  SEVERITY_OPTIONS,
  buildSicknessPayload,
  validateSicknessForm,
} from "../../../src/features/sickness/sicknessHelpers";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { typography } from "../../../src/theme/tokens";
import { toast } from "../../../src/ui/toast/toastStore";

export default function RecordSicknessScreen() {
  const params = useLocalSearchParams<{
    formKey?: string;
    birdIds?: string;
  }>();
  const formKey = String(params.formKey ?? params.birdIds ?? "new");
  return <RecordSicknessForm key={formKey} />;
}

function RecordSicknessForm() {
  const params = useLocalSearchParams<{
    shedId?: string;
    birdIds?: string;
    labels?: string;
  }>();
  const { user, ownerAccountId } = useAuth();
  const canRecord = hasPermission(user, ownerAccountId, "sickness.record");
  const qc = useQueryClient();

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

  const [sickDate, setSickDate] = useState(todayIsoDate());
  const [symptoms, setSymptoms] = useState("");
  const [severity, setSeverity] = useState<"" | "mild" | "moderate" | "severe">("moderate");
  const [notes, setNotes] = useState("");
  const [treatment, setTreatment] = useState("");
  const [followUpDate, setFollowUpDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lock = useRef(false);
  const idemKey = useRef(newLifecycleIdempotencyKey("sickness"));

  if (!canRecord) {
    return <Redirect href="/(app)/home" />;
  }

  if (birdIds.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <Header onBack={() => safeBack()} />
        <Text style={styles.pageError}>Select at least one bird to record sickness.</Text>
      </SafeAreaView>
    );
  }

  const validate = () =>
    validateSicknessForm({ sickDate, symptoms, severity, followUpDate });

  const onSubmit = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const confirmRecord = async () => {
    if (lock.current || busy) return;
    const err = validate();
    if (err) {
      setConfirmOpen(false);
      setError(err);
      return;
    }
    lock.current = true;
    setBusy(true);
    setConfirmOpen(false);
    setError(null);
    try {
      const payload = {
        ...buildSicknessPayload(
          { sickDate, symptoms, severity, followUpDate },
          { idempotencyKey: idemKey.current },
        ),
        notes: notes.trim() || null,
        treatment: treatment.trim() || null,
      };
      if (birdIds.length === 1) {
        await recordBirdSickness(birdIds[0], payload);
      } else {
        await recordBulkSickness({ ...payload, bird_ids: birdIds });
      }
      toast.success(
        birdIds.length === 1
          ? "Sickness recorded"
          : `Sickness recorded for ${birdIds.length} birds`,
      );
      void qc.invalidateQueries({ queryKey: ["bird-profile"] });
      void qc.invalidateQueries({ queryKey: ["shed-birds"] });
      void qc.invalidateQueries({ queryKey: ["shed-birds-summary"] });
      void qc.invalidateQueries({ queryKey: ["shed-overview"] });
      void qc.invalidateQueries({ queryKey: ["sickness"] });
      void qc.invalidateQueries({ queryKey: ["sickness-summary"] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      safeBack(params.shedId ? `/(app)/sheds/${params.shedId}/birds` : "/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "record sickness"));
      lock.current = false;
      idemKey.current = newLifecycleIdempotencyKey("sickness");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Header onBack={() => safeBack()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.lead}>
            Record a sickness episode for the selected birds. Each bird receives its own
            episode and keeps any older history.
          </Text>

          <View style={styles.selectedSummary}>
            <Text style={styles.selectedSummaryTitle}>
              {birdIds.length === 1 ? "1 bird selected" : `${birdIds.length} birds selected`}
            </Text>
            {labels.length > 0 ? (
              <View style={styles.birdList}>
                {labels.slice(0, 8).map((label) => (
                  <Text key={label} style={styles.birdChip}>
                    {label}
                  </Text>
                ))}
                {labels.length > 8 ? (
                  <Text style={styles.moreBirds}>+{labels.length - 8} more</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.hint}>
                Bird IDs: {birdIds.slice(0, 4).join(", ")}
                {birdIds.length > 4 ? ` (+${birdIds.length - 4} more)` : ""}
              </Text>
            )}
          </View>

          <AppDatePicker
            label="Sick date"
            value={sickDate}
            onChange={(value) => {
              const next = value ?? todayIsoDate();
              setSickDate(next);
              if (followUpDate && compareIsoDates(followUpDate, next) < 0) {
                setFollowUpDate(null);
              }
            }}
            maximumDate={todayIsoDate()}
            required
            disabled={busy}
          />

          <Text style={styles.label}>
            Symptoms and observations <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={symptoms}
            onChangeText={setSymptoms}
            placeholder="e.g. reduced appetite, lethargy, labored breathing"
            placeholderTextColor={birdUi.muted}
            multiline
            editable={!busy}
          />

          <Text style={styles.label}>
            Severity <Text style={styles.required}>*</Text>
          </Text>
          <View style={styles.severityRow}>
            {SEVERITY_OPTIONS.map((option) => {
              const on = severity === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setSeverity(option.value)}
                  style={[styles.severityChip, on && styles.severityChipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  disabled={busy}
                >
                  <Text style={[styles.severityText, on && styles.severityTextOn]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Additional observations"
            placeholderTextColor={birdUi.muted}
            multiline
            editable={!busy}
          />

          <Text style={styles.label}>Treatment or medicine given (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={treatment}
            onChangeText={setTreatment}
            placeholder="Treatment details"
            placeholderTextColor={birdUi.muted}
            multiline
            editable={!busy}
          />

          <AppDatePicker
            label="Follow-up date (optional)"
            value={followUpDate}
            onChange={setFollowUpDate}
            minimumDate={sickDate}
            clearable
            disabled={busy}
          />
          <Text style={styles.hint}>
            Follow-up dates are reminders. A bird is only recovered when you explicitly record
            recovery.
          </Text>

          {error ? <Text style={styles.pageError}>{error}</Text> : null}

          <Pressable
            style={[styles.submitBtn, busy && { opacity: 0.6 }]}
            onPress={onSubmit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>
                {birdIds.length === 1 ? "Record sickness" : `Record sickness for ${birdIds.length} birds`}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <AppDialog
        visible={confirmOpen}
        title="Confirm sickness episode"
        description={`Record a ${severity || "selected"} sickness episode for ${birdIds.length} bird${birdIds.length === 1 ? "" : "s"} on ${sickDate}?`}
        onDismiss={() => setConfirmOpen(false)}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          onPress: () => setConfirmOpen(false),
        }}
        primary={{
          label: "Confirm",
          variant: "primary",
          onPress: () => void confirmRecord(),
        }}
      />
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back" style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={birdUi.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Record sickness</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: birdUi.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: birdUi.bg,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "700",
    color: birdUi.text,
  },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  lead: {
    fontSize: typography.secondary.fontSize,
    color: birdUi.muted,
    fontWeight: "600",
    lineHeight: 20,
    marginBottom: 4,
  },
  selectedSummary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    padding: 12,
    gap: 8,
    marginBottom: 4,
  },
  selectedSummaryTitle: {
    fontWeight: "800",
    color: birdUi.text,
    fontSize: typography.body.fontSize,
  },
  birdList: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  birdChip: {
    backgroundColor: birdUi.paleMint,
    color: birdUi.primary,
    fontWeight: "700",
    fontSize: typography.caption.fontSize,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
  },
  moreBirds: { color: birdUi.muted, fontSize: typography.caption.fontSize, fontWeight: "600" },
  hint: { color: birdUi.muted, fontSize: typography.caption.fontSize, lineHeight: 17 },
  label: {
    fontSize: typography.label.fontSize,
    fontWeight: "700",
    color: birdUi.text,
    marginTop: 6,
  },
  required: { color: birdUi.error },
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
  multiline: { minHeight: 84, textAlignVertical: "top" },
  severityRow: { flexDirection: "row", gap: 8 },
  severityChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 12,
    backgroundColor: "#fff",
    paddingVertical: 12,
    alignItems: "center",
  },
  severityChipOn: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  severityText: { color: birdUi.textSecondary, fontWeight: "700", fontSize: typography.label.fontSize },
  severityTextOn: { color: birdUi.primary, fontWeight: "800" },
  pageError: {
    color: birdUi.error,
    fontWeight: "600",
    fontSize: typography.secondary.fontSize,
    marginTop: 6,
  },
  submitBtn: {
    marginTop: 12,
    backgroundColor: birdUi.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: typography.button.fontSize },
});
