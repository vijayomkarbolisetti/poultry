import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { bandFromUnbandedByCohort } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { getFlock } from "../../../src/api/flocks";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { formatBirdAge } from "../../../src/features/birds/birdListHelpers";
import { validateBandNumber } from "../../../src/features/birds/groupOnboardingHelpers";
import { newLifecycleIdempotencyKey } from "../../../src/features/birds/birdSelectionHelpers";
import { cohortAgePayload, cohortKeyFromAge } from "../../../src/features/birds/transferHelpers";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";

export default function BandFromUnbandedScreen() {
  const params = useLocalSearchParams<{
    shedId?: string | string[];
    flockId?: string | string[];
  }>();
  const shedId = firstRouteParam(params.shedId);
  const flockId = firstRouteParam(params.flockId);
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canCreate = hasPermission(user, ownerAccountId, "bird.create");
  const submitting = useRef(false);
  const idemKey = useRef(newLifecycleIdempotencyKey("band-from-unbanded"));

  const flock = useQuery({
    queryKey: ["flock", flockId],
    queryFn: () => getFlock(flockId!),
    enabled: !!flockId && canCreate,
  });

  const [bandId, setBandId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    if (!flockId || !shedId || !flock.data || submitting.current) return;
    const err = validateBandNumber(bandId);
    if (err) {
      setMsg(err);
      return;
    }
    if ((flock.data.unbanded_count ?? 0) < 1) {
      setMsg("This hatch-date population has no unbanded birds left to band");
      return;
    }
    const key = cohortKeyFromAge({
      hatch_date: flock.data.hatch_date,
      estimated_age_days: flock.data.estimated_age_days,
      age_reported_on: flock.data.age_reported_on,
    });
    const ageFields = cohortAgePayload(key);
    if (!ageFields) {
      setMsg(
        "This population has no hatch date or estimated age key, so banding by cohort is not available.",
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const result = await bandFromUnbandedByCohort({
        shed_id: shedId,
        ...ageFields,
        band_id: bandId.trim(),
        idempotency_key: idemKey.current,
      });
      void qc.invalidateQueries({ queryKey: ["shed-birds", shedId] });
      void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
      void qc.invalidateQueries({ queryKey: ["flock", flockId] });
      void qc.invalidateQueries({ queryKey: ["flocks"] });
      idemKey.current = newLifecycleIdempotencyKey("band-from-unbanded");
      router.replace({
        pathname: "/(app)/birds/[id]",
        params: { id: result.bird.id, fromShedId: shedId ?? result.bird.shed_id },
      });
    } catch (e: unknown) {
      setMsg(describeApiError(e, "band bird from unbanded count"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  if (!canCreate) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to band birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (!flockId) {
    return (
      <Screen>
        <Text style={styles.error}>
          Missing unbanded population. Open this screen from a shed birds list.
        </Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (!shedId) {
    return (
      <Screen>
        <Text style={styles.error}>Missing shed. Open this screen from a shed birds list.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (flock.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading population…" />
      </Screen>
    );
  }

  if (flock.isError || !flock.data) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(flock.error, "load population")}</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(`/(app)/sheds/${shedId}`)} />
      </Screen>
    );
  }

  const f = flock.data;

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack(`/(app)/sheds/${shedId}`)} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={birdUi.text} />
        </Pressable>
        <Text style={styles.title}>Register band</Text>
      </View>
      <Text style={styles.sub}>
        Converts one unbanded bird into a banded individual. Live population stays the same.
      </Text>
      <Text style={styles.meta}>
        {formatBirdAge({
          hatch_date: f.hatch_date,
          estimated_age_days: f.estimated_age_days,
        })}{" "}
        · {f.unbanded_count} unbanded
      </Text>

      <Text style={styles.label}>Band number</Text>
      <TextInput
        style={styles.input}
        value={bandId}
        onChangeText={setBandId}
        autoCapitalize="characters"
        placeholder="e.g. A-102"
        placeholderTextColor={birdUi.muted}
      />

      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      <Button label={busy ? "Saving…" : "Save band"} onPress={() => void save()} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: birdUi.text },
  sub: { color: birdUi.muted, marginBottom: 8, lineHeight: 20 },
  meta: { color: birdUi.text, fontWeight: "600", marginBottom: 16 },
  label: { fontWeight: "600", color: birdUi.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    color: birdUi.text,
    backgroundColor: "#fff",
  },
  error: { color: "#B42318", marginBottom: 12 },
});
