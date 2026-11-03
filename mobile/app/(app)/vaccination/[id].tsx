import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { describeApiError } from "../../../src/api/client";
import { listBirds } from "../../../src/api/flocks";
import {
  getScheduledDose,
  listVaccinationEvents,
  newIdempotencyKey,
  recordVaccination,
  recordVaccinationBatch,
} from "../../../src/api/vaccines";
import { VaccinationBirdSelector } from "../../../src/components/vaccination/VaccinationBirdSelector";
import { AppDialog } from "../../../src/components/ui/AppDialog";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { pruneIneligibleSelection } from "../../../src/features/vaccination/birdSelectionHelpers";
import {
  daysPastDue,
  formatDueDateLabel,
  remainingCount,
  statusBadgeLabel,
  bucketForDose,
} from "../../../src/features/vaccination/dashboardHelpers";
import { safeBack } from "../../../src/navigation/safeBack";
import { shedHeaderArt } from "../../../src/theme/media";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { toast } from "../../../src/ui/toast/toastStore";
import { typography } from "../../../src/theme/tokens";


type CoverageMode = "all" | "partial" | "birds";

type PendingRecord = {
  effectiveMode: CoverageMode;
  birdsCovered: number;
  birdIds: string[];
  confirmBody: string;
};

type InfoDialog = { title: string; description: string };

