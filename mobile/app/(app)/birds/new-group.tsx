import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { describeApiError } from "../../../src/api/client";
import { createFlock } from "../../../src/api/flocks";
import { getShed } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { DateField } from "../../../src/components/ui/DateField";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  AGE_CHIPS,
  type AgeChipId,
  mapAgeChipToPayload,
  suggestGroupName,
  validateAgeSelection,
  validateBirdCount,
  validateGroupName,
} from "../../../src/features/birds/groupOnboardingHelpers";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";

export default function NewGroupWizardScreen() {
  const params = useLocalSearchParams<{ shedId?: string | string[] }>();
  const shedId = firstRouteParam(params.shedId);
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canCreate = hasPermission(user, ownerAccountId, "flock.create");
  const submitting = useRef(false);

  const shed = useQuery({
    queryKey: ["shed", shedId],
    queryFn: () => getShed(shedId!),
    enabled: !!shedId && canCreate,
  });

  const [step, setStep] = useState<1 | 2>(1);
  const [count, setCount] = useState("100");
  const [ageChip, setAgeChip] = useState<AgeChipId | null>("day-old");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggested = useMemo(
    () => suggestGroupName(shed.data?.code ?? "SHED"),
    [shed.data?.code],
  );

  useEffect(() => {
    if (!nameTouched && suggested) setGroupName(suggested);
  }, [suggested, nameTouched]);

  if (!canCreate) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to create a group.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(shedId ? `/(app)/sheds/${shedId}` : undefined)} />
      </Screen>
    );
  }

  if (!shedId) {
    return (
      <Screen>
        <Text style={styles.error}>Missing shed. Open a shed and try again.</Text>
        <Button label="Back to sheds" variant="secondary" onPress={() => router.replace("/(app)/sheds")} />
      </Screen>
    );
  }

  if (shed.isLoading || (!shed.data && shed.isFetching)) {
    return (
      <Screen>
        <HenLoader label="Loading shed…" />
      </Screen>
    );
  }

  if (shed.isError || !shed.data) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(shed.error, "load shed")}</Text>
        <Button label="Retry" onPress={() => shed.refetch()} />
      </Screen>
    );
  }

  if (!shed.data.is_active) {
    return (
      <Screen>
        <Text style={styles.error}>This shed is inactive. Reactivate it before adding a group.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(`/(app)/sheds/${shedId}`)} />
      </Screen>
    );
  }

  const onNext = () => {
    setError(null);
    const countErr = validateBirdCount(count);
    if (countErr) {
      setError(countErr);
      return;
    }
    const ageErr = validateAgeSelection(ageChip, hatchDate);
    if (ageErr) {
      setError(ageErr);
      return;
    }
    setStep(2);
  };

  const onCreate = async () => {
    if (submitting.current || busy) return;
    setError(null);
    const countErr = validateBirdCount(count);
    if (countErr) {
      setError(countErr);
      setStep(1);
      return;
    }
    const ageErr = validateAgeSelection(ageChip, hatchDate);
    if (ageErr) {
      setError(ageErr);
      setStep(1);
      return;
    }
    const nameErr = validateGroupName(groupName);
    if (nameErr) {
      setError(nameErr);
      return;
    }
    if (!ageChip) return;

    submitting.current = true;
    setBusy(true);
    try {
      const age = mapAgeChipToPayload(ageChip, hatchDate);
      const n = Number(count.trim());
      const flock = await createFlock({
        shed_id: shedId,
        batch_code: groupName.trim().toUpperCase(),
        initial_count: n,
        tracking_mode: "batch",
        dob_confidence: age.dob_confidence,
        hatch_date: age.hatch_date ?? undefined,
        estimated_age_days: age.estimated_age_days ?? undefined,
        age_reported_on: age.age_reported_on ?? undefined,
        unbanded_count: n,
      });
      void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
      void qc.invalidateQueries({ queryKey: ["flocks"] });
      void qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      router.replace({
        pathname: "/(app)/birds/group-created",
        params: {
          shedId,
          flockId: flock.id,
          batchCode: flock.batch_code,
          count: String(flock.initial_count),
          shedName: shed.data.name,
        },
      });
    } catch (e: unknown) {
      setError(describeApiError(e, "create the group"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (step === 1 ? safeBack(`/(app)/sheds/${shedId}`) : setStep(1))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>New group of birds</Text>
          <Text style={styles.progress}>{step} of 3</Text>
        </View>
      </View>

      <Text style={styles.shedHint}>
        Adding to <Text style={styles.shedHintStrong}>{shed.data.name}</Text> ({shed.data.code})
      </Text>

      {step === 1 ? (
        <View style={styles.block}>
          <Text style={styles.question}>How many birds?</Text>
          <Text style={styles.help}>Enter the total number of birds in this group.</Text>
          <View style={styles.countRow}>
            <TextInput
              style={styles.countInput}
              value={count}
              onChangeText={setCount}
              keyboardType="number-pad"
              placeholder="100"
              placeholderTextColor={birdUi.muted}
              accessibilityLabel="Bird count"
            />
            <Text style={styles.countSuffix}>birds</Text>
          </View>

          <Text style={[styles.question, { marginTop: 20 }]}>About how old are they?</Text>
          <View style={styles.chipGrid}>
            {AGE_CHIPS.map((chip) => {
              const selected = ageChip === chip.id;
              return (
                <Pressable
                  key={chip.id}
                  onPress={() => {
                    setAgeChip(chip.id);
                    if (chip.id !== "exact") setHatchDate(null);
                    setError(null);
                  }}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {chip.label}
                  </Text>
                  {chip.id === "exact" ? (
                    <Ionicons
                      name="calendar-outline"
                      size={14}
                      color={selected ? birdUi.white : birdUi.primary}
                      style={{ marginLeft: 4 }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {ageChip === "exact" ? (
            <DateField
              label="Hatch date"
              required
              value={hatchDate}
              onChange={(v) => {
                setHatchDate(v);
                setError(null);
              }}
            />
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Next" onPress={onNext} />
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.question}>Group name (optional)</Text>
          <Text style={styles.help}>We&apos;ll suggest a name. You can keep it or change it.</Text>
          <TextInput
            style={styles.nameInput}
            value={groupName}
            onChangeText={(t) => {
              setNameTouched(true);
              setGroupName(t);
              setError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={suggested}
            placeholderTextColor={birdUi.muted}
            accessibilityLabel="Group name"
          />

          <View style={styles.infoCard}>
            <View style={styles.infoIcon}>
              <Ionicons name="layers-outline" size={20} color={birdUi.teal} />
            </View>
            <Text style={styles.infoText}>
              We&apos;ll create a group for these birds. You can start tagging individual birds anytime.
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Create group" onPress={onCreate} loading={busy} disabled={busy} />
        </View>
      )}
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
  progress: { fontSize: 13, fontWeight: "600", color: birdUi.primary, marginTop: 2 },
  shedHint: { fontSize: 14, color: birdUi.muted },
  shedHintStrong: { fontWeight: "700", color: birdUi.text },
  block: { gap: 10 },
  question: { fontSize: 18, fontWeight: "800", color: birdUi.text },
  help: { fontSize: 14, color: birdUi.muted, lineHeight: 20, marginTop: -4 },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 16,
    backgroundColor: birdUi.white,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  countInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: "700",
    color: birdUi.text,
    paddingVertical: 12,
  },
  countSuffix: { fontSize: 15, fontWeight: "600", color: birdUi.muted },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
    minHeight: 42,
  },
  chipSelected: {
    backgroundColor: birdUi.primary,
    borderColor: birdUi.primary,
  },
  chipLabel: { fontSize: 14, fontWeight: "700", color: birdUi.text },
  chipLabelSelected: { color: birdUi.white },
  nameInput: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 16,
    backgroundColor: birdUi.white,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    fontWeight: "700",
    color: birdUi.text,
    minHeight: 56,
  },
  infoCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: birdUi.paleMint,
    borderRadius: 16,
    padding: 14,
    alignItems: "flex-start",
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: birdUi.white,
    alignItems: "center",
    justifyContent: "center",
  },
  infoText: { flex: 1, fontSize: 14, color: birdUi.textSecondary, lineHeight: 20 },
  error: { color: birdUi.error, fontSize: 14, fontWeight: "600" },
});
