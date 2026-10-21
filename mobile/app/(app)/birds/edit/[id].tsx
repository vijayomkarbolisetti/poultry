import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";

import { getBirdProfile, updateBird } from "../../../../src/api/birds";
import { describeApiError } from "../../../../src/api/client";
import { Button } from "../../../../src/components/ui/Button";
import { DateField } from "../../../../src/components/ui/DateField";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { Screen } from "../../../../src/components/ui/Screen";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import { safeBack } from "../../../../src/navigation/safeBack";
import { colors, radius, space } from "../../../../src/theme/tokens";

const DOB_OPTIONS = [
  { value: "unknown", label: "Unknown" },
  { value: "exact", label: "Exact hatch date" },
  { value: "estimated", label: "Estimated age" },
];

export default function EditBirdScreen() {
  const { id, fromShedId } = useLocalSearchParams<{ id: string; fromShedId?: string }>();
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canUpdate = hasPermission(user, ownerAccountId, "bird.update");
  const submitting = useRef(false);

  const profile = useQuery({
    queryKey: ["bird-profile", id],
    queryFn: () => getBirdProfile(id!),
    enabled: !!id && canUpdate,
  });

  const [bandId, setBandId] = useState("");
  const [breed, setBreed] = useState("");
  const [sex, setSex] = useState("");
  const [dobConfidence, setDobConfidence] = useState<string | null>("unknown");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [ageDays, setAgeDays] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!profile.data || seeded) return;
    const p = profile.data;
    setBandId(p.band_id ?? "");
    setBreed(p.breed ?? "");
    setSex(p.sex ?? "");
    setDobConfidence(p.dob_confidence);
    setHatchDate(p.hatch_date ?? null);
    setAgeDays(p.estimated_age_days != null ? String(p.estimated_age_days) : "");
    setNotes(p.notes ?? "");
    setSeeded(true);
  }, [profile.data, seeded]);

  const fallback = fromShedId
    ? `/(app)/sheds/${fromShedId}`
    : id
      ? `/(app)/birds/${id}`
      : "/(app)/search";

  const onSave = async () => {
    if (!id || !canUpdate || submitting.current) return;
    if (!bandId.trim()) {
      setMsg("Band number is required");
      return;
    }
    if (dobConfidence === "exact" && !hatchDate) {
      setMsg("Hatch date is required for exact DOB");
      return;
    }
    if (dobConfidence === "estimated" && !ageDays) {
      setMsg("Estimated age (days) is required");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMsg(null);
    try {
      await updateBird(id, {
        band_id: bandId.trim(),
        breed: breed.trim() || null,
        sex: sex.trim() || null,
        notes: notes.trim() || null,
        dob_confidence: dobConfidence ?? "unknown",
        hatch_date: hatchDate || null,
        estimated_age_days: ageDays ? Number(ageDays) : null,
        age_reported_on: dobConfidence === "estimated" ? new Date().toISOString().slice(0, 10) : null,
      });
      void qc.invalidateQueries({ queryKey: ["bird-profile", id] });
      void qc.invalidateQueries({ queryKey: ["shed-birds"] });
      void qc.invalidateQueries({ queryKey: ["shed-overview"] });
      void qc.invalidateQueries({ queryKey: ["birds"] });
      void qc.invalidateQueries({ queryKey: ["flock"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      safeBack(fallback);
    } catch (e: unknown) {
      setMsg(describeApiError(e, "save bird details"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  if (!canUpdate) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to edit birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(fallback)} />
      </Screen>
    );
  }

  if (profile.isLoading || !seeded) {
    return (
      <Screen>
        <HenLoader label="Loading bird…" />
      </Screen>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(profile.error, "load bird")}</Text>
        <Button label="Retry" onPress={() => profile.refetch()} />
      </Screen>
    );
  }

  const p = profile.data;

  return (
    <Screen scroll>
      <Text style={styles.title}>Change band number</Text>
      <Text style={styles.meta}>
        Correct this bird&apos;s band. This updates the same bird record — it does not create a new bird or
        move the bird between sheds.
      </Text>

      <Text style={styles.system}>System — bird ID: {p.id}</Text>
      <Text style={styles.system}>
        System — batch {p.batch_code} · shed {p.shed_name} · status {p.lifecycle_status}
      </Text>

      <Text style={styles.label}>Band number *</Text>
      <TextInput
        style={styles.input}
        value={bandId}
        onChangeText={setBandId}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Text style={styles.label}>Breed</Text>
      <TextInput style={styles.input} value={breed} onChangeText={setBreed} />
      <Text style={styles.label}>Sex</Text>
      <TextInput style={styles.input} value={sex} onChangeText={setSex} />

      <SelectField label="DOB confidence" value={dobConfidence} options={DOB_OPTIONS} onChange={setDobConfidence} />
      {dobConfidence === "exact" ? <DateField label="Hatch date" value={hatchDate} onChange={setHatchDate} /> : null}
      {dobConfidence === "estimated" ? (
        <>
          <Text style={styles.label}>Estimated age (days)</Text>
          <TextInput style={styles.input} value={ageDays} onChangeText={setAgeDays} keyboardType="number-pad" />
        </>
      ) : null}

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline />

      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      <Button label="Save changes" onPress={onSave} loading={busy} disabled={!bandId.trim()} />
      <Button label="Cancel" variant="secondary" onPress={() => safeBack(fallback)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "800", color: colors.brand, marginBottom: space.xs },
  meta: { color: colors.inkMuted, fontSize: 14, marginBottom: space.md, lineHeight: 20 },
  system: { color: colors.inkMuted, fontSize: 12, marginBottom: 2 },
  label: { fontSize: 13, fontWeight: "700", color: colors.inkMuted, marginTop: space.sm, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    backgroundColor: colors.bgElevated,
    color: colors.ink,
    fontSize: 16,
  },
  error: { color: colors.danger, marginVertical: space.sm },
});
