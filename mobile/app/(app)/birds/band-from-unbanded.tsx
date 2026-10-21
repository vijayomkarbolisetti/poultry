import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { bandFromUnbanded } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { getFlock } from "../../../src/api/flocks";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { validateBandNumber } from "../../../src/features/birds/groupOnboardingHelpers";
import { newLifecycleIdempotencyKey } from "../../../src/features/birds/birdSelectionHelpers";
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
    if (!flockId || submitting.current) return;
    const err = validateBandNumber(bandId);
    if (err) {
      setMsg(err);
      return;
    }
    if ((flock.data?.unbanded_count ?? 0) < 1) {
      setMsg("This group has no unbanded birds left to band");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const result = await bandFromUnbanded({
        flock_id: flockId,
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

  if (flock.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading group…" />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => safeBack(shedId ? `/(app)/sheds/${shedId}/birds` : undefined)}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Band a bird</Text>
          <Text style={styles.sub}>From unbanded cohort · creates a new individual record</Text>
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.infoText}>
          Unbanded birds have no personal history. This assigns a band to one bird from the group
          count, reuses the group’s age metadata, and keeps the live total unchanged.
        </Text>
      </View>

      {flock.data ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{flock.data.batch_code}</Text>
          <Text style={styles.meta}>
            Unbanded {flock.data.unbanded_count} · Banded {flock.data.banded_count} · Live{" "}
            {flock.data.current_count}
          </Text>
          <Text style={styles.meta}>
            Age: {flock.data.dob_confidence}
            {flock.data.hatch_date ? ` · hatch ${flock.data.hatch_date}` : ""}
            {flock.data.estimated_age_days != null ? ` · ~${flock.data.estimated_age_days}d` : ""}
          </Text>
        </View>
      ) : null}

      <Text style={styles.label}>Band number *</Text>
      <TextInput
        style={styles.input}
        value={bandId}
        onChangeText={(t) => {
          setBandId(t);
          setMsg(null);
        }}
        placeholder="Enter unique band number"
        placeholderTextColor={birdUi.muted}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      {msg ? <Text style={styles.error}>{msg}</Text> : null}

      <Button
        label="Create banded bird"
        onPress={() => void save()}
        loading={busy}
        disabled={!bandId.trim() || busy || (flock.data?.unbanded_count ?? 0) < 1}
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
  title: { fontSize: 22, fontWeight: "800", color: birdUi.text },
  sub: { fontSize: 13, color: birdUi.muted, marginTop: 2 },
  info: {
    backgroundColor: birdUi.bluePale,
    borderRadius: 14,
    padding: 12,
  },
  infoText: { fontSize: 13, color: birdUi.textSecondary, lineHeight: 18 },
  card: {
    backgroundColor: birdUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: birdUi.text },
  meta: { fontSize: 13, color: birdUi.muted },
  label: { fontSize: 13, fontWeight: "700", color: birdUi.muted },
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
  error: { color: birdUi.error, fontWeight: "600" },
});
