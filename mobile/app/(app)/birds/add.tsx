import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { describeApiError } from "../../../src/api/client";
import { registerBandedInShed } from "../../../src/api/birds";
import { Button } from "../../../src/components/ui/Button";
import { DateField } from "../../../src/components/ui/DateField";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { validateBandNumber } from "../../../src/features/birds/groupOnboardingHelpers";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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
  const [breed, setBreed] = useState("");
  const [sex, setSex] = useState("");
  const [notes, setNotes] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
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
    if (hatchDate > todayIso()) {
      setMsg("Hatch date cannot be in the future");
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
        sex: sex.trim() || null,
        notes: notes.trim() || null,
      });
      invalidate();

      if (andAnother) {
        setBandId("");
        setBreed("");
        setSex("");
        setNotes("");
        // Keep hatch date for rapid entry of siblings; do not auto-fill a blank DOB default.
        setMsg(`Saved ${savedBand}. Enter the next band number.`);
        requestAnimationFrame(() => bandRef.current?.focus());
      } else {
        router.replace(`/(app)/sheds/${shedId}/birds`);
      }
    } catch (e: unknown) {
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
          onPress={() => safeBack(`/(app)/sheds/${shedId}`)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Register banded bird</Text>
          <Text style={styles.subtitle}>Band number and exact hatch date are required</Text>
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

      <DateField
        label="Hatch date *"
        required
        value={hatchDate}
        onChange={(v) => {
          setHatchDate(v);
          setMsg(null);
        }}
      />
      <Text style={styles.hint}>Pick the exact hatch date. Approximate age shortcuts are not used.</Text>

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
          <Text style={styles.label}>Sex</Text>
          <TextInput
            style={styles.input}
            value={sex}
            onChangeText={setSex}
            placeholder="F / M / —"
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

      {msg ? <Text style={styles.error}>{msg}</Text> : null}

      <Button
        label="Save & add another"
        onPress={() => void persistBird(true)}
        loading={busy}
        disabled={!bandId.trim() || !hatchDate || busy}
      />
      <Button
        label="Save"
        variant="secondary"
        onPress={() => void persistBird(false)}
        disabled={!bandId.trim() || !hatchDate || busy}
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
