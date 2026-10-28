import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getCatalogue, getCatalogueAssignment } from "../../../src/api/catalogues";
import { describeApiError } from "../../../src/api/client";
import { listBirds } from "../../../src/api/flocks";
import {
  getScheduledDose,
  newIdempotencyKey,
  recordVaccination,
  recordVaccinationBatch,
  type ScheduledDose,
} from "../../../src/api/vaccines";
import { Button } from "../../../src/components/ui/Button";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  coverageLine,
  daysPastDue,
  formatDueDateLabel,
  populationHint,
  remainingCount,
  statusBadgeLabel,
  bucketForDose,
} from "../../../src/features/vaccination/dashboardHelpers";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { safeBack } from "../../../src/navigation/safeBack";

type CoverageMode = "all" | "partial" | "birds";
type TabKey = "overview" | "details";

export default function VaccinationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, ownerAccountId } = useAuth();
  const canView = hasPermission(user, ownerAccountId, "vaccination.view");
  const canRecord = hasPermission(user, ownerAccountId, "vaccination.record");
  const canCatalogue = hasPermission(user, ownerAccountId, "schedule.view");
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("overview");
  const [showRecordForm, setShowRecordForm] = useState(false);

  const doseQuery = useQuery({
    queryKey: ["vaccination-dose", id, ownerAccountId],
    queryFn: () => getScheduledDose(id!),
    enabled: Boolean(id) && canView,
  });

  const dose = doseQuery.data;

  const guidanceQuery = useQuery({
    queryKey: ["vaccination-guidance", dose?.vaccine_name, ownerAccountId],
    enabled: Boolean(dose?.vaccine_name) && canCatalogue,
    queryFn: async () => {
      const assignment = await getCatalogueAssignment();
      if (!assignment?.catalogue_id) return null;
      const cat = await getCatalogue(assignment.catalogue_id);
      const name = (dose?.vaccine_name ?? "").trim().toLowerCase();
      const item = cat.items.find((i) => (i.name ?? "").trim().toLowerCase() === name) ?? null;
      return { catalogueId: cat.id, catalogueName: cat.name, item };
    },
  });
  const remaining = dose
    ? dose.remaining_count != null
      ? Math.max(0, dose.remaining_count)
      : remainingCount(dose.eligible_count, dose.completed_count)
    : 0;

  const birdsQuery = useQuery({
    queryKey: ["flock-birds", dose?.flock_id],
    queryFn: () => listBirds(dose!.flock_id),
    enabled: Boolean(dose?.flock_id) && canRecord && showRecordForm,
  });

  const [mode, setMode] = useState<CoverageMode>("all");
  const [partialCount, setPartialCount] = useState("");
  const [selectedBirds, setSelectedBirds] = useState<Set<string>>(new Set());
  const [adminDate, setAdminDate] = useState(todayIsoDate());
  const [productExpiry, setProductExpiry] = useState<string | null>(null);
  const [route, setRoute] = useState("");
  const [doseAmount, setDoseAmount] = useState("");
  const [brand, setBrand] = useState("");
  const [lot, setLot] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Must rotate when dose id changes — Expo Router often reuses this screen instance,
  // and reusing a batch idempotency key silently replays a *different* prior dose.
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey("vax"));
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);

  useEffect(() => {
    setIdemKey(newIdempotencyKey("vax"));
    setShowRecordForm(false);
    setShowOptionalDetails(false);
    setMode("all");
    setPartialCount("");
    setSelectedBirds(new Set());
    setBusy(false);
  }, [id]);

  const activeBirds = useMemo(
    () => (birdsQuery.data ?? []).filter((b) => b.is_active && b.band_id),
    [birdsQuery.data],
  );
  /** Unbanded-only populations cannot use per-bird selection; hide that mode. */
  const showSelectBirdsMode =
    (dose?.banded_count ?? 0) > 0 || activeBirds.length > 0;
  const coverageMode = mode === "birds" && !showSelectBirdsMode ? "all" : mode;

  if (!canView) return <Redirect href="/(app)/home" />;

  const bucket = dose ? bucketForDose(dose) : null;
  const badge =
    bucket === "overdue"
      ? { bg: ui.overdueBg, fg: ui.overdueText }
      : bucket === "due_today"
        ? { bg: ui.dueBg, fg: ui.dueText }
        : bucket === "needs_review"
          ? { bg: ui.reviewBg, fg: ui.reviewText }
          : { bg: ui.upcomingBg, fg: ui.upcomingText };

  const pastDue = dose ? daysPastDue(dose.due_date) : null;
  const overdueBanner =
    bucket === "overdue" && pastDue != null && pastDue > 0
      ? `Overdue by ${pastDue} day${pastDue === 1 ? "" : "s"} · due ${formatDueDateLabel(dose!.due_date)}`
      : bucket === "overdue"
        ? `Overdue · due ${formatDueDateLabel(dose!.due_date)}`
        : null;

  const toggleBird = (birdId: string) => {
    setSelectedBirds((prev) => {
      const next = new Set(prev);
      if (next.has(birdId)) next.delete(birdId);
      else next.add(birdId);
      return next;
    });
  };

  const onRecord = async () => {
    if (!dose || !canRecord) return;
    if (remaining <= 0) {
      Alert.alert("Nothing remaining", "This dose is already fully covered.");
      return;
    }

    let birdsCovered = remaining;
    let birdIds: string[] = [];

    const effectiveMode = mode === "birds" && !showSelectBirdsMode ? "all" : mode;
    if (effectiveMode === "partial") {
      const n = Number(partialCount);
      if (!Number.isInteger(n) || n < 1) {
        Alert.alert("Enter coverage", "Enter how many birds were actually vaccinated.");
        return;
      }
      if (n > remaining) {
        Alert.alert("Too many", `Only ${remaining} birds remain for this dose.`);
        return;
      }
      birdsCovered = n;
    } else if (effectiveMode === "birds") {
      birdIds = [...selectedBirds];
      if (!birdIds.length) {
        Alert.alert("Select birds", "Choose at least one banded bird.");
        return;
      }
      if (birdIds.length > remaining) {
        Alert.alert("Too many", `Only ${remaining} birds remain for this dose.`);
        return;
      }
    }

    const vaccineLabel = dose.vaccine_name?.trim() || "this vaccine";
    const shedLabel = dose.shed_name?.trim() || "this shed";
    const countLabel =
      effectiveMode === "birds"
        ? `${birdIds.length} selected bird${birdIds.length === 1 ? "" : "s"}`
        : `${birdsCovered} bird${birdsCovered === 1 ? "" : "s"}`;
    const confirmBody = `${vaccineLabel}\n${shedLabel}\nRecord for ${countLabel}?`;

    Alert.alert("Confirm vaccination", confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Record",
        onPress: async () => {
          setBusy(true);
          try {
            const shared = {
              administration_date: adminDate,
              product_expiry: productExpiry,
              route: route.trim() || null,
              dose_amount: doseAmount.trim() || null,
              manufacturer_or_brand: brand.trim() || null,
              lot_number: lot.trim() || null,
              notes: notes.trim() || null,
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
            // Refresh vaccination queues and shed/home summaries that cache overdue counts.
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["vaccination"] }),
              qc.invalidateQueries({ queryKey: ["vaccination-dose", id] }),
              qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] }),
              qc.invalidateQueries({ queryKey: ["shed-overview"] }),
              qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] }),
            ]);
            const stillOpen =
              effectiveMode === "partial" || effectiveMode === "birds"
                ? effectiveMode === "partial"
                  ? Number(partialCount) < remaining
                  : birdIds.length < remaining
                : false;
            const savedMsg = stillOpen
              ? "Vaccination saved. This dose stays open until all remaining eligible birds are covered."
              : "Vaccination saved.";
            setIdemKey(newIdempotencyKey("vax"));
            Alert.alert("Recorded", savedMsg, [
              { text: "OK", onPress: () => router.replace("/(app)/vaccination") },
            ]);
          } catch (e) {
            // Rotate key after hard failures so a prior successful sibling dose key
            // cannot poison retries; true in-flight retries keep the same key until success.
            const msg = describeApiError(e, "record vaccination");
            if (/idempotency|already used|conflict/i.test(msg)) {
              setIdemKey(newIdempotencyKey("vax"));
            }
            Alert.alert("Could not record", msg);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const guidance = guidanceQuery.data?.item;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={ui.brand} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {dose?.vaccine_name?.trim() || "Vaccination"}
        </Text>
        {bucket ? (
          <View style={[styles.headerBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.headerBadgeText, { color: badge.fg }]}>{statusBadgeLabel(bucket)}</Text>
          </View>
        ) : null}
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.tabs}>
            {(
              [
                ["overview", "Overview"],
                ["details", "Vaccine Details"],
              ] as const
            ).map(([key, label]) => {
              const on = tab === key;
              return (
                <Pressable key={key} style={styles.tabBtn} onPress={() => setTab(key)}>
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
                  {on ? <View style={styles.tabUnderline} /> : <View style={styles.tabUnderlineOff} />}
                </Pressable>
              );
            })}
          </View>

          {tab === "overview" ? (
            <>
              {overdueBanner ? (
                <View style={styles.alertBanner}>
                  <Ionicons name="alert-circle" size={18} color={ui.overdueText} />
                  <Text style={styles.alertText}>{overdueBanner}</Text>
                </View>
              ) : null}

              <View style={styles.card}>
                <MetricRow icon="home-outline" label="Shed" value={dose.shed_name ?? "—"} />
                <MetricRow icon="layers-outline" label="Flock / Batch" value={dose.flock_label ?? "—"} />
                <MetricRow
                  icon="people-outline"
                  label="Eligible birds"
                  value={String(dose.eligible_count ?? 0)}
                />
                <MetricRow
                  icon="checkmark-circle-outline"
                  label="Vaccinated"
                  value={coverageLine(asCard(dose))}
                />
                <MetricRow icon="hourglass-outline" label="Remaining" value={String(remaining)} />
                {populationHint(asCard(dose)) ? (
                  <Text style={styles.pop}>{populationHint(asCard(dose))}</Text>
                ) : null}
              </View>

              {canCatalogue && guidanceQuery.data?.catalogueId ? (
                <Pressable
                  style={styles.catalogueLink}
                  onPress={() => router.push(`/(app)/catalogues/${guidanceQuery.data!.catalogueId}`)}
                >
                  <Ionicons name="book-outline" size={16} color={ui.brand} />
                  <Text style={styles.catalogueLinkText}>
                    {guidance
                      ? `View “${guidance.name}” in catalogue`
                      : `View ${guidanceQuery.data.catalogueName}`}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={ui.brand} />
                </Pressable>
              ) : null}

              {canRecord && remaining > 0 && !showRecordForm ? (
                <Pressable
                  style={styles.recordCta}
                  onPress={() => setShowRecordForm(true)}
                  accessibilityLabel="Record Vaccination"
                >
                  <Text style={styles.recordCtaText}>Record Vaccination</Text>
                </Pressable>
              ) : null}

              {canRecord && remaining > 0 && showRecordForm ? (
                <View style={styles.card}>
                  <Text style={styles.section}>Record vaccination</Text>
                  <Text style={styles.guidanceNote}>
                    Product guidance (dose, route, diluent) is on Vaccine Details. Optional lot/route
                    fields sit below the record button so All remaining stays on-screen.
                  </Text>
                  <View style={styles.modeRow}>
                    {(
                      [
                        ["all", "All remaining"] as const,
                        ["partial", "Partial group"] as const,
                        ...(showSelectBirdsMode
                          ? ([["birds", "Select birds"]] as Array<["birds", string]>)
                          : []),
                      ] as Array<[CoverageMode, string]>
                    ).map(([value, label]) => (
                      <Pressable
                        key={value}
                        style={[styles.modeChip, coverageMode === value && styles.modeChipOn]}
                        onPress={() => setMode(value)}
                      >
                        <Text style={[styles.modeText, coverageMode === value && styles.modeTextOn]}>
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {coverageMode === "all" ? (
                    <Text style={styles.hint}>Will record coverage for all {remaining} remaining birds.</Text>
                  ) : null}
                  {coverageMode === "partial" ? (
                    <TextInput
                      style={styles.input}
                      keyboardType="number-pad"
                      placeholder={`Number vaccinated (max ${remaining})`}
                      value={partialCount}
                      onChangeText={setPartialCount}
                    />
                  ) : null}
                  {coverageMode === "birds" ? (
                    <View style={styles.birdList}>
                      {birdsQuery.isLoading ? (
                        <Text style={styles.hint}>Loading banded birds…</Text>
                      ) : activeBirds.length === 0 ? (
                        <Text style={styles.hint}>
                          No active banded birds in this population. Use all remaining or partial group.
                        </Text>
                      ) : (
                        activeBirds.map((b) => {
                          const on = selectedBirds.has(b.id);
                          return (
                            <Pressable
                              key={b.id}
                              style={[styles.birdRow, on && styles.birdRowOn]}
                              onPress={() => toggleBird(b.id)}
                            >
                              <Ionicons
                                name={on ? "checkbox" : "square-outline"}
                                size={20}
                                color={on ? ui.brand : ui.muted}
                              />
                              <Text style={styles.birdLabel}>{b.band_id}</Text>
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  ) : null}

                  <AppDatePicker
                    label="Administration date"
                    value={adminDate}
                    onChange={(v) => setAdminDate(v ?? todayIsoDate())}
                    maximumDate={todayIsoDate()}
                  />

                  {/* Primary CTA above optional fields — unbanded All remaining must not require scroll. */}
                  <Button
                    label={busy ? "Saving…" : "Record Vaccination"}
                    onPress={onRecord}
                    disabled={busy}
                  />

                  <Pressable
                    onPress={() => setShowOptionalDetails((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showOptionalDetails ? "Hide optional details" : "Show optional details"
                    }
                    style={styles.optionalToggle}
                  >
                    <Text style={styles.optionalToggleText}>
                      {showOptionalDetails ? "Hide optional details" : "Add optional details"}
                    </Text>
                    <Ionicons
                      name={showOptionalDetails ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={ui.brand}
                    />
                  </Pressable>

                  {showOptionalDetails ? (
                    <>
                      <AppDatePicker
                        label="Product expiry (optional)"
                        value={productExpiry}
                        onChange={setProductExpiry}
                        minimumDate={todayIsoDate()}
                        clearable
                      />
                      <Text style={styles.fieldLabel}>Route (actual)</Text>
                      <TextInput
                        style={styles.input}
                        value={route}
                        onChangeText={setRoute}
                        placeholder="Optional"
                      />
                      <Text style={styles.fieldLabel}>Dose amount (actual)</Text>
                      <TextInput
                        style={styles.input}
                        value={doseAmount}
                        onChangeText={setDoseAmount}
                        placeholder="Optional"
                      />
                      <Text style={styles.fieldLabel}>Manufacturer / brand</Text>
                      <TextInput
                        style={styles.input}
                        value={brand}
                        onChangeText={setBrand}
                        placeholder="Optional"
                      />
                      <Text style={styles.fieldLabel}>Batch / lot</Text>
                      <TextInput
                        style={styles.input}
                        value={lot}
                        onChangeText={setLot}
                        placeholder="Optional"
                      />
                      <Text style={styles.fieldLabel}>Notes</Text>
                      <TextInput
                        style={[styles.input, styles.inputMulti]}
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="Optional"
                        multiline
                      />
                    </>
                  ) : null}
                </View>
              ) : null}

              {canRecord && remaining <= 0 ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>No remaining coverage on this dose.</Text>
                </View>
              ) : null}

              {!canRecord ? (
                <View style={styles.card}>
                  <Text style={styles.hint}>You can view this dose but do not have permission to record.</Text>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.card}>
              <Text style={styles.section}>Product guidance</Text>
              <Text style={styles.guidanceNote}>
                Catalogue guidance only — not what was administered on this dose.
              </Text>
              {guidance ? (
                <>
                  <GuidanceRow label="Vaccine name" value={guidance.name} />
                  <GuidanceRow label="Disease targeted" value={guidance.disease_label} />
                  <GuidanceRow
                    label="Recommended age"
                    value={
                      (guidance.rules ?? [])
                        .filter((r) => r.target_age_days != null)
                        .map((r) => `Day ${r.target_age_days}`)
                        .join(", ") || guidance.rules?.[0]?.display_day_label
                    }
                  />
                  <GuidanceRow label="Dose / concentration" value={guidance.recommended_dose_text} />
                  <GuidanceRow label="Route" value={guidance.route} />
                  <GuidanceRow label="Diluent / reconstitution" value={guidance.diluent_instructions} />
                  <GuidanceRow label="Notes" value={guidance.instructions} />
                </>
              ) : (
                <Text style={styles.hint}>
                  {canCatalogue
                    ? "No matching catalogue item for this vaccine name. Open Catalogues to review product guidance."
                    : "Product guidance is not available for your role."}
                </Text>
              )}
              {canCatalogue && guidanceQuery.data?.catalogueId ? (
                <Pressable
                  style={styles.catalogueLink}
                  onPress={() => router.push(`/(app)/catalogues/${guidanceQuery.data!.catalogueId}`)}
                >
                  <Ionicons name="book-outline" size={16} color={ui.brand} />
                  <Text style={styles.catalogueLinkText}>Open catalogue</Text>
                  <Ionicons name="chevron-forward" size={16} color={ui.brand} />
                </Pressable>
              ) : null}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetricRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metricRow}>
      <Ionicons name={icon} size={18} color={ui.brand} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function GuidanceRow({ label, value }: { label: string; value: string | null | undefined }) {
  const text = value?.trim() || "Unspecified";
  const missing = !value?.trim();
  return (
    <View style={styles.guidanceRow}>
      <Text style={styles.guidanceLabel}>{label}</Text>
      <Text style={[styles.guidanceValue, missing && styles.fieldMissing]}>{text}</Text>
    </View>
  );
}

function asCard(dose: ScheduledDose) {
  const remaining =
    dose.remaining_count != null
      ? Math.max(0, dose.remaining_count)
      : remainingCount(dose.eligible_count, dose.completed_count);
  const bucket = bucketForDose(dose) ?? "upcoming";
  return {
    ...dose,
    vaccine_name: dose.vaccine_name?.trim() || "Vaccine name unavailable",
    shed_name: dose.shed_name?.trim() || "Shed",
    flock_label: dose.flock_label?.trim() || "Population",
    remaining_count: remaining,
    coverage_pct: 0,
    bucket,
    banded_count: dose.banded_count ?? null,
    unbanded_count: dose.unbanded_count ?? null,
  };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: ui.horizontal,
    paddingTop: 8,
  },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: ui.ink },
  headerBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  headerBadgeText: { fontSize: 10, fontWeight: "800" },
  content: { padding: ui.horizontal, gap: 12, paddingBottom: 40 },
  optionalToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  optionalToggleText: { fontSize: 13, fontWeight: "700", color: ui.brand },
  tabs: { flexDirection: "row", gap: 18, marginBottom: 4 },
  tabBtn: { paddingBottom: 6 },
  tabText: { fontSize: 15, fontWeight: "700", color: ui.muted },
  tabTextOn: { color: ui.brand },
  tabUnderline: { marginTop: 6, height: 3, borderRadius: 2, backgroundColor: ui.brand },
  tabUnderlineOff: { marginTop: 6, height: 3 },
  alertBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: ui.overdueBg,
    borderRadius: 12,
    padding: 12,
  },
  alertText: { flex: 1, fontSize: 13, fontWeight: "700", color: ui.overdueText, lineHeight: 18 },
  card: {
    backgroundColor: ui.white,
    borderRadius: ui.cardRadius,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    padding: 14,
    gap: 10,
  },
  metricRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  metricLabel: { width: 110, fontSize: 13, fontWeight: "700", color: ui.muted },
  metricValue: { flex: 1, fontSize: 14, fontWeight: "700", color: ui.ink, textAlign: "right" },
  pop: { fontSize: 12, color: ui.muted, fontWeight: "600" },
  guidanceNote: {
    fontSize: 12,
    color: ui.brand,
    fontWeight: "600",
    backgroundColor: ui.brandSoft,
    padding: 10,
    borderRadius: 10,
    lineHeight: 16,
  },
  catalogueLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  catalogueLinkText: { flex: 1, fontSize: 14, fontWeight: "700", color: ui.brand },
  recordCta: {
    backgroundColor: ui.brand,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 3,
  },
  recordCtaText: { color: ui.white, fontWeight: "800", fontSize: 16 },
  section: { fontSize: 15, fontWeight: "800", color: ui.ink },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modeChipOn: { backgroundColor: ui.brand, borderColor: ui.brand },
  modeText: { fontSize: 13, fontWeight: "700", color: ui.ink },
  modeTextOn: { color: ui.white },
  hint: { fontSize: 13, color: ui.muted, fontWeight: "600", lineHeight: 18 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: ui.muted, marginTop: 4 },
  input: {
    backgroundColor: ui.bg,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: "600",
    color: ui.ink,
  },
  inputMulti: { minHeight: 72, textAlignVertical: "top" },
  birdList: { gap: 6 },
  birdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  birdRowOn: { backgroundColor: ui.brandSoft },
  birdLabel: { fontSize: 15, fontWeight: "700", color: ui.ink },
  guidanceRow: { gap: 2 },
  guidanceLabel: { fontSize: 12, fontWeight: "700", color: ui.muted },
  guidanceValue: { fontSize: 14, fontWeight: "600", color: ui.ink },
  fieldMissing: { color: ui.muted, fontStyle: "italic" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { padding: 20 },
  muted: { color: ui.muted, fontWeight: "600" },
});
