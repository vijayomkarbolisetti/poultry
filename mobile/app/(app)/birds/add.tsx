import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { describeApiError } from "../../../src/api/client";
import { registerBandedInShed } from "../../../src/api/birds";
import {
  EMPTY_PARENT,
  ParentageFields,
  parentDraftToInput,
  type ParentDraft,
} from "../../../src/components/birds/ParentageFields";
import { Button } from "../../../src/components/ui/Button";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { Screen } from "../../../src/components/ui/Screen";
import { SelectField } from "../../../src/components/ui/SelectField";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { BIRD_SEX_OPTIONS } from "../../../src/features/birds/birdListHelpers";
import { validateBandNumber } from "../../../src/features/birds/groupOnboardingHelpers";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { toast } from "../../../src/ui/toast/toastStore";

const SEX_OPTIONS = BIRD_SEX_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

export default function RegisterBandedBirdScreen() {
  const params = useLocalSearchParams<{ shedId?: string | string[] }>();
  const shedId = firstRouteParam(params.shedId);
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canCreate = hasPermission(user, ownerAccountId, "bird.create");
  const submitting = useRef(false);
  const bandRef = useRef<TextInput>(null);

  const [bandId, setBandId] = useState("");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [sex, setSex] = useState<string | null>(null);
  const [breed, setBreed] = useState("");
  const [notes, setNotes] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [parentageOpen, setParentageOpen] = useState(false);
  const [sire, setSire] = useState<ParentDraft>(EMPTY_PARENT);
  const [dam, setDam] = useState<ParentDraft>(EMPTY_PARENT);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => bandRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["shed-birds", shedId] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };

  const persistBird = async (andAnother: boolean) => {
    if (!canCreate || !shedId || submitting.current) return;
    const bandErr = validateBandNumber(bandId);
    if (bandErr) {
      setMsg(bandErr);
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
        sire: parentDraftToInput(sire),
        dam: parentDraftToInput(dam),
      });
      invalidate();

      if (andAnother) {
        setBandId("");
        setBreed("");
        setNotes("");
        // Keep hatch, sex, and parentage for rapid sibling entry.
        toast.success(`Saved ${savedBand}. Enter the next band number.`);
        requestAnimationFrame(() => bandRef.current?.focus());
      } else {
        toast.success("Bird added");
        router.replace(`/(app)/sheds/${shedId}/birds`);
      }
    } catch (e: unknown) {
      // Form stays open — inline error only (no duplicate toast).
      setMsg(describeApiError(e, "save the bird"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  if (!canCreate) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to register birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (!shedId) {
    return (
      <Screen>
        <Text style={styles.error}>Open a shed first, then register birds from Add birds.</Text>
        <Button label="Back to sheds" variant="secondary" onPress={() => router.replace("/(app)/sheds")} />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => safeBack(`/(app)/sheds/${shedId}/birds`)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Register banded bird</Text>
          <Text style={styles.subtitle}>Band number, hatch date, and sex are required</Text>
        </View>
      </View>

      <Text style={styles.label}>Band number *</Text>
      <TextInput
        ref={bandRef}
        style={styles.input}
        value={bandId}
        onChangeText={(t) => {
          setBandId(t);
          setMsg(null);
        }}
        placeholder="Enter band number"
        placeholderTextColor={birdUi.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void persistBird(true)}
        accessibilityLabel="Band number"
      />

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
      <Text style={styles.hint}>Pick the exact hatch date. Approximate age shortcuts are not used.</Text>

      <SelectField
        label="Sex"
        required
        placeholder="Select"
        value={sex}
        options={SEX_OPTIONS}
        onChange={(v) => {
          setSex(v);
          setMsg(null);
        }}
        clearable={false}
      />

      <Pressable
        onPress={() => setMoreOpen((v) => !v)}
        style={styles.moreToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
      >
        <Text style={styles.moreLabel}>More details (optional)</Text>
        <Ionicons name={moreOpen ? "chevron-up" : "chevron-down"} size={18} color={birdUi.muted} />
      </Pressable>

      {moreOpen ? (
        <View style={styles.moreBlock}>
          <Text style={styles.label}>Breed</Text>
          <TextInput
            style={styles.input}
            value={breed}
            onChangeText={setBreed}
            placeholder="Breed"
            placeholderTextColor={birdUi.muted}
          />
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, { minHeight: 72 }]}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Optional"
            placeholderTextColor={birdUi.muted}
          />
        </View>
      ) : null}

      <Pressable
        onPress={() => setParentageOpen((v) => !v)}
        style={styles.moreToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: parentageOpen }}
      >
        <Text style={styles.moreLabel}>Parentage (Optional)</Text>
        <Ionicons
          name={parentageOpen ? "chevron-up" : "chevron-down"}
          size={18}
          color={birdUi.muted}
        />
      </Pressable>

      {parentageOpen ? (
        <View style={styles.moreBlock}>
          <Text style={styles.hint}>
            Name and wing band number are optional. You can leave both parents blank.
          </Text>
          <ParentageFields role="sire" value={sire} onChange={setSire} />
          <ParentageFields role="dam" value={dam} onChange={setDam} />
        </View>
      ) : null}

      {msg ? <Text style={styles.error}>{msg}</Text> : null}

      <Button
        label="Save & add another"
        onPress={() => void persistBird(true)}
        loading={busy}
        disabled={!bandId.trim() || !hatchDate || !sex || busy}
      />
      <Button
        label="Save"
        variant="secondary"
        onPress={() => void persistBird(false)}
        disabled={!bandId.trim() || !hatchDate || !sex || busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "800", color: birdUi.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: birdUi.muted, marginTop: 2 },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: birdUi.muted,
    marginTop: 4,
  },
  hint: { fontSize: 12, color: birdUi.muted, lineHeight: 17, marginTop: -4 },
  input: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: birdUi.white,
    color: birdUi.text,
    fontSize: 17,
    fontWeight: "600",
    minHeight: 52,
  },
  moreToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  moreLabel: { fontSize: 15, fontWeight: "700", color: birdUi.primary },
  moreBlock: { gap: 6 },
  error: { color: birdUi.error, fontWeight: "600" },
});
