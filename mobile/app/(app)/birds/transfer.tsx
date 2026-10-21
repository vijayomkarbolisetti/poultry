import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { listBirdsInShed } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { listFlocks, transferToShed } from "../../../src/api/flocks";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { DateField } from "../../../src/components/ui/DateField";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { SelectField } from "../../../src/components/ui/SelectField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { newLifecycleIdempotencyKey } from "../../../src/features/birds/birdSelectionHelpers";
import { firstRouteParam } from "../../../src/navigation/routeParams";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";

export default function TransferBirdsScreen() {
  const params = useLocalSearchParams<{ shedId?: string | string[]; birdIds?: string | string[] }>();
  const shedId = firstRouteParam(params.shedId);
  const preselected = (firstRouteParam(params.birdIds) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const can = hasPermission(user, ownerAccountId, "lifecycle.record");
  const submitting = useRef(false);
  const idem = useRef(newLifecycleIdempotencyKey("shed-xfer"));

  const [mode, setMode] = useState<"banded" | "unbanded">(preselected.length ? "banded" : "banded");
  const [destShedId, setDestShedId] = useState<string | null>(null);
  const [destFlockId, setDestFlockId] = useState<string | null>(null);
  const [sourceFlockId, setSourceFlockId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected));
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sheds = useQuery({
    queryKey: ["sheds", ownerAccountId],
    queryFn: () => listSheds(),
    enabled: can,
  });
  const sourceFlocks = useQuery({
    queryKey: ["flocks", shedId],
    queryFn: () => listFlocks(shedId),
    enabled: !!shedId && can,
  });
  const destFlocks = useQuery({
    queryKey: ["flocks", destShedId],
    queryFn: () => listFlocks(destShedId!),
    enabled: !!destShedId && can,
  });
  const birds = useQuery({
    queryKey: ["shed-birds-xfer", shedId],
    queryFn: () => listBirdsInShed({ shedId: shedId!, limit: 50, offset: 0, includeInactive: false }),
    enabled: !!shedId && can && mode === "banded",
  });

  const destShedOptions = useMemo(
    () =>
      (sheds.data ?? [])
        .filter((s) => s.is_active && s.id !== shedId)
        .map((s) => ({ value: s.id, label: s.name, hint: s.code })),
    [sheds.data, shedId],
  );
  const destFlockOptions = useMemo(
    () =>
      (destFlocks.data ?? [])
        .filter((f) => f.status === "active")
        .map((f) => ({
          value: f.id,
          label: f.batch_code,
          hint: `${f.current_count} live`,
        })),
    [destFlocks.data],
  );
  const sourceFlockOptions = useMemo(
    () =>
      (sourceFlocks.data ?? [])
        .filter((f) => f.status === "active" && f.tracking_mode !== "individual")
        .map((f) => ({
          value: f.id,
          label: f.batch_code,
          hint: `${f.unbanded_count} unbanded`,
        })),
    [sourceFlocks.data],
  );

  const liveBirds = (birds.data?.items ?? []).filter(
    (b) => b.is_active && b.lifecycle_status === "active",
  );

  const onSave = async () => {
    if (!can || submitting.current) return;
    if (!destFlockId) {
      setMsg("Select a destination group");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "banded") {
        const ids = [...selected];
        if (!ids.length) {
          setMsg("Select at least one banded bird");
          return;
        }
        await transferToShed({
          destination_flock_id: destFlockId,
          effective_date: effectiveDate,
          bird_ids: ids,
          idempotency_key: idem.current,
        });
      } else {
        if (!sourceFlockId) {
          setMsg("Select a source group");
          return;
        }
        const qty = Number(quantity);
        if (!Number.isInteger(qty) || qty < 1) {
          setMsg("Enter a valid quantity");
          return;
        }
        await transferToShed({
          destination_flock_id: destFlockId,
          effective_date: effectiveDate,
          source_flock_id: sourceFlockId,
          quantity: qty,
          idempotency_key: idem.current,
        });
      }
      idem.current = newLifecycleIdempotencyKey("shed-xfer");
      void qc.invalidateQueries({ queryKey: ["shed-overview"] });
      void qc.invalidateQueries({ queryKey: ["shed-birds"] });
      void qc.invalidateQueries({ queryKey: ["flocks"] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      safeBack(shedId ? `/(app)/sheds/${shedId}` : "/(app)/sheds");
    } catch (e: unknown) {
      setMsg(describeApiError(e, "transfer birds"));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  };

  if (!can) {
    return (
      <Screen>
        <Text style={styles.error}>No permission to transfer birds.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack()} />
      </Screen>
    );
  }

  if (!shedId) {
    return (
      <Screen>
        <Text style={styles.error}>Open a shed first.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack("/(app)/sheds")} />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack(`/(app)/sheds/${shedId}`)} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Transfer birds</Text>
          <Text style={styles.sub}>Move to another shed — birds stay active</Text>
        </View>
      </View>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, mode === "banded" && styles.modeOn]}
          onPress={() => setMode("banded")}
        >
          <Text style={[styles.modeText, mode === "banded" && styles.modeTextOn]}>Banded</Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, mode === "unbanded" && styles.modeOn]}
          onPress={() => setMode("unbanded")}
        >
          <Text style={[styles.modeText, mode === "unbanded" && styles.modeTextOn]}>Unbanded</Text>
        </Pressable>
      </View>

      <SelectField
        label="Destination shed"
        value={destShedId}
        options={destShedOptions}
        onChange={(v) => {
          setDestShedId(v);
          setDestFlockId(null);
        }}
        loading={sheds.isLoading}
        emptyMessage="No other active sheds"
      />
      <SelectField
        label="Destination group"
        value={destFlockId}
        options={destFlockOptions}
        onChange={setDestFlockId}
        loading={destFlocks.isLoading}
        emptyMessage="Create a group in the destination shed first"
      />
      <DateField
        label="Effective date"
        value={effectiveDate}
        onChange={(v) => setEffectiveDate(v ?? new Date().toISOString().slice(0, 10))}
      />

      {mode === "banded" ? (
        birds.isLoading ? (
          <HenLoader label="Loading birds…" />
        ) : (
          <View style={styles.list}>
            <Text style={styles.listTitle}>Select birds ({selected.size})</Text>
            {liveBirds.map((b) => {
              const on = selected.has(b.id);
              return (
                <Pressable
                  key={b.id}
                  style={[styles.birdRow, on && styles.birdOn]}
                  onPress={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(b.id)) next.delete(b.id);
                      else next.add(b.id);
                      return next;
                    });
                  }}
                >
                  <Ionicons
                    name={on ? "checkbox" : "square-outline"}
                    size={22}
                    color={on ? birdUi.primary : birdUi.muted}
                  />
                  <Text style={styles.band}>{b.band_id ?? b.display_code ?? b.id.slice(0, 8)}</Text>
                </Pressable>
              );
            })}
            {liveBirds.length === 0 ? (
              <Text style={styles.sub}>No active banded birds in this shed.</Text>
            ) : null}
          </View>
        )
      ) : (
        <>
          <SelectField
            label="Source group"
            value={sourceFlockId}
            options={sourceFlockOptions}
            onChange={setSourceFlockId}
            emptyMessage="No groups with unbanded birds"
          />
          <Text style={styles.listTitle}>Quantity</Text>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="number-pad"
            placeholder="1"
            placeholderTextColor={birdUi.muted}
          />
        </>
      )}

      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      <Button label="Confirm transfer" onPress={onSave} loading={busy} disabled={busy} />
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
  sub: { fontSize: 13, color: birdUi.muted },
  modeRow: { flexDirection: "row", gap: 8 },
  modeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
  },
  modeOn: { backgroundColor: birdUi.primary, borderColor: birdUi.primary },
  modeText: { fontWeight: "700", color: birdUi.text },
  modeTextOn: { color: "#fff" },
  list: { gap: 6 },
  listTitle: { fontSize: 14, fontWeight: "700", color: birdUi.muted },
  birdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
  },
  birdOn: { borderColor: birdUi.primary, backgroundColor: birdUi.paleMint },
  band: { fontSize: 16, fontWeight: "700", color: birdUi.text },
  input: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    padding: 14,
    fontSize: 17,
    fontWeight: "700",
    backgroundColor: birdUi.white,
    color: birdUi.text,
  },
  error: { color: birdUi.error, fontWeight: "600" },
});
