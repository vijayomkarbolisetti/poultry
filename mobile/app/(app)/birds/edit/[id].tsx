import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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

import {
  getBirdProfile,
  searchBirds,
  updateBird,
  type BirdProfile,
  type BirdUpdateInput,
} from "../../../../src/api/birds";
import { describeApiError } from "../../../../src/api/client";
import {
  EMPTY_PARENT,
  ParentageFields,
  parentDraftToInput,
  type ParentDraft,
} from "../../../../src/components/birds/ParentageFields";
import { Button } from "../../../../src/components/ui/Button";
import { AppDatePicker } from "../../../../src/components/ui/AppDatePicker";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { formatDisplayDate, todayIsoDate } from "../../../../src/components/ui/selectUtils";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import {
  bandChangeSaveLabel,
  bandChangeScreenTitle,
  bandsEqual,
  canSaveBandChange,
  evaluateLocalBandState,
  findBandConflict,
  isUnbanded,
  normalizeBand,
  type BandAvailability,
} from "../../../../src/features/birds/bandChangeHelpers";
import {
  BIRD_SEX_OPTIONS,
  formatLifecycleLabel,
  formatSexLabel,
  normalizeSexSelectValue,
} from "../../../../src/features/birds/birdListHelpers";
import { validateBandNumber } from "../../../../src/features/birds/groupOnboardingHelpers";
import { safeBack } from "../../../../src/navigation/safeBack";
import { birdUi } from "../../../../src/theme/birdManagementUi";
import { birdIcons, shedHeaderArt } from "../../../../src/theme/media";
import { toast } from "../../../../src/ui/toast/toastStore";
import { typography } from "../../../../src/theme/tokens";


function draftFromParentage(
  parentage:
    | {
        source: string;
        bird_id: string | null;
        band_id: string | null;
        display_name: string | null;
        breed: string | null;
        notes: string | null;
        label: string;
      }
    | undefined,
  legacy: { id: string; band_id: string | null; display_code: string | null } | null,
): ParentDraft {
  if (parentage?.source === "linked" && parentage.bird_id) {
    return {
      birdId: parentage.bird_id,
      displayName: parentage.display_name ?? "",
      bandNumber: parentage.band_id ?? "",
    };
  }
  if (legacy) {
    return {
      birdId: legacy.id,
      displayName: "",
      bandNumber: legacy.band_id ?? legacy.display_code ?? "",
    };
  }
  if (parentage?.source === "manual") {
    return {
      birdId: null,
      displayName: parentage.display_name ?? "",
      bandNumber: parentage.band_id ?? "",
    };
  }
  return { ...EMPTY_PARENT };
}

const DOB_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "exact", label: "Exact hatch date" },
  { value: "estimated", label: "Estimated age" },
];

const SEX_OPTIONS = BIRD_SEX_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

type SeedSnapshot = {
  bandId: string;
  breed: string;
  sex: string | null;
  dobConfidence: string | null;
  hatchDate: string | null;
  ageDays: string;
  notes: string;
  sire: ParentDraft;
  dam: ParentDraft;
};

function snapshotFromProfile(p: BirdProfile): SeedSnapshot {
  return {
    bandId: p.band_id ?? "",
    breed: p.breed ?? "",
    sex: normalizeSexSelectValue(p.sex),
    dobConfidence: p.dob_confidence,
    hatchDate: p.hatch_date ?? null,
    ageDays: p.estimated_age_days != null ? String(p.estimated_age_days) : "",
    notes: p.notes ?? "",
    sire: draftFromParentage(p.sire_parentage, p.sire),
    dam: draftFromParentage(p.dam_parentage, p.dam),
  };
}

function parentsEqual(a: ParentDraft, b: ParentDraft): boolean {
  return (
    a.birdId === b.birdId &&
    a.displayName.trim() === b.displayName.trim() &&
    a.bandNumber.trim() === b.bandNumber.trim()
  );
}

