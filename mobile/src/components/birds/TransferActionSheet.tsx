import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeApiError } from "../../api/client";
import { listFlocks, transferToShedByCohort, type Flock } from "../../api/flocks";
import { listSheds } from "../../api/sheds";
import { useAuth } from "../../features/auth/AuthContext";
import { hasPermission } from "../../features/auth/permissions";
import { newLifecycleIdempotencyKey } from "../../features/birds/birdSelectionHelpers";
import {
  saveTransferDraft,
  type TransferBandedPayload,
  type TransferSheetResume,
  type TransferUnbandedPayload,
} from "../../features/birds/transferDraftStore";
import {
  cohortAgePayload,
  resolveBandedSelectionCohort,
  validateUnbandedTransferQuantity,
} from "../../features/birds/transferHelpers";
import { birdUi } from "../../theme/birdManagementUi";
import { toast } from "../../ui/toast/toastStore";
import { Button } from "../ui/Button";
import { AppDatePicker } from "../ui/AppDatePicker";
import { todayIsoDate } from "../ui/selectUtils";

export type { TransferBandedPayload, TransferUnbandedPayload };

type Props = {
  visible: boolean;
  payload: TransferBandedPayload | TransferUnbandedPayload | null;
  onClose: () => void;
  onSuccess: () => void;
  /** Restored fields after Create Shed (or cancel-back). Applied once when sheet opens. */
  resume?: TransferSheetResume | null;
  onResumeConsumed?: () => void;
};

type DestOption = {
  value: string;
  label: string;
  hint: string;
  searchText: string;
};

const MAX_VISIBLE_RESULTS = 60;

/**
 * Transfer bottom sheet.
 * Destination shed is picked with an embedded searchable list inside this same Modal —
 * nested Modals (SelectField) do not open reliably on Android.
 */
