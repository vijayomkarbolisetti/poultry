import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { getBirdProfile } from "../../../src/api/birds";
import { describeApiError } from "../../../src/api/client";
import { recordLifecycle } from "../../../src/api/flocks";
import { Button } from "../../../src/components/ui/Button";
import { DataQualityBanner } from "../../../src/components/ui/DataQualityBanner";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { Screen } from "../../../src/components/ui/Screen";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { formatLifecycleLabel } from "../../../src/features/birds/birdListHelpers";
import { newLifecycleIdempotencyKey } from "../../../src/features/birds/birdSelectionHelpers";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";

export default function BirdProfileScreen() {
  const { id, fromShedId } = useLocalSearchParams<{ id: string; fromShedId?: string }>();
  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canView = hasPermission(user, ownerAccountId, "bird.view");
  const canUpdate = hasPermission(user, ownerAccountId, "bird.update");
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");
  const [lifeBusy, setLifeBusy] = useState(false);
  const [lifeMsg, setLifeMsg] = useState<string | null>(null);
  const lifeLock = useRef(false);
  const lifeIdemKey = useRef<string | null>(null);

  const profile = useQuery({
    queryKey: ["bird-profile", id],
    queryFn: () => getBirdProfile(id!),
    enabled: !!id && canView,
  });

  useFocusEffect(
    useCallback(() => {
      if (!id || !canView) return;
      void profile.refetch();
    }, [id, canView]),
  );

  const backTarget = fromShedId ? `/(app)/sheds/${fromShedId}/birds` : "/(app)/search";

  const invalidateRelated = (shedId?: string, flockId?: string) => {
    void qc.invalidateQueries({ queryKey: ["bird-profile", id] });
    void qc.invalidateQueries({ queryKey: ["shed-birds"] });
    void qc.invalidateQueries({ queryKey: ["shed-overview", shedId] });
    void qc.invalidateQueries({ queryKey: ["birds", flockId] });
    void qc.invalidateQueries({ queryKey: ["flock", flockId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
  };

  const onMortality = () => {
    if (!id || !profile.data || lifeLock.current || !profile.data.is_active) return;
    const band = profile.data.band_id ?? profile.data.display_code ?? id.slice(0, 8);
    Alert.alert(
      "Record mortality?",
      `Bird ${band}\n\nThis marks the bird as dead and removes it from the live population. History is preserved.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Record mortality",
          style: "destructive",
          onPress: async () => {
            if (lifeLock.current) return;
            lifeLock.current = true;
            setLifeBusy(true);
            setLifeMsg(null);
            if (!lifeIdemKey.current) {
              lifeIdemKey.current = newLifecycleIdempotencyKey(`mortality-${id}`);
            }
            try {
              await recordLifecycle({
                event_type: "mortality",
                effective_date: todayIsoDate(),
                bird_id: id,
                quantity: 1,
                reason: "Recorded from bird profile (mortality)",
                idempotency_key: lifeIdemKey.current,
              });
              invalidateRelated(profile.data.shed_id, profile.data.flock_id);
              setLifeMsg("Mortality recorded.");
              lifeIdemKey.current = null;
              await profile.refetch();
            } catch (e: unknown) {
              setLifeMsg(describeApiError(e, "record mortality"));
            } finally {
              setLifeBusy(false);
              lifeLock.current = false;
            }
          },
        },
      ],
    );
  };

  if (!canView) {
    return (
      <Screen>
        <Text style={styles.error}>You do not have permission to view bird profiles.</Text>
        <Button label="Back" variant="secondary" onPress={() => safeBack(backTarget)} />
      </Screen>
    );
  }

  if (profile.isLoading) {
    return (
      <Screen>
        <HenLoader label="Loading bird…" />
      </Screen>
    );
  }

  if (profile.isError || !profile.data) {
    return (
      <Screen>
        <Text style={styles.error}>{describeApiError(profile.error, "load bird profile")}</Text>
        <Button label="Retry" onPress={() => profile.refetch()} />
      </Screen>
    );
  }

  const p = profile.data;
  const title = p.band_id ?? p.display_code ?? p.id.slice(0, 8);
  const ageLabel =
    p.hatch_date != null
      ? `Hatch ${p.hatch_date}`
      : p.estimated_age_days != null
        ? `~ ${p.estimated_age_days} days`
        : p.dob_confidence === "unknown"
          ? "Unknown"
          : p.dob_confidence;
  const addedOn = p.created_at ? new Date(p.created_at).toLocaleDateString() : "—";
  const parentLabel = (ref: { band_id: string | null; display_code: string | null; id: string } | null) =>
    ref ? ref.band_id ?? ref.display_code ?? ref.id.slice(0, 8) : "—";

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <Pressable onPress={() => safeBack(backTarget)} style={styles.backBtn} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={22} color={birdUi.text} />
      </Pressable>

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="egg-outline" size={28} color={birdUi.primary} />
        </View>
        <Text style={styles.band}>{title}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{formatLifecycleLabel(p.lifecycle_status)}</Text>
        </View>
      </View>

      {!p.is_active ? (
        <DataQualityBanner message={`This bird is not active (${formatLifecycleLabel(p.lifecycle_status)}).`} />
      ) : null}

      <View style={styles.card}>
        <Row label="Shed" value={`${p.shed_name ?? "—"} (${p.shed_code ?? "—"})`} />
        <Row label="Hatch / age" value={ageLabel} />
        <Row label="Breed" value={p.breed?.trim() || "—"} />
        <Row label="Sex" value={p.sex?.trim() || "—"} />
        <Row label="Added on" value={addedOn} />
        <Row label="Notes" value={p.notes?.trim() || "—"} last />
      </View>

      <Text style={styles.section}>Parents</Text>
      <View style={styles.card}>
        <Row label="Sire" value={parentLabel(p.sire)} />
        <Row label="Dam" value={parentLabel(p.dam)} last />
      </View>

      {p.is_active ? (
        <View style={styles.actionsCard}>
          {canUpdate ? (
            <ActionRow
              icon="pricetag-outline"
              color={birdUi.primary}
              label="Change band number"
              onPress={() =>
                router.push({
                  pathname: "/(app)/birds/edit/[id]",
                  params: { id: p.id, fromShedId: fromShedId ?? p.shed_id },
                })
              }
            />
          ) : null}
          {canLifecycle ? (
            <ActionRow
              icon="heart-dislike-outline"
              color={birdUi.error}
              label="Record mortality"
              onPress={onMortality}
              disabled={lifeBusy}
            />
          ) : null}
          {canLifecycle ? (
            <ActionRow
              icon="swap-horizontal-outline"
              color={birdUi.blue}
              label="Transfer to another shed"
              onPress={() =>
                router.push({
                  pathname: "/(app)/birds/transfer",
                  params: { shedId: p.shed_id, birdIds: p.id },
                })
              }
              last
            />
          ) : null}
        </View>
      ) : null}

      {(p.lifecycle_events ?? []).length > 0 ? (
        <>
          <Text style={styles.section}>Lifecycle history</Text>
          {(p.lifecycle_events ?? []).map((ev) => (
            <View key={ev.id} style={styles.lifeCard}>
              <Text style={styles.lifeTitle}>{formatLifecycleLabel(ev.event_type)}</Text>
              <Text style={styles.meta}>
                {ev.effective_date}
                {ev.reason ? ` · ${ev.reason}` : ""}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {lifeMsg ? <Text style={styles.meta}>{lifeMsg}</Text> : null}
    </Screen>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  icon,
  color,
  label,
  onPress,
  disabled,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.actionRow, !last && styles.rowBorder, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
    >
      <View style={[styles.actionIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  hero: { alignItems: "center", gap: 8, marginBottom: 16 },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
  },
  band: { fontSize: 24, fontWeight: "800", color: birdUi.text },
  statusBadge: {
    backgroundColor: birdUi.successBg,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: { fontSize: 13, fontWeight: "700", color: birdUi.successText },
  card: {
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  actionsCard: {
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  section: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: "800",
    color: birdUi.muted,
    textTransform: "uppercase",
  },
  lifeCard: {
    backgroundColor: birdUi.white,
    borderRadius: birdUi.cardRadius,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 12,
    gap: 4,
    marginBottom: 8,
  },
  lifeTitle: { fontWeight: "800", color: birdUi.text },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: birdUi.border },
  rowLabel: { color: birdUi.muted, fontSize: 14 },
  rowValue: { color: birdUi.text, fontSize: 14, fontWeight: "700", flex: 1, textAlign: "right" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    minHeight: 56,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: birdUi.text },
  meta: { color: birdUi.muted, marginTop: 8, fontSize: 13 },
  error: { color: birdUi.error, fontWeight: "600" },
});
