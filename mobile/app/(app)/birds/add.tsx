import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
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

import { addUnbandedInShed, registerBandedInShed, searchBirds } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { getShed } from "../../../src/api/sheds";
import {
  EMPTY_PARENT,
  parentDraftToInput,
  type ParentDraft,
} from "../../../src/components/birds/ParentageFields";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { formatDisplayDate, todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  findBandConflict,
  normalizeBand,
} from "../../../src/features/birds/bandChangeHelpers";
import { validateBandNumber, validateBirdCount } from "../../../src/features/birds/groupOnboardingHelpers";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { shedHeaderArt } from "../../../src/theme/media";
import { toast } from "../../../src/ui/toast/toastStore";
import { typography } from "../../../src/theme/tokens";


type Mode = "banded" | "unbanded";

function freeTextToParent(raw: string): ParentDraft {
  const t = raw.trim();
  if (!t) return { ...EMPTY_PARENT };
  const looksLikeBand = /^[A-Za-z0-9][A-Za-z0-9\-_/]{0,63}$/.test(t) && !/\s/.test(t);
  if (looksLikeBand) {
    return { birdId: null, displayName: "", bandNumber: t };
  }
  return { birdId: null, displayName: t, bandNumber: "" };
}

function ageDaysFromHatch(hatch: string | null): number | null {
  if (!hatch) return null;
  const ms = Date.parse(hatch);
  if (!Number.isFinite(ms)) return null;
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  return days < 0 ? 0 : days;
}