export function TransferActionSheet({
  visible,
  payload,
  onClose,
  onSuccess,
  resume = null,
  onResumeConsumed,
}: Props) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, ownerAccountId } = useAuth();
  const canCreateShed = hasPermission(user, ownerAccountId, "shed.create");

  const [destShedId, setDestShedId] = useState<string | null>(null);
  const [shedPickerOpen, setShedPickerOpen] = useState(false);
  const [shedQuery, setShedQuery] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [effectiveDate, setEffectiveDate] = useState(() => todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const lock = useRef(false);
  const idem = useRef(newLifecycleIdempotencyKey("xfer-sheet"));
  const resumeApplied = useRef(false);

  const shedId = payload?.shedId;

  const sheds = useQuery({
    queryKey: ["sheds", "transfer-sheet"],
    queryFn: () => listSheds(),
    enabled: visible && !!shedId,
  });
  const sourceFlocks = useQuery({
    queryKey: ["flocks", shedId, "transfer-sheet"],
    queryFn: () => listFlocks(shedId),
    enabled: visible && !!shedId && payload?.mode === "banded",
  });

  useEffect(() => {
    if (!visible || !payload) {
      resumeApplied.current = false;
      return;
    }
    if (resume && !resumeApplied.current) {
      resumeApplied.current = true;
      setDestShedId(resume.destShedId);
      setQuantity(resume.quantity || "1");
      setEffectiveDate(resume.effectiveDate || todayIsoDate());
      setShedPickerOpen(false);
      setShedQuery("");
      setBusy(false);
      setMsg(null);
      lock.current = false;
      idem.current = newLifecycleIdempotencyKey("xfer-sheet");
      onResumeConsumed?.();
      return;
    }
    if (resumeApplied.current) return;
    setDestShedId(null);
    setShedPickerOpen(false);
    setShedQuery("");
    setQuantity("1");
    setEffectiveDate(todayIsoDate());
    setBusy(false);
    setMsg(null);
    lock.current = false;
    idem.current = newLifecycleIdempotencyKey("xfer-sheet");
  }, [visible, payload, resume, onResumeConsumed]);

  const destOptions: DestOption[] = useMemo(
    () =>
      (sheds.data ?? [])
        .filter((s) => s.is_active && s.id !== shedId)
        .map((s) => {
          const farm = s.organization_name?.trim() ?? "";
          const hintParts = [s.code, farm].filter(Boolean);
          return {
            value: s.id,
            label: s.name,
            hint: hintParts.join(" · ") || "Active shed",
            searchText: `${s.name} ${s.code} ${farm}`.toLowerCase(),
          };
        }),
    [sheds.data, shedId],
  );

  const filteredOptions = useMemo(() => {
    const q = shedQuery.trim().toLowerCase();
    if (!q) return destOptions;
    return destOptions.filter((o) => o.searchText.includes(q));
  }, [destOptions, shedQuery]);

  const visibleOptions = filteredOptions.slice(0, MAX_VISIBLE_RESULTS);
  const hiddenCount = Math.max(0, filteredOptions.length - visibleOptions.length);

  const selectedDest = destOptions.find((o) => o.value === destShedId) ?? null;

  const flocksById = useMemo(() => {
    const map = new Map<string, Flock>();
    for (const f of sourceFlocks.data ?? []) map.set(f.id, f);
    return map;
  }, [sourceFlocks.data]);

  const requestClose = () => {
    if (busy) return;
    if (shedPickerOpen) {
      setShedPickerOpen(false);
      setShedQuery("");
      return;
    }
    onClose();
  };

  const openAddShed = () => {
    if (!payload || busy || !canCreateShed) return;
    saveTransferDraft({
      payload,
      destShedId,
      quantity,
      effectiveDate,
    });
    onClose();
    router.push({
      pathname: "/(app)/sheds/create",
      params: {
        returnTo: "transfer",
        sourceShedId: payload.shedId,
      },
    });
  };

  const onConfirm = async () => {
    if (!payload || lock.current) return;
    if (!destShedId) {
      setMsg("Select a destination shed");
      return;
    }
    if (destShedId === payload.shedId) {
      setMsg("Destination must be a different shed");
      return;
    }
    if (!effectiveDate) {
      setMsg("Effective date is required");
      return;
    }

    lock.current = true;
    setBusy(true);
    setMsg(null);
    let succeeded = false;
    try {
      if (payload.mode === "banded") {
        const resolved = resolveBandedSelectionCohort(payload.birds, payload.birdIds, flocksById);
        if (!resolved.ok) {
          setMsg(resolved.error);
          return;
        }
        const ageFields = cohortAgePayload(resolved.key);
        if (!ageFields) {
          setMsg("Selected birds have no hatch date, so transfer cannot continue safely.");
          return;
        }
        await transferToShedByCohort({
          destination_shed_id: destShedId,
          effective_date: effectiveDate,
          bird_ids: resolved.birdIds,
          idempotency_key: idem.current,
          ...ageFields,
        });
      } else {
        if (payload.key.kind === "unknown") {
          setMsg("This unbanded population has no hatch date, so transfer is unavailable.");
          return;
        }
        const qty = Number(quantity);
        const qtyErr = validateUnbandedTransferQuantity(qty, payload.unbandedCount);
        if (qtyErr) {
          setMsg(qtyErr);
          return;
        }
        const ageFields = cohortAgePayload(payload.key);
        if (!ageFields) {
          setMsg("This unbanded population has no hatch date, so transfer is unavailable.");
          return;
        }
        await transferToShedByCohort({
          destination_shed_id: destShedId,
          source_shed_id: payload.shedId,
          quantity: qty,
          effective_date: effectiveDate,
          idempotency_key: idem.current,
          ...ageFields,
        });
      }

      succeeded = true;
      const countLabel =
        payload.mode === "banded"
          ? `${payload.birdIds.length} bird${payload.birdIds.length === 1 ? "" : "s"}`
          : `${Number(quantity)} unbanded`;
      const destName = selectedDest?.label ?? "destination shed";
      void qc.invalidateQueries({ queryKey: ["shed-birds", destShedId] });
      void qc.invalidateQueries({ queryKey: ["shed-birds-summary", destShedId] });
      void qc.invalidateQueries({ queryKey: ["shed-overview", destShedId] });
      void qc.invalidateQueries({ queryKey: ["sheds"] });
      toast.success(`Transferred ${countLabel} to ${destName}`);
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setMsg(describeApiError(e, "transfer birds"));
    } finally {
      setBusy(false);
      if (!succeeded) lock.current = false;
    }
  };

  if (!payload) return null;

  const canConfirm = Boolean(destShedId && effectiveDate) && !busy;

  const addShedButton =
    canCreateShed && !busy ? (
      <Pressable
        onPress={openAddShed}
        style={({ pressed }) => [styles.addShedBtn, pressed && { opacity: 0.92 }]}
        accessibilityRole="button"
        accessibilityLabel="Add shed"
      >
        <Ionicons name="add" size={18} color={birdUi.primary} />
        <Text style={styles.addShedText}>Add Shed</Text>
      </Pressable>
    ) : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <Pressable style={styles.scrim} onPress={requestClose} accessibilityLabel="Close transfer">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <View style={[styles.iconCircle, { backgroundColor: birdUi.bluePale }]}>
              <Ionicons name="swap-horizontal" size={20} color={birdUi.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {shedPickerOpen ? "Destination shed" : "Transfer"}
              </Text>
              <Text style={styles.sub}>
                {shedPickerOpen
                  ? "Search and choose where these birds will go"
                  : payload.mode === "banded"
                    ? `${payload.birdIds.length} banded bird${payload.birdIds.length === 1 ? "" : "s"}`
                    : payload.label}
              </Text>
            </View>
            <Pressable
              onPress={requestClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityLabel={shedPickerOpen ? "Back to transfer" : "Close"}
            >
              <Ionicons name={shedPickerOpen ? "arrow-back" : "close"} size={22} color={birdUi.muted} />
            </Pressable>
          </View>

          {shedPickerOpen ? (
            <View style={styles.pickerBody}>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color={birdUi.muted} />
                <TextInput
                  style={styles.searchInput}
                  value={shedQuery}
                  onChangeText={setShedQuery}
                  placeholder="Search sheds…"
                  placeholderTextColor={birdUi.muted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  accessibilityLabel="Search destination sheds"
                />
                {shedQuery ? (
                  <Pressable onPress={() => setShedQuery("")} hitSlop={10} accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={18} color={birdUi.muted} />
                  </Pressable>
                ) : null}
              </View>

              {addShedButton}

              {sheds.isLoading ? (
                <View style={styles.pickerState}>
                  <ActivityIndicator color={birdUi.primary} />
                  <Text style={styles.pickerStateText}>Loading sheds…</Text>
                </View>
              ) : sheds.isError ? (
                <View style={styles.pickerState}>
                  <Text style={styles.error}>
                    {describeApiError(sheds.error, "load destination sheds")}
                  </Text>
                  <Button label="Retry" variant="secondary" onPress={() => void sheds.refetch()} />
                </View>
              ) : destOptions.length === 0 ? (
                <View style={styles.pickerState}>
                  <Text style={styles.pickerStateText}>
                    No other active sheds available for transfer.
                  </Text>
                  {canCreateShed ? (
                    <Text style={styles.pickerStateText}>Create one with Add Shed.</Text>
                  ) : null}
                </View>
              ) : filteredOptions.length === 0 ? (
                <View style={styles.pickerState}>
                  <Text style={styles.pickerStateText}>No sheds match “{shedQuery.trim()}”.</Text>
                  {canCreateShed ? (
                    <Text style={styles.pickerStateText}>Try a different search or add a new shed.</Text>
                  ) : null}
                </View>
              ) : (
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  style={styles.pickerScroll}
                  nestedScrollEnabled
                >
                  {visibleOptions.map((opt) => {
                    const on = opt.value === destShedId;
                    return (
                      <Pressable
                        key={opt.value}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${opt.label}, ${opt.hint}${on ? ", selected" : ""}`}
                        onPress={() => {
                          setDestShedId(opt.value);
                          setMsg(null);
                          setShedPickerOpen(false);
                          setShedQuery("");
                        }}
                        style={[styles.option, on && styles.optionOn]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>
                            {opt.label}
                          </Text>
                          <Text style={styles.optionHint}>{opt.hint}</Text>
                        </View>
                        {on ? (
                          <Ionicons name="checkmark-circle" size={20} color={birdUi.primary} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {hiddenCount > 0 ? (
                    <Text style={styles.truncateHint}>
                      Showing {MAX_VISIBLE_RESULTS} of {filteredOptions.length}. Refine your search.
                    </Text>
                  ) : null}
                </ScrollView>
              )}
            </View>
          ) : (
            <>
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 420 }}>
                {payload.mode === "banded" ? (
                  <View style={styles.listCard}>
                    {(payload.labels.length ? payload.labels : payload.birdIds)
                      .slice(0, 20)
                      .map((label, i) => (
                        <Text key={`${label}-${i}`} style={styles.band}>
                          {label}
                        </Text>
                      ))}
                    {payload.birdIds.length > 20 ? (
                      <Text style={styles.hint}>…and {payload.birdIds.length - 20} more</Text>
                    ) : null}
                    <Text style={styles.hint}>
                      Birds must share the same hatch date. They stay active in the destination shed.
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.label}>Quantity (max {payload.unbandedCount})</Text>
                    <TextInput
                      style={styles.input}
                      value={quantity}
                      onChangeText={setQuantity}
                      keyboardType="number-pad"
                      accessibilityLabel="Transfer quantity"
                    />
                  </>
                )}

                <Text style={styles.label}>
                  Destination shed <Text style={styles.required}>*</Text>
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    selectedDest
                      ? `Destination shed, selected ${selectedDest.label}`
                      : "Destination shed, no selection"
                  }
                  accessibilityState={{ expanded: false, disabled: busy }}
                  disabled={busy}
                  onPress={() => {
                    setShedQuery("");
                    setShedPickerOpen(true);
                  }}
                  style={({ pressed }) => [
                    styles.destField,
                    msg && !destShedId ? styles.destFieldError : null,
                    pressed && !busy ? { opacity: 0.92 } : null,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.destValue, !selectedDest && styles.destPlaceholder]}
                      numberOfLines={1}
                    >
                      {selectedDest?.label ?? "Select destination shed"}
                    </Text>
                    {selectedDest ? (
                      <Text style={styles.destHint} numberOfLines={1}>
                        {selectedDest.hint}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-down" size={18} color={birdUi.muted} />
                </Pressable>
                {addShedButton}
                {sheds.isError && !destShedId ? (
                  <Pressable onPress={() => void sheds.refetch()} hitSlop={8}>
                    <Text style={styles.retryInline}>Could not load sheds — tap to retry</Text>
                  </Pressable>
                ) : null}

                <AppDatePicker
                  label="Effective date"
                  required
                  value={effectiveDate}
                  maximumDate={todayIsoDate()}
                  onChange={(v) => setEffectiveDate(v ?? todayIsoDate())}
                  disabled={busy}
                />

                {msg ? <Text style={styles.error}>{msg}</Text> : null}
              </ScrollView>

              <View style={styles.actions}>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel" variant="secondary" onPress={requestClose} disabled={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Confirm transfer"
                    onPress={() => void onConfirm()}
                    loading={busy}
                    disabled={!canConfirm}
                  />
                </View>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(2, 44, 34, 0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: birdUi.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: birdUi.horizontal,
    paddingTop: 10,
    gap: 10,
    maxHeight: "92%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: birdUi.divider,
    marginBottom: 6,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "800", color: birdUi.text },
  sub: { fontSize: 13, color: birdUi.muted, marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: birdUi.paleMint,
  },
  listCard: {
    backgroundColor: birdUi.bluePale,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    marginBottom: 8,
  },
  band: { fontSize: 14, fontWeight: "700", color: birdUi.text },
  label: { fontSize: 13, fontWeight: "700", color: birdUi.muted, marginBottom: 6, marginTop: 4 },
  required: { color: birdUi.error },
  input: {
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    padding: 12,
    fontSize: 16,
    fontWeight: "600",
    backgroundColor: birdUi.white,
    color: birdUi.text,
    marginBottom: 10,
  },
  destField: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.white,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  destFieldError: { borderColor: birdUi.error },
  destValue: { fontSize: 16, fontWeight: "600", color: birdUi.text },
  destPlaceholder: { color: birdUi.muted, fontWeight: "500" },
  destHint: { fontSize: 12, color: birdUi.muted, marginTop: 2 },
  addShedBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: birdUi.primary,
    backgroundColor: birdUi.paleMint,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  addShedText: { fontSize: 15, fontWeight: "800", color: birdUi.primary },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 48,
    backgroundColor: birdUi.bg,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: birdUi.text, paddingVertical: 10 },
  retryInline: {
    color: birdUi.primary,
    fontWeight: "700",
    fontSize: 13,
    marginBottom: 8,
  },
  hint: { fontSize: 12, color: birdUi.muted, lineHeight: 17, marginTop: 4 },
  truncateHint: {
    fontSize: 12,
    color: birdUi.muted,
    textAlign: "center",
    paddingVertical: 10,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  error: { color: birdUi.error, fontWeight: "600", marginTop: 4 },
  pickerBody: { minHeight: 220, maxHeight: 460, gap: 4 },
  pickerScroll: { maxHeight: 320 },
  pickerState: {
    paddingVertical: 24,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 12,
  },
  pickerStateText: {
    fontSize: 14,
    color: birdUi.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 12,
    minHeight: 52,
  },
  optionOn: { backgroundColor: birdUi.paleMint },
  optionLabel: { fontSize: 15, fontWeight: "700", color: birdUi.text },
  optionLabelOn: { color: birdUi.primary },
  optionHint: { fontSize: 12, color: birdUi.muted, marginTop: 2 },
});
