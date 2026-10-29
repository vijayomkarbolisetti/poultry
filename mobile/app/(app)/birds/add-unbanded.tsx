import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { addUnbandedInShed } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { getShed } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { validateBirdCount } from "../../../src/features/birds/groupOnboardingHelpers";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { toast } from "../../../src/ui/toast/toastStore";

function newIdempotencyKey(): string {
  return `ub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function AddUnbandedScreen() {
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

  const [count, setCount] = useState("50");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!shedId || submitting.current) return;
    const countErr = validateBirdCount(count);
    if (countErr) {
      setError(countErr);
      return;
    }
    if (!hatchDate) {
      setError("Hatch date is required");
      return;
    }
    if (hatchDate > todayIsoDate()) {
      setError("Hatch date cannot be in the future");
      return;
    }
    const n = Number(count.trim());
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await addUnbandedInShed({
        shed_id: shedId,
        quantity: n,
        hatch_date: hatchDate,
        idempotency_key: newIdempotencyKey(),
      });
      void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
      void qc.invalidateQueries({ queryKey: ["shed-birds", shedId] });
      void qc.invalidateQueries({ queryKey: ["flocks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      toast.success("Birds added");
      router.replace(`/(app)/sheds/${shedId}/birds`);
    } catch (e: unknown) {
      setError(describeApiError(e, "add unbanded birds"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  if (!canCreate) {
    return (
      <Screen>
        <Text style={styles.error}>No permission to add birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (!shedId || shed.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading…" />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack(`/(app)/sheds/${shedId}/birds`)} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Add unbanded birds</Text>
          <Text style={styles.sub}>{shed.data?.name ?? "Shed"}</Text>
        </View>
      </View>

      <Text style={styles.q}>How many birds?</Text>
      <View style={styles.countRow}>
        <TextInput
          style={styles.countInput}
          value={count}
          onChangeText={setCount}
          keyboardType="number-pad"
          placeholder="50"
          placeholderTextColor={birdUi.muted}
        />
        <Text style={styles.suffix}>birds</Text>
      </View>

      <AppDatePicker
        label="Hatch date"
        required
        value={hatchDate}
        maximumDate={todayIsoDate()}
        placeholder="Select hatch date"
        onChange={(v) => {
          setHatchDate(v);
          setError(null);
        }}
      />
      <Text style={styles.hint}>
        Exact hatch date is required. Birds with the same hatch date in this shed are kept together
        automatically — you do not manage groups.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label="Save"
        onPress={() => void save()}
        loading={busy}
        disabled={busy || !hatchDate}
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
  sub: { fontSize: 13, color: birdUi.muted, marginTop: 2 },
  q: { fontSize: 15, fontWeight: "700", color: birdUi.text, marginTop: 8 },
  countRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  countInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: birdUi.white,
    color: birdUi.text,
    fontSize: 22,
    fontWeight: "800",
    minHeight: 56,
  },
  suffix: { fontSize: 16, fontWeight: "700", color: birdUi.muted },
  hint: { fontSize: 13, color: birdUi.muted, lineHeight: 18 },
  error: { color: birdUi.error, fontWeight: "600" },
});