export default function EditBirdScreen() {
  const { id, fromShedId } = useLocalSearchParams<{ id: string; fromShedId?: string }>();
  const { user, ownerAccountId } = useAuth();
  const canUpdate = hasPermission(user, ownerAccountId, "bird.update");

  const profile = useQuery({
    queryKey: ["bird-profile", id],
    queryFn: () => getBirdProfile(id!),
    enabled: !!id && canUpdate,
  });

  const fallback = fromShedId
    ? `/(app)/sheds/${fromShedId}/birds`
    : id
      ? `/(app)/birds/${id}`
      : "/(app)/search";

  if (!canUpdate) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <Text style={styles.errorPad}>You do not have permission to edit birds.</Text>
        <View style={styles.pad}>
          <Button label="Back" variant="secondary" onPress={() => safeBack(fallback)} />
        </View>
      </SafeAreaView>
    );
  }

  if (profile.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <HenLoader label="Loading bird…" />
      </SafeAreaView>
    );
  }

  if (profile.isError || !profile.data || !id) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <Text style={styles.errorPad}>{describeApiError(profile.error, "load bird")}</Text>
        <View style={styles.pad}>
          <Button label="Retry" onPress={() => profile.refetch()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <EditBirdForm
      key={profile.data.id}
      birdId={id}
      profile={profile.data}
      seed={snapshotFromProfile(profile.data)}
      fallback={fallback}
    />
  );
}

