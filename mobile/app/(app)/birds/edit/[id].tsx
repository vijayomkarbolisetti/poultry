import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { getBirdProfile, updateBird } from "../../../../src/api/birds";
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
import { Screen } from "../../../../src/components/ui/Screen";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { todayIsoDate } from "../../../../src/components/ui/selectUtils";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import {
  BIRD_SEX_OPTIONS,
  normalizeSexSelectValue,
} from "../../../../src/features/birds/birdListHelpers";
import { safeBack } from "../../../../src/navigation/safeBack";
import { colors, radius, space } from "../../../../src/theme/tokens";
import { toast } from "../../../../src/ui/toast/toastStore";

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
  const [sex, setSex] = useState<string | null>(null);
  const [dobConfidence, setDobConfidence] = useState<string | null>("unknown");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [ageDays, setAgeDays] = useState("");
  const [notes, setNotes] = useState("");
  const [sire, setSire] = useState<ParentDraft>(EMPTY_PARENT);
  const [dam, setDam] = useState<ParentDraft>(EMPTY_PARENT);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!profile.data || seeded) return;
    const p = profile.data;
    setBandId(p.band_id ?? "");
    setBreed(p.breed ?? "");
    setSex(normalizeSexSelectValue(p.sex));
    setDobConfidence(p.dob_confidence);
    setHatchDate(p.hatch_date ?? null);
    setAgeDays(p.estimated_age_days != null ? String(p.estimated_age_days) : "");
    setNotes(p.notes ?? "");
    setSire(draftFromParentage(p.sire_parentage, p.sire));
    setDam(draftFromParentage(p.dam_parentage, p.dam));
    setSeeded(true);
  }, [profile.data, seeded]);

  const fallback = fromShedId
    ? `/(app)/sheds/${fromShedId}/birds`
    : id
      ? `/(app)/birds/${id}`
      : "/(app)/search";

  const onSave = async () => {
    if (!id || !canUpdate || submitting.current) return;
    if (!bandId.trim()) {
      setMsg("Band number is required");
      return;
    }
    if (!sex) {
      setMsg("Select sex");
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
        sex: sex || null,
        notes: notes.trim() || null,
        dob_confidence: dobConfidence ?? "unknown",
        hatch_date: hatchDate || null,
        estimated_age_days: ageDays ? Number(ageDays) : null,
        age_reported_on: dobConfidence === "estimated" ? todayIsoDate() : null,
        sire: parentDraftToInput(sire),
        dam: parentDraftToInput(dam),
      });
      void qc.invalidateQueries({ queryKey: ["bird-profile", id] });
      void qc.invalidateQueries({ queryKey: ["shed-birds"] });
      void qc.invalidateQueries({ queryKey: ["shed-overview"] });
      void qc.invalidateQueries({ queryKey: ["birds"] });
      void qc.invalidateQueries({ queryKey: ["flock"] });
      void qc.invalidateQueries({ queryKey: ["search"] });
      toast.success("Bird updated");
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
        System — shed {p.shed_name}
        {p.hatch_date ? ` · hatch ${p.hatch_date}` : ""} · status {p.lifecycle_status}
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
      <SelectField
        label="Sex"
        required
        placeholder="Select"
        value={sex}
        options={SEX_OPTIONS}
        onChange={setSex}
        clearable={false}
      />

      <SelectField label="DOB confidence" value={dobConfidence} options={DOB_OPTIONS} onChange={setDobConfidence} />
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
          <Text style={styles.label}>Estimated age (days)</Text>
          <TextInput style={styles.input} value={ageDays} onChangeText={setAgeDays} keyboardType="number-pad" />
        </>
      ) : null}

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, { minHeight: 80 }]} value={notes} onChangeText={setNotes} multiline />

      <Text style={styles.label}>Parentage (optional)</Text>
      <Text style={styles.meta}>Name and wing band number are optional for each parent.</Text>
      <View style={{ gap: 10 }}>
        <ParentageFields role="sire" value={sire} onChange={setSire} excludeBirdId={id} />
        <ParentageFields role="dam" value={dam} onChange={setDam} excludeBirdId={id} />
      </View>

      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      <Button label="Save changes" onPress={onSave} loading={busy} disabled={!bandId.trim() || !sex} />
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
