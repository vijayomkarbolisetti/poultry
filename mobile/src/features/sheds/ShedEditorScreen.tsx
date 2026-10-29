/**
 * Shared Create / Edit Shed UI (Screen 5 reference).
 * Catalogue selection updates the farm default assignment (A2′); scheduling stays on the backend.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  assignCatalogue,
  getCatalogue,
  getCatalogueAssignment,
  listCatalogues,
  type CatalogueSummary,
} from "../../api/catalogues";
import { describeApiError } from "../../api/client";
import { listFarmers, type Farmer } from "../../api/farmers";
import { createShed, getShedOverview, updateShed } from "../../api/sheds";
import { BrandLogo } from "../../components/brand/BrandLogo";
import { AddFarmerModal } from "../../components/sheds/AddFarmerModal";
import { AppDialog } from "../../components/ui/AppDialog";
import { HenLoader } from "../../components/ui/HenLoader";
import { useAuth } from "../auth/AuthContext";
import { hasPermission } from "../auth/permissions";
import {
  catalogueAgeRangeLabel,
  catalogueListMetaLine,
} from "../catalogues/catalogueListHelpers";
import {
  markTransferDraftPreferDest,
  peekTransferDraft,
} from "../birds/transferDraftStore";
import { firstRouteParam } from "../../navigation/routeParams";
import { safeBack } from "../../navigation/safeBack";
import { vaccineUi as ui } from "../../theme/vaccineUi";
import { toast } from "../../ui/toast/toastStore";
import {
  createShedPayload,
  mergeCreatedFarmerIntoList,
  resolveFarmerSelectionAfterRefresh,
  shouldAssignCatalogue,
  suggestShedCode,
  updateShedPayload,
  validateCreateShedDraft,
} from "./createShedForm";

type Mode = "create" | "edit";

type Props = {
  mode: Mode;
  shedId?: string;
};

export function ShedEditorScreen({ mode, shedId }: Props) {
  const params = useLocalSearchParams<{
    returnTo?: string | string[];
    sourceShedId?: string | string[];
  }>();
  const returnTo = firstRouteParam(params.returnTo);
  const sourceShedId = firstRouteParam(params.sourceShedId);
  const resumeTransfer = mode === "create" && returnTo === "transfer" && !!sourceShedId;

  const { user, ownerAccountId } = useAuth();
  const qc = useQueryClient();
  const canCreate = hasPermission(user, ownerAccountId, "shed.create");
  const canUpdate = hasPermission(user, ownerAccountId, "shed.update");
  const canViewCatalogue = hasPermission(user, ownerAccountId, "schedule.view");
  const canAssignCatalogue = hasPermission(user, ownerAccountId, "schedule.manage");
  const canManageFarmers = hasPermission(user, ownerAccountId, "farmer.manage");
  const permitted = mode === "create" ? canCreate : canUpdate;

  const [name, setName] = useState("");
  const [capacityText, setCapacityText] = useState("");
  const [notes, setNotes] = useState("");
  /** Active org from auth context — farm picker removed; shed stays on current farm. */
  const farmId = ownerAccountId;
  const [catalogueId, setCatalogueId] = useState<string | null>(null);
  const [existingCode, setExistingCode] = useState<string | null>(null);
  const [ownerManaged, setOwnerManaged] = useState(true);
  const [farmerId, setFarmerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(mode === "create");
  const [cataloguePickerOpen, setCataloguePickerOpen] = useState(false);
  const [farmerPickerOpen, setFarmerPickerOpen] = useState(false);
  const [addFarmerOpen, setAddFarmerOpen] = useState(false);
  const [ownerManagedConfirmOpen, setOwnerManagedConfirmOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const catalogueSelectGen = useRef(0);

  const hasActiveFarm = Boolean(ownerAccountId);

  const overview = useQuery({
    queryKey: ["shed-overview", shedId],
    queryFn: () => getShedOverview(shedId!),
    enabled: mode === "edit" && !!shedId && permitted,
  });

  const catalogues = useQuery({
    queryKey: ["catalogues", ownerAccountId],
    queryFn: () => listCatalogues(),
    enabled: Boolean(ownerAccountId) && canViewCatalogue && permitted,
  });

  const assignment = useQuery({
    queryKey: ["catalogue-assignment", ownerAccountId],
    queryFn: () => getCatalogueAssignment(),
    enabled: Boolean(ownerAccountId) && canViewCatalogue && permitted,
  });

  const farmers = useQuery({
    queryKey: ["farmers", ownerAccountId],
    queryFn: listFarmers,
    enabled: Boolean(ownerAccountId) && permitted && !ownerManaged,
  });

  const farmerOptions = useMemo(
    () =>
      (farmers.data ?? [])
        .filter((f) => f.is_active && f.role === "farmer")
        .map((f) => ({
          value: f.membership_id,
          label: f.full_name,
          meta: f.email,
        })),
    [farmers.data],
  );

  useEffect(() => {
    if (ownerManaged) {
      setFarmerId(null);
      return;
    }
    // Do not reconcile until edit hydration finishes (create is always hydrated).
    if (mode === "edit" && !hydrated) return;
    // Keep hydrated/selected membership while the list is loading or failed.
    if (farmers.isLoading || farmers.isFetching || farmers.isError) return;
    const next = resolveFarmerSelectionAfterRefresh(farmerId, farmerOptions, {
      isRefreshing: false,
    });
    if (next !== farmerId) setFarmerId(next);
  }, [
    ownerManaged,
    farmerId,
    farmerOptions,
    farmers.isLoading,
    farmers.isFetching,
    farmers.isError,
    mode,
    hydrated,
  ]);

  const list = catalogues.data ?? [];
  const detailQueries = useQueries({
    queries: list.map((c) => ({
      queryKey: ["catalogue", c.id],
      queryFn: () => getCatalogue(c.id),
      enabled: Boolean(ownerAccountId) && canViewCatalogue && list.length > 0,
      staleTime: 60_000,
    })),
  });

  const ageById = useMemo(() => {
    const map = new Map<string, string | null>();
    detailQueries.forEach((q, i) => {
      const id = list[i]?.id;
      if (!id) return;
      if (q.data) map.set(id, catalogueAgeRangeLabel(q.data.items));
    });
    return map;
  }, [detailQueries, list]);

  // Reset hydration when editing a different shed.
  useEffect(() => {
    if (mode === "edit") setHydrated(false);
  }, [mode, shedId]);

  useEffect(() => {
    if (mode !== "edit" || !overview.data || hydrated) return;
    const { shed } = overview.data;
    setName(shed.name);
    setNotes(shed.location_notes ?? "");
    setCapacityText(
      shed.capacity != null && Number.isFinite(shed.capacity) ? String(shed.capacity) : "",
    );
    setExistingCode(shed.code);
    setOwnerManaged(shed.is_owner_managed);
    if (shed.is_owner_managed) {
      setFarmerId(null);
    } else {
      const managers = overview.data.assignments.filter((a) => a.is_manager && a.is_active);
      const pick = managers[0] ?? overview.data.assignments.find((a) => a.is_active) ?? null;
      setFarmerId(pick?.owner_membership_id ?? null);
    }
    setHydrated(true);
  }, [mode, overview.data, hydrated]);

  const activeManagers = useMemo(
    () =>
      mode === "edit" && overview.data
        ? overview.data.assignments.filter((a) => a.is_manager && a.is_active)
        : [],
    [mode, overview.data],
  );
  const managerAmbiguityNote =
    !ownerManaged && activeManagers.length > 1
      ? `Multiple active managers (${activeManagers.length}). Saving with a selected farmer demotes the others to non-manager (backend rule).`
      : null;

  // Preselect farm default catalogue once assignment/list are ready.
  useEffect(() => {
    if (!canViewCatalogue) return;
    if (assignment.isLoading || catalogues.isLoading) return;
    if (catalogueId) return;
    if (assignment.data?.catalogue_id) {
      setCatalogueId(assignment.data.catalogue_id);
      return;
    }
    if (list.length === 1) setCatalogueId(list[0].id);
  }, [
    canViewCatalogue,
    assignment.isLoading,
    catalogues.isLoading,
    assignment.data?.catalogue_id,
    catalogueId,
    list,
  ]);

  const selectedCatalogue: CatalogueSummary | null =
    list.find((c) => c.id === catalogueId) ??
    (assignment.data && assignment.data.catalogue_id === catalogueId
      ? {
          id: assignment.data.catalogue_id,
          code: assignment.data.catalogue_code,
          name: assignment.data.catalogue_name,
          description: null,
          version: 1,
          status: "active",
          is_example: false,
          owner_account_id: ownerAccountId,
          cloned_from_catalogue_id: null,
          is_platform: false,
          item_count: 0,
        }
      : null);

  const selectedMeta = selectedCatalogue
    ? catalogueListMetaLine(selectedCatalogue.item_count, ageById.get(selectedCatalogue.id) ?? null)
    : null;

  const onSelectCatalogue = (id: string) => {
    const gen = ++catalogueSelectGen.current;
    setCataloguePickerOpen(false);
    // Ignore stale async if any future load races; selection is sync here.
    if (gen !== catalogueSelectGen.current) return;
    setCatalogueId(id);
    setFieldErrors((e) => {
      const { catalogue: _, ...rest } = e;
      return rest;
    });
  };

  const applyOwnerManaged = () => {
    setOwnerManaged(true);
    setFarmerId(null);
    setFieldErrors((e) => {
      const { farmer: _, ...rest } = e;
      return rest;
    });
  };

  const applyManagementMode = (nextOwnerManaged: boolean) => {
    if (nextOwnerManaged === ownerManaged) return;
    if (nextOwnerManaged && mode === "edit") {
      setOwnerManagedConfirmOpen(true);
      return;
    }
    setOwnerManaged(nextOwnerManaged);
    if (nextOwnerManaged) {
      setFarmerId(null);
      setFieldErrors((e) => {
        const { farmer: _, ...rest } = e;
        return rest;
      });
    }
  };

  const onSelectFarmer = (membershipId: string) => {
    setFarmerPickerOpen(false);
    setFarmerId(membershipId);
    setFieldErrors((e) => {
      const { farmer: _, ...rest } = e;
      return rest;
    });
  };

  const onFarmerCreated = (farmer: Farmer) => {
    setAddFarmerOpen(false);
    setFarmerPickerOpen(false);
    qc.setQueryData<Farmer[]>(["farmers", ownerAccountId], (prev) =>
      mergeCreatedFarmerIntoList(prev ?? [], farmer),
    );
    setOwnerManaged(false);
    setFarmerId(farmer.membership_id);
    setFieldErrors((e) => {
      const { farmer: _, ...rest } = e;
      return rest;
    });
    void farmers.refetch();
  };

  const invalidateAfterSave = async (id: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["sheds", ownerAccountId] }),
      qc.invalidateQueries({ queryKey: ["shed-overview", id] }),
      qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] }),
      qc.invalidateQueries({ queryKey: ["catalogue-assignment", ownerAccountId] }),
      qc.invalidateQueries({ queryKey: ["vaccination"] }),
    ]);
  };

  const onSave = async () => {
    if (submitting.current || loading || !permitted) return;
    if (mode === "edit" && !hydrated) return;

    const draft = {
      name,
      code: mode === "edit" ? (existingCode ?? suggestShedCode(name)) : suggestShedCode(name, existingCode),
      location_notes: notes,
      capacityText,
      catalogueId,
      farmOwnerAccountId: farmId,
      is_owner_managed: ownerManaged,
      initial_farmer_membership_id: ownerManaged ? null : farmerId,
      cataloguesLoading: catalogues.isLoading || assignment.isLoading,
      farmsAvailable: hasActiveFarm,
      cataloguesAvailable: list.length > 0 || Boolean(assignment.data?.catalogue_id),
    };

    const validationError = validateCreateShedDraft(draft);
    if (validationError) {
      const next: Record<string, string> = {};
      const lower = validationError.toLowerCase();
      if (lower.includes("shed name")) next.name = validationError;
      else if (lower.includes("farm")) next.farm = validationError;
      else if (lower.includes("catalogue")) next.catalogue = validationError;
      else if (lower.includes("capacity")) next.capacity = validationError;
      else if (lower.includes("farmer")) next.farmer = validationError;
      setFieldErrors(next);
      setError(validationError);
      return;
    }

    submitting.current = true;
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      let id = shedId;
      if (mode === "create") {
        const shed = await createShed(createShedPayload(draft));
        id = shed.id;
      } else {
        await updateShed(shedId!, updateShedPayload(draft));
        id = shedId!;
      }

      if (
        canAssignCatalogue &&
        shouldAssignCatalogue(catalogueId, assignment.data?.catalogue_id)
      ) {
        await assignCatalogue({
          catalogue_id: catalogueId!,
          apply_scope: "all_active",
          confirm_change: true,
        });
      }

      await invalidateAfterSave(id!);
      toast.success(mode === "create" ? "Shed created" : "Shed updated");

      if (resumeTransfer && sourceShedId && id) {
        // Keep transfer draft; prefer the newly created shed as destination.
        if (peekTransferDraft()) markTransferDraftPreferDest(id);
        router.replace({
          pathname: "/(app)/sheds/[id]/birds",
          params: { id: sourceShedId, resumeTransfer: "1" },
        });
        return;
      }

      router.replace({ pathname: "/(app)/sheds/[id]/birds", params: { id: id! } });
    } catch (e: unknown) {
      setError(describeApiError(e, mode === "create" ? "create the shed" : "save the shed"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  const onBack = () => {
    if (resumeTransfer && sourceShedId) {
      // Draft remains so the source shed screen can reopen Transfer unchanged.
      router.replace({
        pathname: "/(app)/sheds/[id]/birds",
        params: { id: sourceShedId, resumeTransfer: "1" },
      });
      return;
    }
    safeBack();
  };

  if (!permitted) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back" style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={ui.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>{mode === "create" ? "Create Shed" : "Edit Shed"}</Text>
          <View style={styles.savePlaceholder} />
        </View>
        <Text style={styles.pageError}>
          You do not have permission to {mode === "create" ? "create" : "edit"} sheds.
        </Text>
      </SafeAreaView>
    );
  }

  if (mode === "edit" && (overview.isLoading || !hydrated)) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <HenLoader label="Loading shed…" />
      </SafeAreaView>
    );
  }

  if (mode === "edit" && (overview.isError || !overview.data)) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
        <View style={styles.header}>
          <Pressable onPress={() => safeBack()} hitSlop={12} accessibilityLabel="Back" style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={ui.ink} />
          </Pressable>
          <Text style={styles.headerTitle}>Edit Shed</Text>
          <View style={styles.savePlaceholder} />
        </View>
        <Text style={styles.pageError}>{describeApiError(overview.error, "load the shed")}</Text>
        <Pressable style={styles.retryBtn} onPress={() => void overview.refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const title = mode === "create" ? "Create Shed" : "Edit Shed";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          accessibilityLabel="Back"
          style={styles.backBtn}
          disabled={loading}
        >
          <Ionicons name="arrow-back" size={22} color={ui.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable
          style={[styles.saveBtn, loading && styles.saveBtnDisabled]}
          onPress={() => void onSave()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Save shed"
        >
          {loading ? (
            <ActivityIndicator color={ui.white} size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FieldLabel text="Shed Name" required />
          <TextInput
            style={[styles.input, fieldErrors.name ? styles.inputError : null]}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setFieldErrors((e) => {
                const { name: _, ...rest } = e;
                return rest;
              });
            }}
            placeholder="P1 Shed A"
            placeholderTextColor={ui.mutedSoft}
            editable={!loading}
            autoCapitalize="words"
            accessibilityLabel="Shed name"
          />
          {fieldErrors.name ? <Text style={styles.fieldError}>{fieldErrors.name}</Text> : null}
          {fieldErrors.farm ? <Text style={styles.fieldError}>{fieldErrors.farm}</Text> : null}

          <FieldLabel text="Management" required />
          <View style={styles.segmentRow} accessibilityRole="radiogroup">
            <Pressable
              style={[styles.segmentBtn, ownerManaged && styles.segmentBtnOn]}
              onPress={() => applyManagementMode(true)}
              disabled={loading}
              accessibilityRole="radio"
              accessibilityState={{ selected: ownerManaged }}
              accessibilityLabel="Owner Managed"
            >
              <Text style={[styles.segmentText, ownerManaged && styles.segmentTextOn]}>
                Owner Managed
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentBtn, !ownerManaged && styles.segmentBtnOn]}
              onPress={() => applyManagementMode(false)}
              disabled={loading}
              accessibilityRole="radio"
              accessibilityState={{ selected: !ownerManaged }}
              accessibilityLabel="Farmer Managed"
            >
              <Text style={[styles.segmentText, !ownerManaged && styles.segmentTextOn]}>
                Farmer Managed
              </Text>
            </Pressable>
          </View>

          {!ownerManaged ? (
            <>
              <FieldLabel text="Farmer" required />
              {farmers.isLoading && !farmers.data ? (
                <View style={styles.catalogueLoading}>
                  <ActivityIndicator color={ui.brand} />
                  <Text style={styles.catalogueLoadingText}>Loading farmers…</Text>
                </View>
              ) : farmers.isError ? (
                <View style={styles.catalogueErrorBox}>
                  <Text style={styles.fieldError}>
                    {describeApiError(farmers.error, "load farmers")}
                  </Text>
                  <Pressable onPress={() => void farmers.refetch()}>
                    <Text style={styles.retryLink}>Retry</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[styles.selectRow, fieldErrors.farmer ? styles.inputError : null]}
                  onPress={() => setFarmerPickerOpen(true)}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="Select farmer"
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.selectValue,
                        !farmerOptions.find((f) => f.value === farmerId) && styles.placeholder,
                      ]}
                      numberOfLines={1}
                    >
                      {farmerOptions.find((f) => f.value === farmerId)?.label ??
                        (farmerOptions.length
                          ? "Select a farmer"
                          : "No farmers yet — add one")}
                    </Text>
                    {farmerOptions.find((f) => f.value === farmerId)?.meta ? (
                      <Text style={styles.selectMeta} numberOfLines={1}>
                        {farmerOptions.find((f) => f.value === farmerId)!.meta}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-down" size={18} color={ui.muted} />
                </Pressable>
              )}
              {fieldErrors.farmer ? (
                <Text style={styles.fieldError}>{fieldErrors.farmer}</Text>
              ) : null}
              {managerAmbiguityNote ? (
                <Text style={styles.hint}>{managerAmbiguityNote}</Text>
              ) : null}
              {canManageFarmers ? (
                <Pressable
                  style={styles.addFarmerLink}
                  onPress={() => setAddFarmerOpen(true)}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="Add farmer"
                >
                  <Ionicons name="add-circle-outline" size={18} color={ui.brand} />
                  <Text style={styles.addFarmerLinkText}>Add Farmer</Text>
                </Pressable>
              ) : (
                <Text style={styles.hint}>
                  You need farmer.manage permission to create a new farmer account.
                </Text>
              )}
            </>
          ) : null}

          <FieldLabel text="Select Vaccination Catalogue" required />
          {catalogues.isLoading && !catalogues.data ? (
            <View style={styles.catalogueLoading}>
              <ActivityIndicator color={ui.brand} />
              <Text style={styles.catalogueLoadingText}>Loading catalogues…</Text>
            </View>
          ) : catalogues.isError ? (
            <View style={styles.catalogueErrorBox}>
              <Text style={styles.fieldError}>{describeApiError(catalogues.error, "load catalogues")}</Text>
              <Pressable onPress={() => void catalogues.refetch()}>
                <Text style={styles.retryLink}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.catalogueSelect, fieldErrors.catalogue ? styles.inputError : null]}
              onPress={() => {
                if (list.length > 0) setCataloguePickerOpen(true);
              }}
              disabled={loading || list.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Select vaccination catalogue"
            >
              <View style={styles.catalogueIcon}>
                <BrandLogo size={28} accessibilityLabel="PoultryTrack" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.catalogueTitle} numberOfLines={2}>
                  {selectedCatalogue?.name ?? (list.length ? "Select a catalogue" : "No catalogues available")}
                </Text>
                {selectedMeta ? (
                  <Text style={styles.catalogueMeta} numberOfLines={1}>
                    {selectedMeta}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-down" size={18} color={ui.muted} />
            </Pressable>
          )}
          {fieldErrors.catalogue ? <Text style={styles.fieldError}>{fieldErrors.catalogue}</Text> : null}
          {!canAssignCatalogue && selectedCatalogue ? (
            <Text style={styles.hint}>
              Catalogue is shown for reference. You need permission to change the farm default.
            </Text>
          ) : null}

          <FieldLabel text="Capacity (Birds)" />
          <TextInput
            style={[styles.input, fieldErrors.capacity ? styles.inputError : null]}
            value={capacityText}
            onChangeText={(v) => {
              setCapacityText(v.replace(/[^\d]/g, ""));
              setFieldErrors((e) => {
                const { capacity: _, ...rest } = e;
                return rest;
              });
            }}
            placeholder="50"
            placeholderTextColor={ui.mutedSoft}
            keyboardType="number-pad"
            editable={!loading}
            accessibilityLabel="Capacity birds"
          />
          {fieldErrors.capacity ? <Text style={styles.fieldError}>{fieldErrors.capacity}</Text> : null}

          <FieldLabel text="Notes" />
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional"
            placeholderTextColor={ui.mutedSoft}
            multiline
            textAlignVertical="top"
            editable={!loading}
            accessibilityLabel="Notes"
          />

          <View style={styles.infoBanner}>
            <Ionicons name="information-circle" size={18} color={ui.infoText} />
            <Text style={styles.infoText}>
              The selected catalogue will be used to automatically calculate vaccination due dates
              based on the birds' hatch date.
            </Text>
          </View>

          {error ? <Text style={styles.pageError}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <PickerModal
        visible={cataloguePickerOpen}
        title="Select catalogue"
        onClose={() => setCataloguePickerOpen(false)}
        options={list.map((c) => ({
          id: c.id,
          title: c.name,
          meta: catalogueListMetaLine(c.item_count, ageById.get(c.id) ?? null),
          selected: c.id === catalogueId,
        }))}
        onSelect={onSelectCatalogue}
      />

      <PickerModal
        visible={farmerPickerOpen}
        title="Select farmer"
        onClose={() => setFarmerPickerOpen(false)}
        options={farmerOptions.map((f) => ({
          id: f.value,
          title: f.label,
          meta: f.meta,
          selected: f.value === farmerId,
        }))}
        emptyLabel="No active farmers in this farm. Use + Add Farmer to create one."
        footerAction={
          canManageFarmers
            ? {
                label: "+ Add Farmer",
                onPress: () => {
                  setFarmerPickerOpen(false);
                  setAddFarmerOpen(true);
                },
              }
            : undefined
        }
        onSelect={onSelectFarmer}
      />

      <AddFarmerModal
        visible={addFarmerOpen}
        onClose={() => setAddFarmerOpen(false)}
        onCreated={onFarmerCreated}
      />

      <AppDialog
        visible={ownerManagedConfirmOpen}
        title="Switch to Owner Managed?"
        description="Saving will revoke active farmer assignments for this shed. Farm ownership and bird/vaccination history are unchanged."
        tone="warning"
        onDismiss={() => setOwnerManagedConfirmOpen(false)}
        secondary={{
          label: "Cancel",
          variant: "secondary",
          onPress: () => setOwnerManagedConfirmOpen(false),
        }}
        primary={{
          label: "Continue",
          variant: "primary",
          onPress: () => {
            setOwnerManagedConfirmOpen(false);
            applyOwnerManaged();
          },
        }}
      />
    </SafeAreaView>
  );
}

