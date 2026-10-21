import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ComponentProps, useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { listFarmers } from "../../../../src/api/farmers";
import { describeApiError } from "../../../../src/api/client";
import {
  assignFarmer,
  deactivateShed,
  getShedDependencies,
  getShedOverview,
  reactivateShed,
} from "../../../../src/api/sheds";
import { AddBirdsSheet } from "../../../../src/components/birds/AddBirdsSheet";
import { Button } from "../../../../src/components/ui/Button";
import { DataQualityBanner } from "../../../../src/components/ui/DataQualityBanner";
import { HenLoader } from "../../../../src/components/ui/HenLoader";
import { Screen } from "../../../../src/components/ui/Screen";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { useAuth } from "../../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../../src/features/auth/permissions";
import { firstRouteParam } from "../../../../src/navigation/routeParams";
import { safeBack } from "../../../../src/navigation/safeBack";
import { birdUi } from "../../../../src/theme/birdManagementUi";
import { space } from "../../../../src/theme/tokens";

type IonName = ComponentProps<typeof Ionicons>["name"];

function Metric({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: tone }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function NavRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IonName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: birdUi.paleMint }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.navIcon}>
        <Ionicons name={icon} size={20} color={birdUi.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.navTitle}>{title}</Text>
        <Text style={styles.navSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
    </Pressable>
  );
}