export default function VaccinationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "vaccination.view");
  const canRecord = hasPermission(user, ownerAccountId, "vaccination.record");
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const doseQuery = useQuery({
    queryKey: ["vaccination-dose", id, ownerAccountId],
    queryFn: () => getScheduledDose(id!),
    enabled: Boolean(id) && canView,
  });

  const dose = doseQuery.data;

  const remaining = dose
    ? dose.remaining_count != null
      ? Math.max(0, dose.remaining_count)
      : remainingCount(dose.eligible_count, dose.completed_count)
    : 0;

  const birdsQuery = useQuery({
    queryKey: ["flock-birds", dose?.flock_id],
    queryFn: () => listBirds(dose!.flock_id),
    enabled: Boolean(dose?.flock_id) && canRecord,
  });

  const eventsQuery = useQuery({
    queryKey: ["vaccination-events", dose?.flock_id, ownerAccountId],
    queryFn: () => listVaccinationEvents(dose!.flock_id),
    enabled: Boolean(dose?.flock_id) && canRecord,
  });

  const [mode, setMode] = useState<CoverageMode>("all");
  const [partialCount, setPartialCount] = useState("");
  const [selectedBirds, setSelectedBirds] = useState<Set<string>>(new Set());
  const [birdPickerOpen, setBirdPickerOpen] = useState(false);
  const [adminDate, setAdminDate] = useState(todayIsoDate());
  const [productExpiry, setProductExpiry] = useState<string | null>(null);
  const [brand, setBrand] = useState("");
  const [lot, setLot] = useState("");
  const [busy, setBusy] = useState(false);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey("vax"));
  const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(null);
  const [infoDialog, setInfoDialog] = useState<InfoDialog | null>(null);

  const doseId = dose?.id ?? id ?? "";

  // Remount-friendly reset when navigating between doses (Expo often reuses the route).
  const [formKey, setFormKey] = useState(doseId);
  if (doseId && formKey !== doseId) {
    setFormKey(doseId);
    setIdemKey(newIdempotencyKey("vax"));
    setMode("all");
    setPartialCount("");
    setSelectedBirds(new Set());
    setBirdPickerOpen(false);
    setBusy(false);
    setPendingRecord(null);
    setInfoDialog(null);
    setAdminDate(todayIsoDate());
    setProductExpiry(null);
    setBrand("");
    setLot("");
  }

  const activeBirds = useMemo(
    () => (birdsQuery.data ?? []).filter((b) => b.is_active && b.band_id),
    [birdsQuery.data],
  );

  const alreadyVaccinatedIds = useMemo(() => {
    const set = new Set<string>();
    if (!dose) return set;
    for (const ev of eventsQuery.data ?? []) {
      if (ev.is_void || !ev.bird_id) continue;
      if (ev.scheduled_dose_id !== dose.id) continue;
      set.add(ev.bird_id);
    }
    return set;
  }, [eventsQuery.data, dose]);

  const eligibleSelectedBirds = useMemo(
    () => pruneIneligibleSelection(selectedBirds, alreadyVaccinatedIds),
    [selectedBirds, alreadyVaccinatedIds],
  );

  const showSelectBirdsMode = (dose?.banded_count ?? 0) > 0 || activeBirds.length > 0;
  const coverageMode = mode === "birds" && !showSelectBirdsMode ? "all" : mode;

  if (!canView) return <Redirect href="/(app)/home" />;

  const bucket = dose ? bucketForDose(dose) : null;
  const pastDue = dose ? daysPastDue(dose.due_date) : null;
  const population =
    (dose?.banded_count ?? 0) + (dose?.unbanded_count ?? 0) || dose?.eligible_count || 0;
  const alreadyVaccinated = dose?.completed_count ?? 0;
  const scheduleAgeHint = dose?.flock_label?.trim() || null;

  const onRecord = () => {
    if (!dose || !canRecord) return;
    if (remaining <= 0) {
      setInfoDialog({
        title: "Nothing remaining",
        description: "This dose is already fully covered.",
      });
      return;
    }

    let birdsCovered = remaining;
    let birdIds: string[] = [];
    const effectiveMode = mode === "birds" && !showSelectBirdsMode ? "all" : mode;

    if (effectiveMode === "partial") {
      const n = Number(partialCount);
      if (!Number.isInteger(n) || n < 1) {
        setInfoDialog({
          title: "Enter coverage",
          description: "Enter how many birds were actually vaccinated.",
        });
        return;
      }
      if (n > remaining) {
        setInfoDialog({
          title: "Too many",
          description: `Only ${remaining} birds remain for this dose.`,
        });
        return;
      }
      birdsCovered = n;
    } else if (effectiveMode === "birds") {
      birdIds = [...eligibleSelectedBirds];
      if (!birdIds.length) {
        setInfoDialog({
          title: "Select birds",
          description: "Choose at least one eligible banded bird.",
        });
        return;
      }
      if (birdIds.length > remaining) {
        setInfoDialog({
          title: "Too many",
          description: `Only ${remaining} birds remain for this dose.`,
        });
        return;
      }
    }

    const vaccineLabel = dose.vaccine_name?.trim() || "this vaccine";
    const shedLabel = dose.shed_name?.trim() || "this shed";
    const countLabel =
      effectiveMode === "birds"
        ? `${birdIds.length} selected bird${birdIds.length === 1 ? "" : "s"}`
        : `${birdsCovered} bird${birdsCovered === 1 ? "" : "s"}`;
    setPendingRecord({
      effectiveMode,
      birdsCovered,
      birdIds,
      confirmBody: `${vaccineLabel}\n${shedLabel}\nRecord for ${countLabel}?`,
    });
  };

  const submitPendingRecord = async () => {
    if (!dose || !pendingRecord) return;
    const { effectiveMode, birdsCovered, birdIds } = pendingRecord;
    setBusy(true);
    try {
      const shared = {
        administration_date: adminDate,
        product_expiry: productExpiry,
        manufacturer_or_brand: brand.trim() || null,
        lot_number: lot.trim() || null,
        route: null as string | null,
        dose_amount: null as string | null,
        notes: null as string | null,
      };
      if (effectiveMode === "birds") {
        for (let i = 0; i < birdIds.length; i += 1) {
          await recordVaccination({
            scheduled_dose_id: dose.id,
            bird_id: birdIds[i],
            birds_covered: 1,
            idempotency_key: `${idemKey}-b${i}`.slice(0, 100),
            ...shared,
          });
        }
      } else {
        await recordVaccinationBatch({
          items: [{ scheduled_dose_id: dose.id, birds_covered: birdsCovered }],
          idempotency_key: idemKey,
          ...shared,
        });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["vaccination"] }),
        qc.invalidateQueries({ queryKey: ["vaccination-dose", id] }),
        qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] }),
        qc.invalidateQueries({ queryKey: ["shed-overview"] }),
        qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] }),
      ]);
      const stillOpen =
        effectiveMode === "partial"
          ? Number(partialCount) < remaining
          : effectiveMode === "birds"
            ? birdIds.length < remaining
            : false;
      toast.success(
        stillOpen
          ? "Vaccination recorded. Dose stays open until remaining birds are covered."
          : "Vaccination recorded",
      );
      setIdemKey(newIdempotencyKey("vax"));
      setPendingRecord(null);
      router.replace("/(app)/vaccination");
    } catch (e) {
      const msg = describeApiError(e, "record vaccination");
      if (/idempotency|already used|conflict/i.test(msg)) {
        setIdemKey(newIdempotencyKey("vax"));
      }
      setPendingRecord(null);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = bucket ? statusBadgeLabel(bucket) : null;
  const isOverdue = bucket === "overdue";
  const dueSince =
    isOverdue && pastDue != null && pastDue > 0
      ? `Due since ${pastDue} day${pastDue === 1 ? "" : "s"}`
      : bucket === "due_today"
        ? "Due today"
        : dose
          ? `Due ${formatDueDateLabel(dose.due_date)}`
          : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.hero}>
          <Image source={shedHeaderArt} style={styles.heroArt} resizeMode="cover" />
          <View style={styles.heroRow}>
            <Pressable onPress={() => safeBack("/(app)/vaccination")} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={birdUi.primary} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Record Vaccination</Text>
              <Text style={styles.heroSub} numberOfLines={1}>
                {dose?.shed_name?.trim() || "Shed"} · {dose?.vaccine_name?.trim() || "Vaccine"}
              </Text>
            </View>
          </View>
        </View>

        {doseQuery.isLoading && !dose ? (
          <View style={styles.center}>
            <HenLoader label="Loading…" />
          </View>
        ) : doseQuery.error ? (
          <View style={styles.centerPad}>
            <Text style={styles.muted}>{describeApiError(doseQuery.error, "load dose")}</Text>
          </View>
        ) : !dose ? (
          <View style={styles.centerPad}>
            <Text style={styles.muted}>This vaccination was not found or is no longer open.</Text>
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={[
                styles.content,
                { paddingBottom: Math.max(insets.bottom, 12) + (canRecord && remaining > 0 ? 88 : 24) },
              ]}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.statusCard, isOverdue && styles.statusCardOverdue]}>
                <View style={styles.statusTop}>
                  <Text style={styles.vaccineName} numberOfLines={1}>
                    {dose.vaccine_name?.trim() || "Vaccine"}
                  </Text>
                  {statusLabel ? (
                    <View style={[styles.badge, isOverdue ? styles.badgeOverdue : styles.badgeDue]}>
                      <Text style={[styles.badgeText, isOverdue && { color: ui.overdueText }]}>
                        {statusLabel}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {scheduleAgeHint ? (
                  <Text style={styles.scheduleLine}>Scheduled · {scheduleAgeHint}</Text>
                ) : (
                  <Text style={styles.scheduleLine}>Due {formatDueDateLabel(dose.due_date)}</Text>
                )}
                {dueSince ? (
                  <View style={styles.dueRow}>
                    <Ionicons
                      name="time-outline"
                      size={14}
                      color={isOverdue ? ui.overdueText : birdUi.orange}
                    />
                    <Text style={[styles.dueText, isOverdue && { color: ui.overdueText }]}>
                      {dueSince}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.card}>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>
                    Shed: <Text style={styles.metaValue}>{dose.shed_name ?? "—"}</Text>
                  </Text>
                  <Text style={styles.metaLabel}>
                    Eligible birds: <Text style={styles.metaValue}>{remaining}</Text>
                  </Text>
                </View>
                <Text style={styles.popLine}>
                  Population: {population} · Already vaccinated: {alreadyVaccinated}
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${
                          population > 0
                            ? Math.min(100, Math.round((alreadyVaccinated / population) * 100))
                            : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
              </View>

              {canRecord && remaining > 0 ? (
                <>
                  <View style={styles.card}>
                    <Text style={styles.section}>Birds to Vaccinate</Text>

                    <RadioRow
                      selected={coverageMode === "all"}
                      title={`All remaining eligible birds (${remaining})`}
                      subtitle="Recommended"
                      subtitleTone="ok"
                      onPress={() => setMode("all")}
                    />
                    {showSelectBirdsMode ? (
                      <RadioRow
                        selected={coverageMode === "birds"}
                        title="Select specific birds"
                        subtitle={
                          eligibleSelectedBirds.size > 0
                            ? `${eligibleSelectedBirds.size} selected`
                            : "Choose banded birds"
                        }
                        onPress={() => {
                          setMode("birds");
                          setBirdPickerOpen(true);
                        }}
                      />
                    ) : null}
                    <RadioRow
                      selected={coverageMode === "partial"}
                      title="Record for unbanded birds (batch)"
                      subtitle="Enter number of birds"
                      onPress={() => setMode("partial")}
                    />
                    {coverageMode === "partial" ? (
                      <TextInput
                        style={styles.input}
                        keyboardType="number-pad"
                        placeholder={`Number vaccinated (max ${remaining})`}
                        placeholderTextColor={ui.muted}
                        value={partialCount}
                        onChangeText={setPartialCount}
                      />
                    ) : null}
                    {coverageMode === "birds" && eligibleSelectedBirds.size > 0 ? (
                      <Pressable onPress={() => setBirdPickerOpen(true)}>
                        <Text style={styles.link}>Change selection</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.section}>Vaccination Details</Text>
                    <AppDatePicker
                      label="Administered date"
                      value={adminDate}
                      onChange={(v) => setAdminDate(v ?? todayIsoDate())}
                      maximumDate={todayIsoDate()}
                      placeholder="Today"
                    />
                    <Text style={styles.fieldLabel}>Brand / Manufacturer</Text>
                    <TextInput
                      style={styles.input}
                      value={brand}
                      onChangeText={setBrand}
                      placeholder="e.g. Venkeys"
                      placeholderTextColor={ui.muted}
                      autoCapitalize="words"
                    />
                    <View style={styles.row2}>
                      <View style={styles.half}>
                        <Text style={styles.fieldLabel}>Batch / Lot no.</Text>
                        <TextInput
                          style={styles.input}
                          value={lot}
                          onChangeText={setLot}
                          placeholder="Lot"
                          placeholderTextColor={ui.muted}
                        />
                      </View>
                      <View style={styles.half}>
                        <AppDatePicker
                          label="Expiry date"
                          value={productExpiry}
                          onChange={setProductExpiry}
                          minimumDate={todayIsoDate()}
                          clearable
                          placeholder="Select"
                        />
                      </View>
                    </View>
                  </View>
                </>
              ) : null}

              {canRecord && remaining <= 0 ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>No remaining coverage on this dose.</Text>
                </View>
              ) : null}

              {!canRecord ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>
                    You can view this dose but do not have permission to record.
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            {canRecord && remaining > 0 ? (
              <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <Pressable
                  style={[styles.recordBtn, busy && { opacity: 0.55 }]}
                  disabled={busy}
                  onPress={onRecord}
                  accessibilityRole="button"
                  accessibilityLabel="Record vaccination"
                >
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.recordBtnText}>
                    {busy ? "Saving…" : "Record Vaccination"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>

      <VaccinationBirdSelector
        visible={birdPickerOpen && coverageMode === "birds"}
        birds={birdsQuery.data ?? []}
        alreadyVaccinatedIds={alreadyVaccinatedIds}
        remaining={remaining}
        selectedIds={eligibleSelectedBirds}
        onChange={setSelectedBirds}
        loading={birdsQuery.isLoading || eventsQuery.isLoading}
        onContinue={() => setBirdPickerOpen(false)}
        onClose={() => setBirdPickerOpen(false)}
      />

      <AppDialog
        visible={Boolean(pendingRecord)}
        title="Confirm vaccination"
        description={pendingRecord?.confirmBody}
        tone="neutral"
        icon="medkit-outline"
        dismissible={!busy}
        onDismiss={() => {
          if (!busy) setPendingRecord(null);
        }}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          disabled: busy,
          onPress: () => setPendingRecord(null),
        }}
        primary={{
          label: "Record",
          variant: "primary",
          loading: busy,
          onPress: () => void submitPendingRecord(),
        }}
      />

      <AppDialog
        visible={Boolean(infoDialog)}
        title={infoDialog?.title ?? ""}
        description={infoDialog?.description}
        tone="warning"
        onDismiss={() => setInfoDialog(null)}
        primary={{
          label: "OK",
          variant: "primary",
          onPress: () => setInfoDialog(null),
        }}
      />
    </SafeAreaView>
  );
}

function RadioRow({
  selected,
  title,
  subtitle,
  subtitleTone,
  onPress,
}: {
  selected: boolean;
  title: string;
  subtitle?: string;
  subtitleTone?: "ok" | "muted";
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.radioRow, selected && styles.radioRowOn]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View style={[styles.radioOuter, selected && styles.radioOuterOn]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.radioTitle}>{title}</Text>
        {subtitle ? (
          <Text
            style={[
              styles.radioSub,
              subtitleTone === "ok" ? styles.radioSubOk : null,
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: birdUi.bg },
  flex: { flex: 1 },
  hero: {
    minHeight: 88,
    overflow: "hidden",
    backgroundColor: birdUi.paleMint,
  },
  heroArt: { ...StyleSheet.absoluteFill, opacity: 0.4 },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.deepGreen },
  heroSub: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted, marginTop: 2 },
  content: { paddingHorizontal: 16, gap: 12, paddingTop: 12 },
  statusCard: {
    backgroundColor: "#FFF6E5",
    borderRadius: 16,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#F5D9A8",
  },
  statusCardOverdue: {
    backgroundColor: ui.overdueBg,
    borderColor: "#F5C2C0",
  },
  statusTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  vaccineName: { flex: 1, fontSize: typography.overline.fontSize, fontWeight: "800", color: birdUi.text },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: ui.dueBg,
  },
  badgeOverdue: { backgroundColor: "#FAD4D4" },
  badgeDue: { backgroundColor: "#FFE8C7" },
  badgeText: { fontSize: typography.overline.fontSize, fontWeight: "800", color: ui.dueText },
  scheduleLine: { fontSize: typography.secondary.fontSize, fontWeight: "600", color: birdUi.muted },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dueText: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.orange },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 10,
  },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  metaLabel: { fontSize: typography.secondary.fontSize, fontWeight: "600", color: birdUi.muted },
  metaValue: { fontWeight: "800", color: birdUi.text },
  popLine: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: ui.progressTrack,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: birdUi.primary },
  section: { fontSize: typography.body.fontSize, fontWeight: "800", color: birdUi.deepGreen },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: birdUi.bg,
  },
  radioRowOn: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: birdUi.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterOn: { borderColor: birdUi.primary },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: birdUi.primary,
  },
  radioTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text },
  radioSub: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted, marginTop: 2 },
  radioSubOk: { color: birdUi.successText },
  fieldLabel: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.muted },
  input: {
    backgroundColor: birdUi.bg,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: birdUi.text,
    minHeight: 48,
  },
  row2: { flexDirection: "row", gap: 10 },
  half: { flex: 1, gap: 4 },
  link: { fontSize: typography.secondary.fontSize, fontWeight: "800", color: birdUi.primary },
  hint: { fontSize: typography.secondary.fontSize, color: birdUi.muted, fontWeight: "600", lineHeight: 18 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: birdUi.border,
    backgroundColor: birdUi.bg,
  },
  recordBtn: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: birdUi.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  recordBtnText: { fontSize: typography.bodyStrong.fontSize, fontWeight: "800", color: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { padding: 20 },
  muted: { color: ui.muted, fontWeight: "600" },
});