function FieldLabel({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.label}>
      {text}
      {required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

function PickerModal({
  visible,
  title,
  options,
  onClose,
  onSelect,
  emptyLabel,
  footerAction,
}: {
  visible: boolean;
  title: string;
  options: { id: string; title: string; meta?: string; selected?: boolean }[];
  onClose: () => void;
  onSelect: (id: string) => void;
  emptyLabel?: string;
  footerAction?: { label: string; onPress: () => void };
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {options.length === 0 && emptyLabel ? (
              <Text style={styles.modalEmpty}>{emptyLabel}</Text>
            ) : null}
            {options.map((opt) => (
              <Pressable
                key={opt.id}
                style={[styles.modalRow, opt.selected && styles.modalRowOn]}
                onPress={() => onSelect(opt.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalRowTitle} numberOfLines={2}>
                    {opt.title}
                  </Text>
                  {opt.meta ? (
                    <Text style={styles.modalRowMeta} numberOfLines={1}>
                      {opt.meta}
                    </Text>
                  ) : null}
                </View>
                {opt.selected ? <Ionicons name="checkmark-circle" size={22} color={ui.brand} /> : null}
              </Pressable>
            ))}
          </ScrollView>
          {footerAction ? (
            <Pressable style={styles.modalFooterAction} onPress={footerAction.onPress}>
              <Text style={styles.modalFooterActionText}>{footerAction.label}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.modalCancel} onPress={onClose}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: ui.bg,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: ui.ink,
  },
  saveBtn: {
    backgroundColor: ui.brand,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: ui.white, fontWeight: "700", fontSize: 14 },
  savePlaceholder: { width: 64 },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  label: { fontSize: 14, fontWeight: "700", color: ui.ink, marginTop: 10 },
  required: { color: "#C62828", fontWeight: "700" },
  input: {
    backgroundColor: ui.white,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: ui.ink,
  },
  notesInput: { minHeight: 96, paddingTop: 12 },
  inputError: { borderColor: "#E53935" },
  selectRow: {
    backgroundColor: ui.white,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectValue: { flex: 1, fontSize: 15, color: ui.ink, fontWeight: "600" },
  selectMeta: { fontSize: 12, color: ui.muted, marginTop: 2, fontWeight: "600" },
  placeholder: { color: ui.mutedSoft, fontWeight: "500" },
  segmentRow: {
    flexDirection: "row",
    backgroundColor: ui.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnOn: { backgroundColor: ui.brandSoftStrong },
  segmentText: { fontSize: 13, fontWeight: "700", color: ui.muted, textAlign: "center" },
  segmentTextOn: { color: ui.brand },
  addFarmerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  addFarmerLinkText: { color: ui.brand, fontWeight: "700", fontSize: 14 },
  catalogueSelect: {
    backgroundColor: ui.white,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  catalogueIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: ui.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  catalogueTitle: { fontSize: 15, fontWeight: "700", color: ui.ink },
  catalogueMeta: { fontSize: 12, color: ui.muted, marginTop: 2, fontWeight: "600" },
  catalogueLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: ui.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ui.cardBorder,
  },
  catalogueLoadingText: { color: ui.muted, fontWeight: "600" },
  catalogueErrorBox: { gap: 6 },
  retryLink: { color: ui.brand, fontWeight: "700" },
  hint: { fontSize: 12, color: ui.muted, fontWeight: "600", lineHeight: 16 },
  infoBanner: {
    marginTop: 16,
    backgroundColor: ui.infoBg,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18, color: ui.infoText, fontWeight: "600" },
  fieldError: { color: "#C62828", fontSize: 12, fontWeight: "600" },
  pageError: { color: "#C62828", marginHorizontal: 20, marginTop: 12, fontWeight: "600" },
  retryBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: ui.brand,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  retryText: { color: ui.white, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: ui.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
    gap: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: ui.ink, marginBottom: 4 },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  modalRowOn: { backgroundColor: ui.highlightRow },
  modalRowTitle: { fontSize: 15, fontWeight: "700", color: ui.ink },
  modalRowMeta: { fontSize: 12, color: ui.muted, marginTop: 2, fontWeight: "600" },
  modalEmpty: {
    fontSize: 13,
    color: ui.muted,
    fontWeight: "600",
    lineHeight: 18,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  modalFooterAction: {
    alignItems: "center",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: ui.cardBorder,
  },
  modalFooterActionText: { color: ui.brand, fontWeight: "800", fontSize: 15 },
  modalCancel: { alignItems: "center", paddingVertical: 12 },
  modalCancelText: { color: ui.muted, fontWeight: "700" },
});
