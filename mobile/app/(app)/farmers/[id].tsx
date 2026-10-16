import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { listFarmers, setFarmerPermissions, setFarmerSheds, updateFarmer } from "../../../src/api/farmers";
import { describeApiError } from "../../../src/api/client";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { FARMER_PERM_OPTIONS, PERMISSION_LABELS } from "../../../src/features/auth/permissions";
import { colors, radius, shadow, space } from "../../../src/theme/tokens";

export default function FarmerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const farmers = useQuery({ queryKey: ["farmers", ownerAccountId], queryFn: listFarmers });
  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: listSheds });
  const farmer = (farmers.data ?? []).find((f) => f.membership_id === id);

  const [perms, setPerms] = useState<string[]>([]);
  const [shedIds, setShedIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!farmer) return;
    setPerms(farmer.permission_codes ?? []);
    setShedIds(farmer.assigned_shed_ids ?? []);
  }, [farmer?.membership_id, farmer?.permission_codes?.join(","), farmer?.assigned_shed_ids?.join(",")]);

  const toggleActive = useMutation({
    mutationFn: () => updateFarmer(id!, { is_active: !farmer?.is_active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
      setMsg("Status updated");
    },
  });

  const savePerms = useMutation({
    mutationFn: () => setFarmerPermissions(id!, perms),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
      setMsg("Permissions saved");
      setErr(null);
    },
    onError: (e) => setErr(describeApiError(e, "save permissions")),
  });

  const saveSheds = useMutation({
    mutationFn: () => setFarmerSheds(id!, shedIds),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
      setMsg("Shed assignments saved");
      setErr(null);
    },
    onError: (e) => setErr(describeApiError(e, "save sheds")),
  });

  if (farmers.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading this farmer…" />
      </Screen>
    );
  }
  if (!farmer) {
    return (
      <Screen>
        <Text style={styles.error}>Farmer not found</Text>
      </Screen>
    );
  }

  const permsDirty =
    [...perms].sort().join(",") !== [...(farmer.permission_codes ?? [])].sort().join(",");
  const shedsDirty =
    [...shedIds].sort().join(",") !== [...(farmer.assigned_shed_ids ?? [])].sort().join(",");

  return (
    <Screen scroll>
      <View style={[styles.card, shadow.card]}>
        <Text style={styles.title}>{farmer.full_name}</Text>
        <Text style={styles.meta}>{farmer.email}</Text>
        <Text style={styles.meta}>
          {farmer.role.replace("_", " ")} · {farmer.is_active ? "Active" : "Inactive"}
        </Text>
      </View>

      <Button
        label={farmer.is_active ? "Deactivate farmer" : "Reactivate farmer"}
        variant="secondary"
        loading={toggleActive.isPending}
        onPress={() => toggleActive.mutate()}
      />

      <Text style={styles.section}>Assigned sheds</Text>
      <Text style={styles.hint}>Only these sheds appear for this farmer.</Text>
      <View style={[styles.card, shadow.card]}>
        {(sheds.data ?? []).map((s) => {
          const on = shedIds.includes(s.id);
          return (
            <Pressable
              key={s.id}
              style={[styles.row, on && styles.rowOn]}
              onPress={() =>
                setShedIds((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))
              }
            >
              <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
              <Text style={styles.rowTitle}>
                {s.name} ({s.code})
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Button
        label={shedsDirty ? "Save shed assignments" : "Sheds up to date"}
        disabled={!shedsDirty}
        loading={saveSheds.isPending}
        onPress={() => saveSheds.mutate()}
      />

      <Text style={styles.section}>Permissions</Text>
      <Text style={styles.hint}>Add or remove access anytime. Farmer app only shows granted options.</Text>
      <View style={[styles.card, shadow.card]}>
        {FARMER_PERM_OPTIONS.map((code) => {
          const on = perms.includes(code);
          const label = PERMISSION_LABELS[code];
          return (
            <Pressable
              key={code}
              style={[styles.row, on && styles.rowOn]}
              onPress={() =>
                setPerms((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]))
              }
            >
              <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{label?.title ?? code}</Text>
                <Text style={styles.rowHint}>{label?.hint ?? code}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Button
        label={permsDirty ? "Save permissions" : "Permissions up to date"}
        disabled={!permsDirty}
        loading={savePerms.isPending}
        onPress={() => savePerms.mutate()}
      />

      {msg ? <Text style={styles.ok}>{msg}</Text> : null}
      {err ? <Text style={styles.error}>{err}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.brand, padding: space.md, paddingBottom: 4 },
  meta: { color: colors.inkMuted, fontSize: 14, paddingHorizontal: space.md, paddingBottom: space.sm },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.inkMuted,
    textTransform: "uppercase",
    marginTop: space.sm,
  },
  hint: { color: colors.inkMuted, fontSize: 13, marginTop: -space.sm },
  row: {
    flexDirection: "row",
    gap: space.md,
    alignItems: "center",
    padding: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowOn: { backgroundColor: "#F3FBF6" },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkMark: { color: "#fff", fontWeight: "800", fontSize: 13 },
  rowTitle: { fontWeight: "700", color: colors.ink, fontSize: 15 },
  rowHint: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  ok: { color: colors.success, fontWeight: "700" },
  error: { color: colors.danger },
});
