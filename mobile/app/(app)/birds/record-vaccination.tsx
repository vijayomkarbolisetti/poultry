/**
 * Manual / ad-hoc vaccination recording for one or more selected birds.
 * Works without catalogue assignment, scheduled doses, or auto-schedules.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  listVaccineDefinitions,
  newIdempotencyKey,
  recordManualVaccinationBatch,
  type ManualVaccinationBirdResult,
} from "../../../src/api/vaccines";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { AppDialog } from "../../../src/components/ui/AppDialog";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { typography } from "../../../src/theme/tokens";
import { toast } from "../../../src/ui/toast/toastStore";

export default function RecordVaccinationScreen() {
  const params = useLocalSearchParams<{
    shedId?: string;
    birdIds?: string;
    labels?: string;
    flockId?: string;
  }>();
  const { user, ownerAccountId } = useAuth();
  const canRecord = hasPermission(user, ownerAccountId, "vaccination.record");
  const canListVaccines = hasPermission(user, ownerAccountId, "schedule.view");
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

  const vaccines = useQuery({
    queryKey: ["vaccine-definitions", ownerAccountId],
    queryFn: () => listVaccineDefinitions(),
    enabled: canRecord && canListVaccines,
  });

  const [vaccineMode, setVaccineMode] = useState<"catalogue" | "custom">("custom");
  const [vaccineDefinitionId, setVaccineDefinitionId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [adminDate, setAdminDate] = useState(todayIsoDate());
  const [brand, setBrand] = useState("");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState<string | null>(null);
  const [strain, setStrain] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ManualVaccinationBirdResult[] | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lock = useRef(false);
  const idemKey = useRef(newIdempotencyKey("manual-vax"));

  useEffect(() => {
    idemKey.current = newIdempotencyKey("manual-vax");
    setResults(null);
    setError(null);
    lock.current = false;
  }, [birdIds.join(",")]);

  const catalogueOptions = useMemo(
    () => (vaccines.data ?? []).filter((v) => v.is_active),
    [vaccines.data],
  );

  if (!canRecord) {
    return <Redirect href="/(app)/home" />;
  }

  if (birdIds.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <Header onBack={() => safeBack()} />
        <Text style={styles.pageError}>Select at least one bird to record a vaccination.</Text>
      </SafeAreaView>
    );
  }

  const selectedVaccineName =
    vaccineMode === "catalogue"
      ? catalogueOptions.find((v) => v.id === vaccineDefinitionId)?.name ?? ""
      : customName.trim();

  const validate = (): string | null => {
    if (vaccineMode === "catalogue") {
      if (!vaccineDefinitionId) return "Select a vaccine from the catalogue, or enter a custom name.";
    } else if (!customName.trim()) {
      return "Vaccine name is required.";
    }
    if (!adminDate.trim()) return "Vaccination date is required.";
    return null;
  };

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
    lock.current = true;
    setBusy(true);
    setConfirmOpen(false);
    setError(null);
    try {
      const outcome = await recordManualVaccinationBatch({
        bird_ids: birdIds,
        flock_id: params.flockId || undefined,
        vaccine_definition_id:
          vaccineMode === "catalogue" && vaccineDefinitionId ? vaccineDefinitionId : undefined,
        custom_vaccine_name:
          vaccineMode === "custom" ? customName.trim() : undefined,
        administration_date: adminDate,
        manufacturer_or_brand: brand.trim() || null,
        lot_number: lot.trim() || null,
        product_expiry: expiry || null,
        vaccine_type_or_strain: strain.trim() || null,
        notes: notes.trim() || null,
        verification_status: "verified",
        idempotency_key: idemKey.current,
      });
      setResults(outcome.results);
      void qc.invalidateQueries({ queryKey: ["bird-profile"] });
      void qc.invalidateQueries({ queryKey: ["vaccination-events"] });
      void qc.invalidateQueries({ queryKey: ["shed-birds", params.shedId] });
      void qc.invalidateQueries({ queryKey: ["vaccination"] });
      if (outcome.failed_count === 0 && outcome.skipped_count === 0) {
        toast.success(
          outcome.success_count === 1
            ? "Vaccination recorded"
            : `Vaccination recorded for ${outcome.success_count} birds`,
        );
      } else if (outcome.success_count > 0) {
        toast.success(
          `Recorded ${outcome.success_count}; ${outcome.skipped_count} skipped; ${outcome.failed_count} failed`,
        );
      } else {
        toast.error("No vaccinations were saved");
      }
    } catch (e: unknown) {
      setError(describeApiError(e, "record the vaccination"));
      lock.current = false;
      idemKey.current = newIdempotencyKey("manual-vax");
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
            Record a vaccination for the birds selected below. Catalogue assignment is optional —
            use a custom vaccine name when the product is not in the catalogue.
          </Text>

          <View style={styles.selectedSummary}>
            <Text style={styles.selectedSummaryTitle}>
              {birdIds.length === 1
                ? "1 bird selected"
                : `${birdIds.length} birds selected`}
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
              <Text style={styles.hint}>Bird IDs: {birdIds.slice(0, 4).join(", ")}
                {birdIds.length > 4 ? ` (+${birdIds.length - 4} more)` : ""}
              </Text>
            )}
          </View>

          <Text style={styles.label}>Vaccine</Text>
          <View style={styles.segmentRow}>
            <Pressable
              style={[styles.segmentBtn, vaccineMode === "custom" && styles.segmentBtnOn]}
              onPress={() => setVaccineMode("custom")}
              disabled={busy || !!results}
            >
              <Text
                style={[styles.segmentText, vaccineMode === "custom" && styles.segmentTextOn]}
              >
                Custom name
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentBtn, vaccineMode === "catalogue" && styles.segmentBtnOn]}
              onPress={() => {
                if (!canListVaccines) return;
                setVaccineMode("catalogue");
              }}
              disabled={busy || !!results || !canListVaccines}
            >
              <Text
                style={[
                  styles.segmentText,
                  vaccineMode === "catalogue" && styles.segmentTextOn,
                  !canListVaccines && { opacity: 0.45 },
                ]}
              >
                From catalogue
              </Text>
            </Pressable>
          </View>

          {vaccineMode === "custom" ? (
            <TextInput
              style={styles.input}
              value={customName}
              onChangeText={setCustomName}
              placeholder="Vaccine name (required)"
              placeholderTextColor={birdUi.muted}
              editable={!busy && !results}
              autoCapitalize="words"
            />
          ) : vaccines.isLoading ? (
            <ActivityIndicator color={birdUi.primary} />
          ) : catalogueOptions.length === 0 ? (
            <Text style={styles.hint}>
              No catalogue vaccines available. Switch to Custom name to record without a catalogue
              entry.
            </Text>
          ) : (
            <View style={styles.optionList}>
              {catalogueOptions.map((v) => {
                const selected = v.id === vaccineDefinitionId;
                return (
                  <Pressable
                    key={v.id}
                    style={[styles.optionRow, selected && styles.optionRowOn]}
                    onPress={() => setVaccineDefinitionId(v.id)}
                    disabled={busy || !!results}
                  >
                    <Text style={styles.optionTitle}>{v.name}</Text>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={20} color={birdUi.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          <AppDatePicker
            label="Vaccination date"
            value={adminDate}
            onChange={(v) => setAdminDate(v ?? todayIsoDate())}
            required
            disabled={busy || !!results}
          />

          <Text style={styles.label}>Manufacturer / brand (optional)</Text>
          <TextInput
            style={styles.input}
            value={brand}
            onChangeText={setBrand}
            placeholder="Manufacturer or brand"
            placeholderTextColor={birdUi.muted}
            editable={!busy && !results}
          />

          <Text style={styles.label}>Batch / lot number (optional)</Text>
          <TextInput
            style={styles.input}
            value={lot}
            onChangeText={setLot}
            placeholder="Lot number"
            placeholderTextColor={birdUi.muted}
            editable={!busy && !results}
          />

          <AppDatePicker
            label="Expiry date (optional)"
            value={expiry}
            onChange={setExpiry}
            clearable
            disabled={busy || !!results}
          />

          <Text style={styles.label}>Vaccine type / strain (optional)</Text>
          <TextInput
            style={styles.input}
            value={strain}
            onChangeText={setStrain}
            placeholder="Type or strain"
            placeholderTextColor={birdUi.muted}
            editable={!busy && !results}
          />

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput
            style={[styles.input, styles.notes]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes"
            placeholderTextColor={birdUi.muted}
            editable={!busy && !results}
            multiline
          />

          {error ? <Text style={styles.pageError}>{error}</Text> : null}

          {results ? (
            <View style={styles.resultsBox}>
              <Text style={styles.resultsTitle}>Results</Text>
              {results.map((row) => {
                const label =
                  labels[birdIds.indexOf(row.bird_id)] ?? row.bird_id.slice(0, 8);
                const tone =
                  row.status === "success"
                    ? birdUi.primary
                    : row.status === "skipped"
                      ? "#B45309"
                      : birdUi.error;
                return (
                  <View key={row.bird_id} style={styles.resultRow}>
                    <Text style={[styles.resultStatus, { color: tone }]}>
                      {String(row.status).toUpperCase()}
                    </Text>
                    <Text style={styles.resultLabel}>{label}</Text>
                    {row.message ? <Text style={styles.resultMsg}>{row.message}</Text> : null}
                  </View>
                );
              })}
              <Pressable style={styles.doneBtn} onPress={() => safeBack()}>
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.submitBtn, busy && { opacity: 0.6 }]}
              onPress={onSubmit}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Record vaccination</Text>
              )}
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <AppDialog
        visible={confirmOpen}
        title="Confirm vaccination"
        description={`Record ${selectedVaccineName || "this vaccine"} for ${birdIds.length} bird${birdIds.length === 1 ? "" : "s"} on ${adminDate}?`}
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
      <Text style={styles.headerTitle}>Record vaccination</Text>
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
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  moreBirds: { alignSelf: "center", color: birdUi.muted, fontWeight: "600" },
  label: {
    marginTop: 10,
    fontSize: typography.label.fontSize,
    fontWeight: "700",
    color: birdUi.text,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: typography.body.fontSize,
    color: birdUi.text,
  },
  notes: { minHeight: 88, textAlignVertical: "top" },
  segmentRow: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  segmentBtnOn: { backgroundColor: birdUi.paleMint },
  segmentText: { fontWeight: "700", color: birdUi.muted, fontSize: typography.secondary.fontSize },
  segmentTextOn: { color: birdUi.primary },
  optionList: { gap: 6 },
  optionRow: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionRowOn: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  optionTitle: { fontWeight: "700", color: birdUi.text, flex: 1 },
  hint: { color: birdUi.muted, fontWeight: "600", fontSize: typography.caption.fontSize },
  pageError: { color: birdUi.error, fontWeight: "600", marginTop: 8 },
  submitBtn: {
    marginTop: 16,
    backgroundColor: birdUi.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: typography.label.fontSize },
  resultsBox: {
    marginTop: 16,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 10,
  },
  resultsTitle: { fontWeight: "800", color: birdUi.text, fontSize: typography.sectionTitle.fontSize },
  resultRow: { gap: 2 },
  resultStatus: { fontWeight: "800", fontSize: typography.caption.fontSize },
  resultLabel: { fontWeight: "700", color: birdUi.text },
  resultMsg: { color: birdUi.muted, fontWeight: "600", fontSize: typography.caption.fontSize },
  doneBtn: {
    marginTop: 8,
    backgroundColor: birdUi.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  doneBtnText: { color: "#fff", fontWeight: "800" },
});
