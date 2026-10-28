import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getCatalogue, updateCatalogue } from "../../../src/api/catalogues";
import { describeApiError } from "../../../src/api/client";
import { HenLoader } from "../../../src/components/ui/HenLoader";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  itemsAfterAdd,
  itemsAfterEdit,
  type VaccineDraft,
} from "../../../src/features/catalogues/catalogueItemEditHelpers";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { safeBack } from "../../../src/navigation/safeBack";

const ROUTE_OPTIONS = ["Oral", "Injection", "Wing web", "Eye drop", "Spray", "Other"] as const;

function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  keyboardType,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMulti]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? "Leave blank if unknown"}
        placeholderTextColor="#9AABA4"
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

export default function CatalogueItemEditScreen() {
  const { catalogueId, itemId } = useLocalSearchParams<{ catalogueId: string; itemId?: string }>();
  const { user, ownerAccountId } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "schedule.manage");
  const qc = useQueryClient();
  const submitting = useRef(false);

  const isAdd = !itemId || itemId === "new";

  const query = useQuery({
    queryKey: ["catalogue", catalogueId],
    queryFn: () => getCatalogue(catalogueId!),
    enabled: Boolean(catalogueId) && canManage,
  });

  const item = useMemo(
    () => (isAdd ? undefined : query.data?.items.find((i) => i.id === itemId)),
    [isAdd, query.data, itemId],
  );

  const [name, setName] = useState("");
  const [disease, setDisease] = useState("");
  const [ageDays, setAgeDays] = useState("");
  const [dose, setDose] = useState("");
  const [route, setRoute] = useState("");
  const [diluent, setDiluent] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Expo Router may reuse this screen instance across add/edit navigations.
  useEffect(() => {
    setSaving(false);
    submitting.current = false;
  }, [catalogueId, itemId, isAdd]);

  useEffect(() => {
    if (isAdd) {
      setName("");
      setDisease("");
      setAgeDays("");
      setDose("");
      setRoute("");
      setDiluent("");
      setNotes("");
      return;
    }
    if (!item) return;
    setName(item.name ?? "");
    setDisease(item.disease_label ?? "");
    const firstAge = item.rules?.find((r) => r.target_age_days != null)?.target_age_days;
    setAgeDays(firstAge != null ? String(firstAge) : "");
    setDose(item.recommended_dose_text ?? "");
    setRoute(item.route ?? "");
    setDiluent(item.diluent_instructions ?? "");
    setNotes(item.instructions ?? "");
  }, [item, isAdd]);

  if (!canManage) return <Redirect href="/(app)/catalogues" />;
  if (!catalogueId) return <Redirect href="/(app)/catalogues" />;

  const cat = query.data;
  const platformLocked = Boolean(cat?.is_platform);

  const draft = (): VaccineDraft => ({
    name,
    disease,
    ageDays,
    dose,
    route,
    diluent,
    notes,
  });

  const goToCatalogue = () => {
    router.replace(`/(app)/catalogues/${catalogueId}`);
  };

  const onSave = async () => {
    if (!cat || submitting.current || saving) return;
    if (platformLocked) {
      Alert.alert("Read-only", "Platform catalogues cannot be edited. Clone to your farm first.");
      return;
    }
    if (!isAdd && !item) {
      Alert.alert("Not found", "Vaccine not found in this catalogue.");
      return;
    }

    const built = isAdd
      ? itemsAfterAdd(cat.items, draft())
      : itemsAfterEdit(cat.items, item!.id!, draft());
    if ("error" in built) {
      Alert.alert("Check form", built.error);
      return;
    }

    submitting.current = true;
    setSaving(true);
    try {
      await updateCatalogue(catalogueId, {
        items: built,
        apply_scope: "new_flocks",
        confirm_change: true,
      });
      await qc.invalidateQueries({ queryKey: ["catalogue", catalogueId] });
      await qc.invalidateQueries({ queryKey: ["catalogues", ownerAccountId] });
      setSaving(false);
      goToCatalogue();
      // Keep submitting=true until unmount so rapid re-entry cannot double-save.
    } catch (e) {
      Alert.alert("Could not save", describeApiError(e, isAdd ? "add vaccine" : "update vaccine"));
      submitting.current = false;
      setSaving(false);
    }
  };

  const routeKnown = ROUTE_OPTIONS.includes(route as (typeof ROUTE_OPTIONS)[number]);
  const formReady = Boolean(cat) && (isAdd || Boolean(item));

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable onPress={() => safeBack()} hitSlop={12} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={ui.brand} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {isAdd ? "Add Vaccine" : "Edit vaccine"}
        </Text>
        <Pressable
          style={[styles.saveBtn, (saving || !formReady || platformLocked) && { opacity: 0.55 }]}
          onPress={() => void onSave()}
          disabled={saving || !formReady || platformLocked}
          accessibilityLabel="Save vaccine"
          accessibilityState={{ disabled: saving || !formReady || platformLocked }}
        >
          <Text style={styles.saveBtnText}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>

      {query.isLoading && !cat ? (
        <View style={styles.center}>
          <HenLoader label="Loading…" />
        </View>
      ) : query.error ? (
        <View style={styles.centerPad}>
          <Text style={styles.muted}>{describeApiError(query.error, "load catalogue")}</Text>
        </View>
      ) : platformLocked ? (
        <View style={styles.centerPad}>
          <Text style={styles.muted}>
            Platform catalogues are read-only. Clone to your farm to add or edit vaccines.
          </Text>
        </View>
      ) : !isAdd && !item ? (
        <View style={styles.centerPad}>
          <Text style={styles.muted}>Vaccine not found in this catalogue.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.note}>
              Leave optional fields blank when product guidance is unknown. Blank values stay
              unspecified — nothing is invented.
            </Text>
            <View style={styles.card}>
              <Field label="Vaccine Name" value={name} onChange={setName} placeholder="Required" required />
              <Field label="Disease Targeted" value={disease} onChange={setDisease} />
              <Field
                label="Recommended Age (Days)"
                value={ageDays}
                onChange={setAgeDays}
                keyboardType="number-pad"
                placeholder="0 = hatch day"
              />
              <Field label="Dose / Concentration" value={dose} onChange={setDose} />

              <View style={styles.field}>
                <Text style={styles.label}>Route of Administration</Text>
                <View style={styles.routeRow}>
                  {ROUTE_OPTIONS.map((opt) => {
                    const on = route === opt || (opt === "Other" && route.length > 0 && !routeKnown);
                    return (
                      <Pressable
                        key={opt}
                        style={[styles.routeChip, on && styles.routeChipOn]}
                        onPress={() =>
                          setRoute(opt === "Other" ? (routeKnown || !route ? "" : route) : opt)
                        }
                      >
                        <Text style={[styles.routeText, on && styles.routeTextOn]}>{opt}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {(route === "" && !routeKnown) || (route.length > 0 && !routeKnown) ? (
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    value={routeKnown ? "" : route}
                    onChangeText={setRoute}
                    placeholder="Custom route (optional)"
                    placeholderTextColor="#9AABA4"
                  />
                ) : null}
              </View>

              <Field label="Diluent / Reconstitution" value={diluent} onChange={setDiluent} multiline />
              <Field label="Notes" value={notes} onChange={setNotes} multiline />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: ui.horizontal,
    paddingRight: 48,
    paddingTop: 4,
    paddingBottom: 4,
  },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: ui.ink },
  saveBtn: {
    backgroundColor: ui.brand,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveBtnText: { color: ui.white, fontWeight: "800", fontSize: 14 },
  content: {
    paddingLeft: ui.horizontal,
    paddingRight: Math.max(ui.horizontal, 52),
    paddingTop: 8,
    paddingBottom: 40,
    gap: 10,
  },
  note: { fontSize: 12, color: ui.muted, lineHeight: 17, fontWeight: "500" },
  card: {
    backgroundColor: ui.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    padding: 14,
    gap: 12,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "700", color: ui.ink },
  required: { color: "#DC2626" },
  input: {
    backgroundColor: "#F8FAF9",
    borderWidth: 1,
    borderColor: ui.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: ui.ink,
    fontWeight: "600",
  },
  inputMulti: { minHeight: 84, textAlignVertical: "top" },
  routeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  routeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F8FAF9",
  },
  routeChipOn: { backgroundColor: ui.brandSoft, borderColor: ui.brand },
  routeText: { fontSize: 13, fontWeight: "700", color: ui.ink },
  routeTextOn: { color: ui.brand },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { padding: 20 },
  muted: { color: ui.muted, fontWeight: "600", lineHeight: 20 },
});
