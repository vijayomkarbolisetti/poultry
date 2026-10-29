import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
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
  listVaccinationEvents,
  newIdempotencyKey,
  recordVaccination,
  recordVaccinationBatch,
  type ScheduledDose,
} from "../../../src/api/vaccines";
import { VaccinationBirdSelector } from "../../../src/components/vaccination/VaccinationBirdSelector";
import { AppDialog } from "../../../src/components/ui/AppDialog";
import { Button } from "../../../src/components/ui/Button";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { pruneIneligibleSelection } from "../../../src/features/vaccination/birdSelectionHelpers";
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
import { toast } from "../../../src/ui/toast/toastStore";

type CoverageMode = "all" | "partial" | "birds";
type TabKey = "overview" | "details";

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
  const canCatalogue = hasPermission(user, ownerAccountId, "schedule.view");
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("overview");

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
  const [route, setRoute] = useState("");
  const [doseAmount, setDoseAmount] = useState("");
  const [brand, setBrand] = useState("");
  const [lot, setLot] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  // Must rotate when dose id changes — Expo Router often reuses this screen instance,
  // and reusing a batch idempotency key silently replays a *different* prior dose.
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey("vax"));
  const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(null);
  const [infoDialog, setInfoDialog] = useState<InfoDialog | null>(null);

  useEffect(() => {
    setIdemKey(newIdempotencyKey("vax"));
    setMode("all");
    setPartialCount("");
    setSelectedBirds(new Set());
    setBirdPickerOpen(false);
    setBusy(false);
    setPendingRecord(null);
    setInfoDialog(null);
  }, [id]);

  const activeBirds = useMemo(
    () => (birdsQuery.data ?? []).filter((b) => b.is_active && b.band_id),
    [birdsQuery.data],
  );

  /** Birds already recorded against this scheduled dose (per-bird events only). */
  const alreadyVaccinatedIds = useMemo(() => {
    const set = new Set<string>();
    if (!dose?.id) return set;
    for (const ev of eventsQuery.data ?? []) {
      if (ev.is_void || !ev.bird_id) continue;
      if (ev.scheduled_dose_id !== dose.id) continue;
      set.add(ev.bird_id);
    }
    return set;
  }, [eventsQuery.data, dose?.id]);

  useEffect(() => {
    if (!alreadyVaccinatedIds.size) return;
    setSelectedBirds((prev) => {
      const next = pruneIneligibleSelection(prev, alreadyVaccinatedIds);
      return next.size === prev.size ? prev : next;
    });
  }, [alreadyVaccinatedIds]);

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
      birdIds = [...selectedBirds].filter((birdId) => !alreadyVaccinatedIds.has(birdId));
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
    const confirmBody = `${vaccineLabel}\n${shedLabel}\nRecord for ${countLabel}?`;

    setPendingRecord({ effectiveMode, birdsCovered, birdIds, confirmBody });
  };

  const submitPendingRecord = async () => {
    if (!dose || !pendingRecord) return;
    const { effectiveMode, birdsCovered, birdIds } = pendingRecord;
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
        ? "Vaccination recorded. Dose stays open until remaining birds are covered."
        : "Vaccination recorded";
      setIdemKey(newIdempotencyKey("vax"));
      setPendingRecord(null);
      toast.success(savedMsg);
      router.replace("/(app)/vaccination");
    } catch (e) {
      // Rotate key after hard failures so a prior successful sibling dose key
      // cannot poison retries; true in-flight retries keep the same key until success.
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

              {canRecord && remaining > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.section}>Record vaccination</Text>
                  <Text style={styles.guidanceNote}>
                    Record this vaccine for the selected birds. Product guidance (dose, route, diluent)
                    remains on Vaccine Details.
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
                        onPress={() => {
                          setMode(value);
                          if (value === "birds") setBirdPickerOpen(true);
                        }}
                      >
                        <Text style={[styles.modeText, coverageMode === value && styles.modeTextOn]}>
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {coverageMode === "all" ? (
                    <Text style={styles.hint}>Recording for all {remaining} remaining birds.</Text>
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
                    <View style={styles.birdSummary}>
                      {birdsQuery.isLoading ? (
                        <Text style={styles.hint}>Loading banded birds…</Text>
                      ) : activeBirds.length === 0 ? (
                        <Text style={styles.hint}>
                          No active banded birds in this population. Use all remaining or partial group.
                        </Text>
                      ) : selectedBirds.size === 0 ? (
                        <>
                          <Text style={styles.hint}>
                            Choose banded birds with the searchable selector.
                          </Text>
                          <Pressable
                            style={styles.birdSummaryBtn}
                            onPress={() => setBirdPickerOpen(true)}
                            accessibilityRole="button"
                            accessibilityLabel="Open bird selector"
                          >
                            <Ionicons name="checkbox-outline" size={18} color={ui.white} />
                            <Text style={styles.birdSummaryBtnText}>Select birds</Text>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Text style={styles.birdSummaryCount}>
                            {selectedBirds.size} bird{selectedBirds.size === 1 ? "" : "s"} selected
                          </Text>
                          <Text style={styles.hint} numberOfLines={2}>
                            {activeBirds
                              .filter((b) => selectedBirds.has(b.id))
                              .slice(0, 6)
                              .map((b) => b.band_id)
                              .join(", ")}
                            {selectedBirds.size > 6 ? ` +${selectedBirds.size - 6} more` : ""}
                          </Text>
                          <View style={styles.birdSummaryActions}>
                            <Pressable
                              onPress={() => setBirdPickerOpen(true)}
                              accessibilityRole="button"
                              accessibilityLabel="Change bird selection"
                            >
                              <Text style={styles.birdSummaryLink}>Change selection</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => setSelectedBirds(new Set())}
                              accessibilityRole="button"
                              accessibilityLabel="Clear bird selection"
                            >
                              <Text style={styles.birdSummaryClear}>Clear</Text>
                            </Pressable>
                          </View>
                        </>
                      )}
                    </View>
                  ) : null}

                  <AppDatePicker
                    label="Administration date"
                    value={adminDate}
                    onChange={(v) => setAdminDate(v ?? todayIsoDate())}
                    maximumDate={todayIsoDate()}
                  />

                  <View style={styles.optionalGrid}>
                    <View style={styles.optionalHalf}>
                      <AppDatePicker
                        label="Product expiry (optional)"
                        value={productExpiry}
                        onChange={setProductExpiry}
                        minimumDate={todayIsoDate()}
                        clearable
                      />
                    </View>
                    <View style={styles.optionalHalf}>
                      <Text style={styles.fieldLabel}>Route (optional)</Text>
                      <TextInput
                        style={styles.input}
                        value={route}
                        onChangeText={setRoute}
                        placeholder="e.g. IM, oral, drinking water"
                      />
                    </View>
                    <View style={styles.optionalHalf}>
                      <Text style={styles.fieldLabel}>Dose amount (optional)</Text>
                      <TextInput
                        style={styles.input}
                        value={doseAmount}
                        onChangeText={setDoseAmount}
                        placeholder="e.g. 0.5 ml, 1 dose"
                      />
                    </View>
                    <View style={styles.optionalHalf}>
                      <Text style={styles.fieldLabel}>Manufacturer / brand (optional)</Text>
                      <TextInput
                        style={styles.input}
                        value={brand}
                        onChangeText={setBrand}
                        placeholder="e.g. Zoetis, Merck"
                      />
                    </View>
                    <View style={styles.optionalFull}>
                      <Text style={styles.fieldLabel}>Batch / lot (optional)</Text>
                      <TextInput
                        style={styles.input}
                        value={lot}
                        onChangeText={setLot}
                        placeholder="e.g. LOT123, B2026-01"
                      />
                    </View>
                    <View style={styles.optionalFull}>
                      <Text style={styles.fieldLabel}>Notes (optional)</Text>
                      <TextInput
                        style={[styles.input, styles.inputMulti]}
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="Optional"
                        multiline
                      />
                    </View>
                  </View>

                  <Button
                    label={busy ? "Saving…" : "Record vaccination"}
                    onPress={onRecord}
                    disabled={busy}
                  />
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

      <VaccinationBirdSelector
        visible={birdPickerOpen && coverageMode === "birds"}
        birds={birdsQuery.data ?? []}
        alreadyVaccinatedIds={alreadyVaccinatedIds}
        remaining={remaining}
        selectedIds={selectedBirds}
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
  optionalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  optionalHalf: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 140,
    gap: 4,
  },
  optionalFull: {
    flexGrow: 1,
    flexBasis: "100%",
    gap: 4,
  },
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
  birdSummary: {
    gap: 8,
    backgroundColor: ui.brandSoft,
    borderRadius: 12,
    padding: 12,
  },
  birdSummaryCount: { fontSize: 15, fontWeight: "800", color: ui.ink },
  birdSummaryActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  birdSummaryLink: { fontSize: 13, fontWeight: "800", color: ui.brand },
  birdSummaryClear: { fontSize: 13, fontWeight: "700", color: ui.muted },
  birdSummaryBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: ui.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  birdSummaryBtnText: { color: ui.white, fontWeight: "800", fontSize: 14 },
  guidanceRow: { gap: 2 },
  guidanceLabel: { fontSize: 12, fontWeight: "700", color: ui.muted },
  guidanceValue: { fontSize: 14, fontWeight: "600", color: ui.ink },
  fieldMissing: { color: ui.muted, fontStyle: "italic" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { padding: 20 },
  muted: { color: ui.muted, fontWeight: "600" },
});