function EditBirdForm({
  birdId,
  profile: p,
  seed,
  fallback,
}: {
  birdId: string;
  profile: BirdProfile;
  seed: SeedSnapshot;
  fallback: string;
}) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const submitting = useRef(false);
  const bandRef = useRef<TextInput>(null);
  const availabilityReq = useRef(0);

  const [bandId, setBandId] = useState(seed.bandId);
  const [breed, setBreed] = useState(seed.breed);
  const [sex, setSex] = useState<string | null>(seed.sex);
  const [dobConfidence, setDobConfidence] = useState<string | null>(seed.dobConfidence);
  const [hatchDate, setHatchDate] = useState<string | null>(seed.hatchDate);
  const [ageDays, setAgeDays] = useState(seed.ageDays);
  const [notes, setNotes] = useState(seed.notes);
  const [sire, setSire] = useState<ParentDraft>(seed.sire);
  const [dam, setDam] = useState<ParentDraft>(seed.dam);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [remoteAvailability, setRemoteAvailability] = useState<
    Extract<BandAvailability, "checking" | "available" | "taken"> | null
  >(null);

  useEffect(() => {
    const t = setTimeout(() => bandRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const localAvailability = useMemo(
    () => evaluateLocalBandState({ draft: bandId, original: seed.bandId }),
    [bandId, seed.bandId],
  );

  useEffect(() => {
    if (localAvailability !== "idle" || !normalizeBand(bandId)) {
      return;
    }
    const req = ++availabilityReq.current;
    const timer = setTimeout(() => {
      setRemoteAvailability("checking");
      void (async () => {
        try {
          const result = await searchBirds({
            q: normalizeBand(bandId),
            limit: 8,
            includeInactive: false,
          });
          if (req !== availabilityReq.current) return;
          const conflict = findBandConflict(result.items, birdId, bandId);
          setRemoteAvailability(conflict ? "taken" : "available");
        } catch {
          if (req !== availabilityReq.current) return;
          setRemoteAvailability("available");
        }
      })();
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [bandId, birdId, localAvailability]);

  const availability: BandAvailability =
    localAvailability !== "idle" || !normalizeBand(bandId)
      ? localAvailability === "idle" && !normalizeBand(bandId)
        ? "idle"
        : localAvailability
      : (remoteAvailability ?? "idle");

  const hadBand = !isUnbanded(seed.bandId);
  const bandDirty = !bandsEqual(bandId, seed.bandId);
  const detailsDirty = useMemo(
    () =>
      breed.trim() !== seed.breed.trim() ||
      sex !== seed.sex ||
      (dobConfidence ?? "unknown") !== (seed.dobConfidence ?? "unknown") ||
      (hatchDate || null) !== (seed.hatchDate || null) ||
      ageDays.trim() !== seed.ageDays.trim() ||
      notes.trim() !== seed.notes.trim() ||
      !parentsEqual(sire, seed.sire) ||
      !parentsEqual(dam, seed.dam),
    [seed, breed, sex, dobConfidence, hatchDate, ageDays, notes, sire, dam],
  );

  const saveEnabled = canSaveBandChange({
    draft: bandId,
    original: seed.bandId,
    detailsDirty,
    availability,
    busy,
  });

  const onSave = async () => {
    if (submitting.current || !saveEnabled) return;

    const bandErr = bandDirty ? validateBandNumber(bandId) : null;
    if (bandErr) {
      setMsg(bandErr);
      return;
    }
    if (detailsDirty) {
      if (dobConfidence === "exact" && !hatchDate) {
        setMsg("Hatch date is required for exact DOB");
        setDetailsOpen(true);
        return;
      }
      if (dobConfidence === "estimated" && !ageDays.trim()) {
        setMsg("Estimated age (days) is required");
        setDetailsOpen(true);
        return;
      }
    }

    submitting.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const payload: BirdUpdateInput = {};
      if (bandDirty) {
        payload.band_id = normalizeBand(bandId);
      }
      if (detailsDirty) {
        payload.breed = breed.trim() || null;
        payload.sex = sex || null;
        payload.notes = notes.trim() || null;
        payload.dob_confidence = dobConfidence ?? "unknown";
        payload.hatch_date = hatchDate || null;
        payload.estimated_age_days = ageDays.trim() ? Number(ageDays) : null;
        payload.age_reported_on = dobConfidence === "estimated" ? todayIsoDate() : null;
        payload.sire = parentDraftToInput(sire);
        payload.dam = parentDraftToInput(dam);
      }

      await updateBird(birdId, payload);
      void qc.invalidateQueries({ queryKey: ["bird-profile", birdId] });
      void qc.invalidateQueries({ queryKey: ["shed-birds"] });
      void qc.invalidateQueries({ queryKey: ["shed-overview"] });
      void qc.invalidateQueries({ queryKey: ["birds"] });
      void qc.invalidateQueries({ queryKey: ["flock"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      toast.success(
        bandDirty
          ? hadBand
            ? "Band number updated"
            : "Band number assigned"
          : "Bird details updated",
      );
      safeBack(fallback);
    } catch (e: unknown) {
      setMsg(describeApiError(e, "save band number"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  const statusKey = (p.lifecycle_status || "").toLowerCase();
  const statusTone =
    statusKey === "active" ? "active" : statusKey === "dead" ? "dead" : "inactive";
  const currentBandLabel = hadBand ? seed.bandId.trim() : "Unbanded";
  const availabilityHint =
    availability === "checking"
      ? "Checking availability…"
      : availability === "available"
        ? "Band number is available"
        : availability === "taken"
          ? "Already assigned to another bird"
          : availability === "invalid"
            ? validateBandNumber(bandId) ?? "Invalid band number"
            : availability === "unchanged"
              ? hadBand
                ? "Same as current band"
                : null
              : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => safeBack(fallback)}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <Text style={styles.screenTitle} numberOfLines={1}>
          {bandChangeScreenTitle(hadBand)}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.summary}>
            <Image source={shedHeaderArt} style={styles.summaryArt} resizeMode="cover" />
            <View style={styles.summaryBody}>
              <View style={styles.summaryPhoto}>
                <Image source={birdIcons.bird} style={styles.summaryPhotoImg} resizeMode="cover" />
              </View>
              <View style={styles.summaryCopy}>
                <Text style={styles.currentBandLabel}>
                  {hadBand ? "Current band" : "Status"}
                </Text>
                <Text style={styles.currentBandValue} numberOfLines={1} selectable>
                  {currentBandLabel}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaText} numberOfLines={1}>
                    {[p.shed_name ?? "Shed —", p.breed?.trim() || "Breed —", formatSexLabel(p.sex)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      statusTone === "active" && styles.statusActive,
                      statusTone === "dead" && styles.statusDead,
                      statusTone === "inactive" && styles.statusInactive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        statusTone === "active" && { color: birdUi.successText },
                        statusTone === "dead" && { color: birdUi.error },
                        statusTone === "inactive" && { color: birdUi.orange },
                      ]}
                    >
                      {formatLifecycleLabel(p.lifecycle_status)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          <Pressable
            onPress={() => setMoreInfoOpen((v) => !v)}
            style={styles.moreInfoToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreInfoOpen }}
          >
            <Text style={styles.moreInfoLabel}>
              {moreInfoOpen ? "Hide bird info" : "More bird info"}
            </Text>
            <Ionicons
              name={moreInfoOpen ? "chevron-up" : "chevron-down"}
              size={16}
              color={birdUi.muted}
            />
          </Pressable>
          {moreInfoOpen ? (
            <View style={styles.moreInfoBlock}>
              <Text style={styles.moreInfoLine}>
                Hatch{" "}
                {p.hatch_date
                  ? formatDisplayDate(p.hatch_date)
                  : p.estimated_age_days != null
                    ? `~${p.estimated_age_days}d`
                    : "—"}
              </Text>
              <Text style={styles.moreInfoLine} selectable>
                Bird ID {p.id}
              </Text>
            </View>
          ) : null}

          <View style={styles.bandCard}>
            <Text style={styles.bandLabel}>
              {hadBand ? "New band number" : "Band number"}
              <Text style={styles.required}> *</Text>
            </Text>
            <TextInput
              ref={bandRef}
              style={[
                styles.bandInput,
                availability === "taken" || availability === "invalid"
                  ? styles.bandInputError
                  : availability === "available"
                    ? styles.bandInputOk
                    : null,
              ]}
              value={bandId}
              onChangeText={(t) => {
                setBandId(t);
                setMsg(null);
                setRemoteAvailability(null);
              }}
              placeholder={hadBand ? "Enter replacement band" : "Enter band number"}
              placeholderTextColor={birdUi.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (saveEnabled) void onSave();
              }}
              accessibilityLabel={hadBand ? "New band number" : "Band number"}
              selectTextOnFocus={hadBand}
            />
            {availabilityHint ? (
              <View style={styles.hintRow}>
                <Ionicons
                  name={
                    availability === "taken" || availability === "invalid"
                      ? "alert-circle"
                      : availability === "available"
                        ? "checkmark-circle"
                        : "information-circle-outline"
                  }
                  size={16}
                  color={
                    availability === "taken" || availability === "invalid"
                      ? birdUi.error
                      : availability === "available"
                        ? birdUi.successText
                        : birdUi.muted
                  }
                />
                <Text
                  style={[
                    styles.hintText,
                    (availability === "taken" || availability === "invalid") && styles.hintError,
                    availability === "available" && styles.hintOk,
                  ]}
                >
                  {availabilityHint}
                </Text>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => setDetailsOpen((v) => !v)}
            style={styles.detailsToggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
          >
            <View style={styles.detailsToggleIcon}>
              <Ionicons name="create-outline" size={18} color={birdUi.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailsToggleTitle}>Edit bird details</Text>
              <Text style={styles.detailsToggleSub}>Breed, sex, hatch date, notes, parentage</Text>
            </View>
            <Ionicons
              name={detailsOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={birdUi.muted}
            />
          </Pressable>

          {detailsOpen ? (
            <View style={styles.detailsBlock}>
              <Text style={styles.fieldLabel}>Breed</Text>
              <TextInput
                style={styles.fieldInput}
                value={breed}
                onChangeText={setBreed}
                placeholder="Breed (optional)"
                placeholderTextColor={birdUi.muted}
              />

              <Text style={styles.fieldLabel}>Sex</Text>
              <View style={styles.sexRow}>
                {SEX_OPTIONS.map((opt) => {
                  const on = sex === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      onPress={() => setSex(opt.value)}
                      style={[styles.sexChip, on && styles.sexChipOn]}
                    >
                      <Text style={[styles.sexChipText, on && styles.sexChipTextOn]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <SelectField
                label="DOB confidence"
                value={dobConfidence}
                options={DOB_OPTIONS}
                onChange={setDobConfidence}
              />
              {dobConfidence === "exact" ? (
                <AppDatePicker
                  label="Hatch date"
                  value={hatchDate}
                  onChange={setHatchDate}
                  maximumDate={todayIsoDate()}
                  placeholder="Select hatch date"
                />
              ) : null}
              {dobConfidence === "estimated" ? (
                <>
                  <Text style={styles.fieldLabel}>Estimated age (days)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={ageDays}
                    onChangeText={setAgeDays}
                    keyboardType="number-pad"
                    placeholder="Days"
                    placeholderTextColor={birdUi.muted}
                  />
                </>
              ) : null}

              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                style={[styles.fieldInput, styles.notesInput]}
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Add notes (optional)"
                placeholderTextColor={birdUi.muted}
              />

              <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Parentage (optional)</Text>
              <Text style={styles.detailsHint}>Name and wing band number are optional.</Text>
              <View style={{ gap: 10 }}>
                <ParentageFields role="sire" value={sire} onChange={setSire} excludeBirdId={birdId} />
                <ParentageFields role="dam" value={dam} onChange={setDam} excludeBirdId={birdId} />
              </View>
            </View>
          ) : null}

          {msg ? <Text style={styles.error}>{msg}</Text> : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Button
            label={
              busy
                ? "Saving…"
                : bandChangeSaveLabel({ hadBand, bandDirty, detailsDirty })
            }
            onPress={() => void onSave()}
            loading={busy}
            disabled={!saveEnabled}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: birdUi.bg },
  flex: { flex: 1 },
  pad: { paddingHorizontal: birdUi.horizontal },
  errorPad: {
    color: birdUi.error,
    fontSize: typography.label.fontSize,
    fontWeight: "600",
    paddingHorizontal: birdUi.horizontal,
    marginVertical: 12,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: birdUi.horizontal,
    paddingVertical: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: typography.screenTitle.fontSize,
    fontWeight: "800",
    color: birdUi.deepGreen,
    paddingHorizontal: 8,
  },
  scrollContent: {
    paddingHorizontal: birdUi.horizontal,
    paddingBottom: 16,
    gap: 12,
  },
  summary: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
  },
  summaryArt: {
    ...StyleSheet.absoluteFill,
    opacity: 0.28,
  },
  summaryBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  summaryPhoto: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: birdUi.white,
    borderWidth: 1,
    borderColor: birdUi.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  summaryPhotoImg: { width: "100%", height: "100%" },
  summaryCopy: { flex: 1, gap: 2 },
  currentBandLabel: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.muted, letterSpacing: 0.2 },
  currentBandValue: { fontSize: typography.bandInput.fontSize, fontWeight: "800", color: birdUi.text },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  metaText: { flex: 1, fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusActive: { backgroundColor: birdUi.successBg },
  statusDead: { backgroundColor: birdUi.errorPale },
  statusInactive: { backgroundColor: birdUi.orangePale },
  statusText: { fontSize: typography.overline.fontSize, fontWeight: "700" },
  moreInfoToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 36,
    marginTop: -4,
  },
  moreInfoLabel: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.muted },
  moreInfoBlock: {
    backgroundColor: birdUi.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    marginTop: -6,
  },
  moreInfoLine: { fontSize: typography.secondary.fontSize, color: birdUi.text, fontWeight: "600" },
  bandCard: {
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 8,
  },
  bandLabel: { fontSize: typography.label.fontSize, fontWeight: "800", color: birdUi.text },
  required: { color: birdUi.error },
  bandInput: {
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: birdUi.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: typography.bandInput.fontSize,
    fontWeight: "800",
    color: birdUi.text,
    backgroundColor: birdUi.bg,
    letterSpacing: 0.5,
  },
  bandInputError: { borderColor: birdUi.error, backgroundColor: birdUi.errorPale },
  bandInputOk: { borderColor: birdUi.successText },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintText: { flex: 1, fontSize: typography.secondary.fontSize, fontWeight: "600", color: birdUi.muted },
  hintError: { color: birdUi.error },
  hintOk: { color: birdUi.successText },
  detailsToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
  },
  detailsToggleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsToggleTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text },
  detailsToggleSub: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted, marginTop: 1 },
  detailsBlock: {
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 8,
    marginTop: -4,
  },
  fieldLabel: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.muted, marginTop: 4 },
  fieldInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: typography.body.fontSize,
    color: birdUi.text,
    backgroundColor: birdUi.bg,
  },
  notesInput: { minHeight: 80, textAlignVertical: "top" },
  detailsHint: { fontSize: typography.caption.fontSize, color: birdUi.muted, marginBottom: 4 },
  sexRow: { flexDirection: "row", gap: 8 },
  sexChip: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    backgroundColor: birdUi.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  sexChipOn: { borderColor: birdUi.primary, backgroundColor: birdUi.primary },
  sexChipText: { fontSize: typography.bodyStrong.fontSize, fontWeight: "700", color: birdUi.text },
  sexChipTextOn: { color: birdUi.white },
  footer: {
    paddingHorizontal: birdUi.horizontal,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: birdUi.border,
    backgroundColor: birdUi.bg,
  },
  error: {
    color: birdUi.error,
    fontSize: typography.label.fontSize,
    fontWeight: "600",
  },
});