function newIdempotencyKey(): string {
  return `ub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AddBirdScreen() {
  const params = useLocalSearchParams<{ shedId?: string | string[]; mode?: string | string[] }>();
  const shedId = firstRouteParam(params.shedId);
  const initialMode = firstRouteParam(params.mode) === "unbanded" ? "unbanded" : "banded";
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const canBanded = hasPermission(user, ownerAccountId, "bird.create");
  const canUnbanded = hasPermission(user, ownerAccountId, "flock.create");
  const submitting = useRef(false);
  const bandRef = useRef<TextInput>(null);
  const availReq = useRef(0);

  const shed = useQuery({
    queryKey: ["shed", shedId],
    queryFn: () => getShed(shedId!),
    enabled: !!shedId && (canBanded || canUnbanded),
  });

  const [mode, setMode] = useState<Mode>(
    initialMode === "unbanded" && canUnbanded ? "unbanded" : canBanded ? "banded" : "unbanded",
  );
  const [bandId, setBandId] = useState("");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [sex, setSex] = useState<"male" | "female" | null>(null);
  const [count, setCount] = useState("50");
  const [breed, setBreed] = useState("");
  const [notes, setNotes] = useState("");
  const [sireText, setSireText] = useState("");
  const [damText, setDamText] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [remoteBandCheck, setRemoteBandCheck] = useState<{
    band: string;
    status: "checking" | "available" | "taken";
  } | null>(null);

  useEffect(() => {
    if (mode !== "banded") return;
    const t = setTimeout(() => bandRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [mode]);

  const localBandAvail = useMemo(() => {
    if (mode !== "banded") return "idle" as const;
    const band = normalizeBand(bandId);
    if (!band) return "idle" as const;
    if (validateBandNumber(band)) return "invalid" as const;
    return "idle" as const;
  }, [bandId, mode]);

  useEffect(() => {
    if (mode !== "banded") return;
    const band = normalizeBand(bandId);
    if (localBandAvail !== "idle" || !band) return;
    const req = ++availReq.current;
    const timer = setTimeout(() => {
      setRemoteBandCheck({ band, status: "checking" });
      void (async () => {
        try {
          const result = await searchBirds({
            q: band,
            limit: 8,
            includeInactive: false,
          });
          if (req !== availReq.current) return;
          const conflict = findBandConflict(result.items, "", band);
          setRemoteBandCheck({ band, status: conflict ? "taken" : "available" });
        } catch {
          if (req !== availReq.current) return;
          setRemoteBandCheck({ band, status: "available" });
        }
      })();
    }, 350);
    return () => {
      clearTimeout(timer);
      availReq.current += 1;
    };
  }, [bandId, mode, localBandAvail]);

  const remoteBandAvail =
    mode === "banded" && remoteBandCheck?.band === normalizeBand(bandId)
      ? remoteBandCheck.status
      : null;

  const bandAvail =
    localBandAvail !== "idle" || !normalizeBand(bandId)
      ? localBandAvail === "idle" && !normalizeBand(bandId)
        ? "idle"
        : localBandAvail
      : (remoteBandAvail ?? "idle");

  const ageDays = useMemo(() => ageDaysFromHatch(hatchDate), [hatchDate]);
  const shedName = shed.data?.name?.trim() || "Shed";
  const fallback = shedId ? `/(app)/sheds/${shedId}/birds` : "/(app)/sheds";

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["shed-birds", shedId] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };

  const persistBanded = async (andAnother: boolean) => {
    if (!canBanded || !shedId || submitting.current) return;
    const bandErr = validateBandNumber(bandId);
    if (bandErr) {
      setMsg(bandErr);
      return;
    }
    if (bandAvail === "taken") {
      setMsg("Band number is already assigned");
      return;
    }
    if (!hatchDate) {
      setMsg("Hatch date is required");
      return;
    }
    if (hatchDate > todayIsoDate()) {
      setMsg("Hatch date cannot be in the future");
      return;
    }
    if (!sex) {
      setMsg("Select sex");
      return;
    }

    submitting.current = true;
    setBusy(true);
    setMsg(null);
    const savedBand = bandId.trim();
    try {
      await registerBandedInShed({
        shed_id: shedId,
        band_id: savedBand,
        hatch_date: hatchDate,
        breed: breed.trim() || null,
        sex,
        notes: notes.trim() || null,
        sire: parentDraftToInput(freeTextToParent(sireText)),
        dam: parentDraftToInput(freeTextToParent(damText)),
      });
      invalidate();
      if (andAnother) {
        setBandId("");
        setBreed("");
        setNotes("");
        setSireText("");
        setDamText("");
        setRemoteBandCheck(null);
        toast.success(`Saved ${savedBand}. Enter the next band number.`);
        requestAnimationFrame(() => bandRef.current?.focus());
      } else {
        toast.success("Bird added");
        router.replace(`/(app)/sheds/${shedId}/birds`);
      }
    } catch (e: unknown) {
      setMsg(describeApiError(e, "save the bird"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  const persistUnbanded = async () => {
    if (!canUnbanded || !shedId || submitting.current) return;
    const countErr = validateBirdCount(count);
    if (countErr) {
      setMsg(countErr);
      return;
    }
    if (!hatchDate) {
      setMsg("Hatch date is required");
      return;
    }
    if (hatchDate > todayIsoDate()) {
      setMsg("Hatch date cannot be in the future");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMsg(null);
    try {
      await addUnbandedInShed({
        shed_id: shedId,
        quantity: Number(count.trim()),
        hatch_date: hatchDate,
        idempotency_key: newIdempotencyKey(),
      });
      invalidate();
      toast.success("Birds added");
      router.replace(`/(app)/sheds/${shedId}/birds`);
    } catch (e: unknown) {
      setMsg(describeApiError(e, "add unbanded birds"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  if (!canBanded && !canUnbanded) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.errorPad}>You do not have permission to add birds.</Text>
        <Pressable style={styles.backOnly} onPress={() => safeBack(fallback)}>
          <Text style={styles.backOnlyText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!shedId || shed.isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <HenLoader label="Loading…" />
      </SafeAreaView>
    );
  }

  const bandedReady =
    Boolean(bandId.trim()) && Boolean(hatchDate) && Boolean(sex) && bandAvail !== "taken" && bandAvail !== "invalid";
  const unbandedReady = Boolean(count.trim()) && Boolean(hatchDate);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 12) + 88 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.hero}>
            <Image source={shedHeaderArt} style={styles.heroArt} resizeMode="cover" />
            <View style={styles.heroRow}>
              <Pressable
                onPress={() => safeBack(fallback)}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="arrow-back" size={22} color={birdUi.primary} />
              </Pressable>
              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>Add Bird</Text>
                <Text style={styles.heroSub} numberOfLines={1}>
                  {shedName} Shed
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.modeRow}>
            {canBanded ? (
              <Pressable
                style={[styles.modeCard, mode === "banded" && styles.modeCardOn]}
                onPress={() => {
                  setMode("banded");
                  setMsg(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === "banded" }}
              >
                <Ionicons
                  name="pricetag-outline"
                  size={22}
                  color={mode === "banded" ? birdUi.white : birdUi.primary}
                />
                <Text style={[styles.modeText, mode === "banded" && styles.modeTextOn]}>Banded Bird</Text>
              </Pressable>
            ) : null}
            {canUnbanded ? (
              <Pressable
                style={[styles.modeCard, mode === "unbanded" && styles.modeCardOn]}
                onPress={() => {
                  setMode("unbanded");
                  setMsg(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === "unbanded" }}
              >
                <Ionicons
                  name="egg-outline"
                  size={22}
                  color={mode === "unbanded" ? birdUi.white : birdUi.primary}
                />
                <Text style={[styles.modeText, mode === "unbanded" && styles.modeTextOn]}>
                  Unbanded Bird
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Essential Details</Text>

            {mode === "banded" ? (
              <>
                <Text style={styles.label}>
                  Band number <Text style={styles.req}>*</Text>
                </Text>
                <View
                  style={[
                    styles.inputRow,
                    bandAvail === "taken" || bandAvail === "invalid"
                      ? styles.inputRowError
                      : bandAvail === "available"
                        ? styles.inputRowOk
                        : null,
                  ]}
                >
                  <Ionicons name="pricetag-outline" size={18} color={birdUi.muted} />
                  <TextInput
                    ref={bandRef}
                    style={styles.inputFlex}
                    value={bandId}
                    onChangeText={(t) => {
                      setBandId(t);
                      setMsg(null);
                      setRemoteBandCheck(null);
                    }}
                    placeholder="e.g. 67A"
                    placeholderTextColor={birdUi.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    accessibilityLabel="Band number"
                  />
                  {bandAvail === "available" ? (
                    <Ionicons name="checkmark-circle" size={20} color={birdUi.successText} />
                  ) : bandAvail === "taken" || bandAvail === "invalid" ? (
                    <Ionicons name="alert-circle" size={20} color={birdUi.error} />
                  ) : null}
                </View>
                {bandAvail === "taken" ? (
                  <Text style={styles.hintError}>Already assigned to another bird</Text>
                ) : bandAvail === "available" ? (
                  <Text style={styles.hintOk}>Band number is available</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.label}>
                  Quantity <Text style={styles.req}>*</Text>
                </Text>
                <View style={styles.inputRow}>
                  <Ionicons name="layers-outline" size={18} color={birdUi.muted} />
                  <TextInput
                    style={styles.inputFlex}
                    value={count}
                    onChangeText={(t) => {
                      setCount(t);
                      setMsg(null);
                    }}
                    keyboardType="number-pad"
                    placeholder="Number of birds"
                    placeholderTextColor={birdUi.muted}
                    accessibilityLabel="Quantity"
                  />
                </View>
              </>
            )}

            <AppDatePicker
              label="Hatch date"
              required
              value={hatchDate}
              maximumDate={todayIsoDate()}
              placeholder="Select hatch date"
              onChange={(v) => {
                setHatchDate(v);
                setMsg(null);
              }}
            />

            {mode === "banded" ? (
              <>
                <Text style={styles.label}>
                  Sex <Text style={styles.req}>*</Text>
                </Text>
                <View style={styles.sexRow}>
                  {(
                    [
                      ["male", "Male"],
                      ["female", "Female"],
                    ] as const
                  ).map(([value, label]) => {
                    const on = sex === value;
                    return (
                      <Pressable
                        key={value}
                        style={[styles.sexPill, on && styles.sexPillOn]}
                        onPress={() => {
                          setSex(value);
                          setMsg(null);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.sexText, on && styles.sexTextOn]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {ageDays != null && hatchDate ? (
              <View style={styles.ageBanner}>
                <Ionicons name="time-outline" size={16} color={birdUi.primary} />
                <Text style={styles.ageText}>
                  Age: {ageDays} day{ageDays === 1 ? "" : "s"}
                  {hatchDate ? ` · Hatch ${formatDisplayDate(hatchDate)}` : ""}
                </Text>
              </View>
            ) : null}
          </View>

          {mode === "banded" ? (
            <View style={styles.card}>
              <Pressable
                style={styles.moreHeader}
                onPress={() => setMoreOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: moreOpen }}
              >
                <Text style={styles.cardTitle}>More Details (Optional)</Text>
                <Ionicons
                  name={moreOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={birdUi.muted}
                />
              </Pressable>

              {moreOpen ? (
                <View style={styles.moreBody}>
                  <Text style={styles.label}>Breed</Text>
                  <TextInput
                    style={styles.field}
                    value={breed}
                    onChangeText={setBreed}
                    placeholder="e.g. Kaki"
                    placeholderTextColor={birdUi.muted}
                  />

                  <Text style={[styles.label, { marginTop: 8 }]}>Parentage (Optional)</Text>
                  <Text style={styles.hint}>Enter band ID or name. Selecting an existing bird is not required.</Text>

                  <Text style={styles.parentLabel}>Sire (Father)</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="search-outline" size={18} color={birdUi.muted} />
                    <TextInput
                      style={styles.inputFlex}
                      value={sireText}
                      onChangeText={setSireText}
                      placeholder="Band ID or Name"
                      placeholderTextColor={birdUi.muted}
                      accessibilityLabel="Sire band ID or name"
                    />
                  </View>

                  <Text style={styles.parentLabel}>Dam (Mother)</Text>
                  <View style={styles.inputRow}>
                    <Ionicons name="search-outline" size={18} color={birdUi.muted} />
                    <TextInput
                      style={styles.inputFlex}
                      value={damText}
                      onChangeText={setDamText}
                      placeholder="Band ID or Name"
                      placeholderTextColor={birdUi.muted}
                      accessibilityLabel="Dam band ID or name"
                    />
                  </View>

                  <Text style={styles.label}>Notes</Text>
                  <TextInput
                    style={[styles.field, styles.notes]}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Optional notes"
                    placeholderTextColor={birdUi.muted}
                    multiline
                  />
                </View>
              ) : null}
            </View>
          ) : null}

          {msg ? <Text style={styles.error}>{msg}</Text> : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {mode === "banded" ? (
            <View style={styles.footerRow}>
              <Pressable
                style={[styles.saveSecondary, (!bandedReady || busy) && styles.disabled]}
                disabled={!bandedReady || busy}
                onPress={() => void persistBanded(false)}
                accessibilityRole="button"
                accessibilityLabel="Save"
              >
                <Text style={styles.saveSecondaryText}>Save</Text>
              </Pressable>
              <Pressable
                style={[styles.savePrimary, (!bandedReady || busy) && styles.disabled]}
                disabled={!bandedReady || busy}
                onPress={() => void persistBanded(true)}
                accessibilityRole="button"
                accessibilityLabel="Save and add another"
              >
                <Text style={styles.savePrimaryText}>{busy ? "Saving…" : "Save & Add Another"}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.savePrimaryFull, (!unbandedReady || busy) && styles.disabled]}
              disabled={!unbandedReady || busy}
              onPress={() => void persistUnbanded()}
              accessibilityRole="button"
            >
              <Text style={styles.savePrimaryText}>{busy ? "Saving…" : "Save"}</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: birdUi.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  hero: {
    marginHorizontal: -16,
    minHeight: 96,
    overflow: "hidden",
    backgroundColor: birdUi.paleMint,
  },
  heroArt: { ...StyleSheet.absoluteFill, opacity: 0.45 },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.white,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1 },
  heroTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.deepGreen },
  heroSub: { fontSize: typography.secondary.fontSize, fontWeight: "600", color: birdUi.muted, marginTop: 2 },
  modeRow: { flexDirection: "row", gap: 10 },
  modeCard: {
    flex: 1,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  modeCardOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  modeText: { fontSize: typography.label.fontSize, fontWeight: "800", color: birdUi.text },
  modeTextOn: { color: birdUi.white },
  card: {
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 8,
  },
  cardTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.deepGreen },
  label: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.muted, marginTop: 4 },
  req: { color: birdUi.error },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: birdUi.bg,
  },
  inputRowOk: { borderColor: birdUi.successText },
  inputRowError: { borderColor: birdUi.error, backgroundColor: birdUi.errorPale },
  inputFlex: { flex: 1, fontSize: typography.body.fontSize, fontWeight: "700", color: birdUi.text, paddingVertical: 10 },
  field: {
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
  notes: { minHeight: 80, textAlignVertical: "top" },
  sexRow: { flexDirection: "row", gap: 8 },
  sexPill: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    backgroundColor: birdUi.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  sexPillOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  sexText: { fontSize: typography.bodyStrong.fontSize, fontWeight: "700", color: birdUi.text },
  sexTextOn: { color: birdUi.white },
  ageBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: birdUi.successBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  ageText: { fontSize: typography.secondary.fontSize, fontWeight: "700", color: birdUi.primary },
  moreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
  },
  moreBody: { gap: 6, marginTop: 4 },
  parentLabel: { fontSize: typography.secondary.fontSize, fontWeight: "800", color: birdUi.text, marginTop: 6 },
  hint: { fontSize: typography.caption.fontSize, color: birdUi.muted, lineHeight: 16 },
  hintOk: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.successText },
  hintError: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.error },
  error: { color: birdUi.error, fontWeight: "600", paddingHorizontal: 4 },
  errorPad: { color: birdUi.error, margin: 20, fontWeight: "600" },
  backOnly: {
    marginHorizontal: 20,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: birdUi.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  backOnlyText: { color: birdUi.primary, fontWeight: "800" },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: birdUi.border,
    backgroundColor: birdUi.bg,
  },
  footerRow: { flexDirection: "row", gap: 10 },
  saveSecondary: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: birdUi.primary,
    backgroundColor: birdUi.white,
    alignItems: "center",
    justifyContent: "center",
  },
  saveSecondaryText: { fontSize: typography.bodyStrong.fontSize, fontWeight: "800", color: birdUi.primary },
  savePrimary: {
    flex: 1.35,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: birdUi.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  savePrimaryFull: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: birdUi.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  savePrimaryText: { fontSize: typography.bodyStrong.fontSize, fontWeight: "800", color: birdUi.white },
  disabled: { opacity: 0.45 },
});