export default function ShedDetailScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = firstRouteParam(params.id);
  const { ownerAccountId, user } = useAuth();
  const qc = useQueryClient();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const canUpdate = hasPermission(user, ownerAccountId, "shed.update");
  const canCreateBatch = hasPermission(user, ownerAccountId, "flock.create");
  const canViewBirds = hasPermission(user, ownerAccountId, "bird.view");
  const canCreateBird = hasPermission(user, ownerAccountId, "bird.create");
  const canLifecycle = hasPermission(user, ownerAccountId, "lifecycle.record");

  const overview = useQuery({
    queryKey: ["shed-overview", id],
    queryFn: () => getShedOverview(id!),
    enabled: !!id,
    staleTime: 0,
  });
  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: canManage,
  });
  const [selectedFarmer, setSelectedFarmer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [addBirdsOpen, setAddBirdsOpen] = useState(false);

  const invalidateAll = () => {
    if (!id) return;
    void qc.invalidateQueries({ queryKey: ["shed-overview", id] });
    void qc.invalidateQueries({ queryKey: ["shed-birds", id] });
    void qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
    void qc.invalidateQueries({ queryKey: ["flocks"] });
  };

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      void qc.invalidateQueries({ queryKey: ["shed-overview", id] });
    }, [id, qc]),
  );

  const assignedIds = useMemo(
    () => new Set((overview.data?.assignments ?? []).map((a) => a.owner_membership_id)),
    [overview.data?.assignments],
  );
  const farmerOptions = useMemo(
    () =>
      (farmers.data ?? [])
        .filter((f) => f.is_active && f.role === "farmer" && !assignedIds.has(f.membership_id))
        .map((f) => ({ value: f.membership_id, label: f.full_name, hint: f.email })),
    [farmers.data, assignedIds],
  );

  const onAssign = async () => {
    if (!selectedFarmer) {
      setError("Select a farmer to assign");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await assignFarmer(id!, { owner_membership_id: selectedFarmer, is_manager: true });
      setSelectedFarmer(null);
      invalidateAll();
    } catch (e: unknown) {
      setError(describeApiError(e, "assign the farmer"));
    } finally {
      setBusy(false);
    }
  };

  const onDeactivate = async () => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const deps = await getShedDependencies(id);
      Alert.alert(
        "Deactivate this shed?",
        `${deps.note}\n\n${deps.active_batch_count} active groups, ${deps.total_live_birds} live birds.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Deactivate",
            style: "destructive",
            onPress: async () => {
              setBusy(true);
              try {
                await deactivateShed(id);
                invalidateAll();
              } catch (e: unknown) {
                setError(describeApiError(e, "deactivate the shed"));
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    } catch (e: unknown) {
      setError(describeApiError(e, "load shed dependencies"));
    } finally {
      setBusy(false);
    }
  };

  const onReactivate = () => {
    if (!id || busy) return;
    Alert.alert("Reactivate this shed?", "New groups and birds can be added again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reactivate",
        onPress: async () => {
          setBusy(true);
          try {
            await reactivateShed(id);
            invalidateAll();
          } catch (e: unknown) {
            setError(describeApiError(e, "reactivate the shed"));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if ((!id || overview.isLoading || overview.isPending) && !overview.data) {
    return (
      <Screen>
        <HenLoader label="Loading shed…" />
      </Screen>
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <Screen>
        <Text style={styles.error}>
          {overview.error ? describeApiError(overview.error, "load this shed") : "Shed not found"}
        </Text>
        <Button label="Retry" onPress={() => overview.refetch()} />
        <Button label="Back" variant="secondary" onPress={() => router.replace("/(app)/sheds")} />
      </Screen>
    );
  }

  const { shed, organization_name, assignments, population, batches } = overview.data;
  const managedLabel = shed.is_owner_managed ? "Owner-managed" : "Farmer-managed";
  const farmerNames = assignments.map((a) => a.farmer_name ?? a.farmer_email ?? "Farmer").join(", ");
  const showAdd = (canCreateBatch || canCreateBird) && shed.is_active;
  const mismatch = batches.some((b) => b.count_mismatch);

  return (
    <Screen scroll edges={["left", "right", "bottom"]}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => safeBack("/(app)/sheds")}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={birdUi.text} />
        </Pressable>
        {canUpdate ? (
          <Pressable
            onPress={() => setShowManage((v) => !v)}
            style={styles.detailsBtn}
            accessibilityLabel="Shed management"
          >
            <Ionicons name="settings-outline" size={18} color={birdUi.primary} />
            <Text style={styles.detailsBtnText}>{showManage ? "Close" : "Manage"}</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.name}>{shed.name}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.code}>{shed.code}</Text>
        <View style={[styles.pill, shed.is_active ? styles.pillOn : styles.pillOff]}>
          <Text style={[styles.pillText, { color: shed.is_active ? birdUi.successText : birdUi.error }]}>
            {shed.is_active ? "Active" : "Inactive"}
          </Text>
        </View>
      </View>
      {organization_name ? <Text style={styles.org}>{organization_name}</Text> : null}
      <Text style={styles.managed}>
        {managedLabel}
        {farmerNames ? ` · ${farmerNames}` : " · No farmer assigned"}
      </Text>

      {!shed.is_active ? (
        <Text style={styles.warnBanner}>
          Inactive — history stays available. Reactivate before adding birds.
        </Text>
      ) : null}

      <View style={styles.metricsCard}>
        <Metric value={population.total_live_birds} label="Live birds" tone={birdUi.primary} />
        <Metric value={population.banded_birds} label="Banded" tone={birdUi.orange} />
        <Metric value={population.unbanded_birds} label="Unbanded" tone={birdUi.blue} />
      </View>

      {mismatch ? (
        <DataQualityBanner message="Some bird counts look inconsistent. Review Birds or contact support." />
      ) : null}

      {showAdd ? (
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.92 }]}
          onPress={() => setAddBirdsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Add birds"
        >
          <Ionicons name="add" size={22} color="#fff" />
          <Text style={styles.addBtnText}>Add birds</Text>
        </Pressable>
      ) : null}

      <View style={styles.navCard}>
        {canViewBirds ? (
          <NavRow
            icon="egg-outline"
            title="Birds"
            subtitle={`${population.banded_birds} banded · ${population.unbanded_birds} unbanded`}
            onPress={() => router.push(`/(app)/sheds/${id}/birds`)}
          />
        ) : null}
        {canViewBirds && canLifecycle ? <View style={styles.divider} /> : null}
        {canLifecycle && shed.is_active ? (
          <NavRow
            icon="swap-horizontal-outline"
            title="Mortality & transfer"
            subtitle="Record losses or move birds to another shed"
            onPress={() => router.push({ pathname: "/(app)/sheds/[id]/birds", params: { id: id!, focus: "actions" } })}
          />
        ) : null}
      </View>

      {showManage ? (
        <View style={styles.manageCard}>
          <View style={styles.actionRow}>
            <View style={{ flex: 1 }}>
              <Button
                label="Edit shed"
                variant="secondary"
                onPress={() => router.push(`/(app)/sheds/edit/${id}`)}
              />
            </View>
            <View style={{ flex: 1 }}>
              {shed.is_active ? (
                <Button label="Deactivate" variant="secondary" onPress={onDeactivate} loading={busy} />
              ) : (
                <Button label="Reactivate" onPress={onReactivate} loading={busy} />
              )}
            </View>
          </View>
          {shed.location_notes ? <Text style={styles.notes}>{shed.location_notes}</Text> : null}
          <Text style={styles.eyebrow}>Assigned farmers</Text>
          {(assignments ?? []).length === 0 ? <Text style={styles.muted}>None yet</Text> : null}
          {(assignments ?? []).map((a) => (
            <Text key={a.id} style={styles.assignLine}>
              {a.farmer_name ?? "Farmer"} · {a.farmer_email}
              {a.is_manager ? " · manager" : ""}
            </Text>
          ))}
          {canManage ? (
            <>
              <SelectField
                label="Assign farmer"
                searchable
                value={selectedFarmer}
                options={farmerOptions}
                onChange={setSelectedFarmer}
                loading={farmers.isLoading}
                emptyMessage="No farmers available"
                clearable
              />
              <Button
                label="Assign as manager"
                onPress={onAssign}
                loading={busy}
                disabled={!selectedFarmer}
              />
            </>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}

      <AddBirdsSheet
        visible={addBirdsOpen}
        shedName={shed.name}
        shedActive={shed.is_active}
        canCreateGroup={canCreateBatch}
        canTagBirds={canCreateBird}
        onClose={() => setAddBirdsOpen(false)}
        onAddUnbanded={() => {
          setAddBirdsOpen(false);
          router.push({ pathname: "/(app)/birds/add-unbanded", params: { shedId: id! } });
        }}
        onRegisterBanded={() => {
          setAddBirdsOpen(false);
          router.push({ pathname: "/(app)/birds/add", params: { shedId: id! } });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.paleMint,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: birdUi.paleMint,
  },
  detailsBtnText: { fontSize: 13, fontWeight: "700", color: birdUi.primary },
  name: { fontSize: 26, fontWeight: "800", color: birdUi.text, letterSpacing: -0.4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: -4 },
  code: { fontSize: 14, fontWeight: "700", color: birdUi.primary },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillOn: { backgroundColor: birdUi.successBg },
  pillOff: { backgroundColor: birdUi.errorPale },
  pillText: { fontSize: 12, fontWeight: "700" },
  org: { fontSize: 14, fontWeight: "600", color: birdUi.text },
  managed: { fontSize: 13, color: birdUi.muted, marginTop: -6 },
  warnBanner: {
    backgroundColor: birdUi.orangePale,
    color: birdUi.orange,
    fontWeight: "600",
    fontSize: 13,
    padding: 10,
    borderRadius: 12,
  },
  metricsCard: {
    flexDirection: "row",
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingVertical: 14,
  },
  metric: { flex: 1, alignItems: "center", gap: 2 },
  metricValue: { fontSize: 20, fontWeight: "800" },
  metricLabel: { fontSize: 11, fontWeight: "600", color: birdUi.muted, textAlign: "center" },
  addBtn: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: birdUi.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  navCard: {
    backgroundColor: birdUi.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: birdUi.border,
    overflow: "hidden",
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.iconCircle,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { fontSize: 15, fontWeight: "700", color: birdUi.text },
  navSub: { fontSize: 12, color: birdUi.muted, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: birdUi.divider, marginLeft: 66 },
  manageCard: {
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 8,
  },
  actionRow: { flexDirection: "row", gap: space.sm },
  notes: { fontSize: 14, color: birdUi.text },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    color: birdUi.muted,
    textTransform: "uppercase",
    marginTop: 4,
  },
  muted: { color: birdUi.muted, fontSize: 14 },
  assignLine: { fontSize: 14, color: birdUi.text, fontWeight: "600" },
  error: { color: birdUi.error, fontWeight: "600" },
});
