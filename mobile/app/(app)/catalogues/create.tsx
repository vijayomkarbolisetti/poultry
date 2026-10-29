import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useRef, useState } from "react";
import {
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

import { createCatalogue } from "../../../src/api/catalogues";
import { describeApiError } from "../../../src/api/client";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import {
  catalogueCreatePayload,
  suggestCatalogueCode,
  validateCatalogueCreateWithVaccine,
} from "../../../src/features/catalogues/catalogueCreateHelpers";
import { vaccineUi as ui } from "../../../src/theme/vaccineUi";
import { safeBack } from "../../../src/navigation/safeBack";
import { toast } from "../../../src/ui/toast/toastStore";

const ROUTE_OPTIONS = ["Oral", "Injection", "Wing web", "Eye drop", "Spray", "Other"] as const;

function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  keyboardType,
  required,
  editable = true,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "number-pad";
  required?: boolean;
  editable?: boolean;
  accessibilityLabel?: string;
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
        editable={editable}
        accessibilityLabel={accessibilityLabel ?? label}
      />
    </View>
  );
}

export default function CreateCatalogueScreen() {
  const { user, ownerAccountId } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "schedule.manage");
  const qc = useQueryClient();
  const submitting = useRef(false);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState("");

  const [vaxName, setVaxName] = useState("");
  const [disease, setDisease] = useState("");
  const [ageDays, setAgeDays] = useState("");
  const [dose, setDose] = useState("");
  const [route, setRoute] = useState("");
  const [diluent, setDiluent] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!canManage) return <Redirect href="/(app)/catalogues" />;

  const onChangeName = (value: string) => {
    setName(value);
    if (!codeTouched) setCode(suggestCatalogueCode(value));
  };

  const routeKnown = ROUTE_OPTIONS.includes(route as (typeof ROUTE_OPTIONS)[number]);

  const onSubmit = async () => {
    if (submitting.current || loading) return;
    const vaccine = {
      name: vaxName,
      disease,
      ageDays,
      dose,
      route,
      diluent,
      notes,
    };
    const validation = validateCatalogueCreateWithVaccine({ name, code, vaccine });
    if (validation) {
      setError(validation);
      return;
    }
    const payload = catalogueCreatePayload({ name, code, description, vaccine });
    if ("error" in payload) {
      setError(payload.error);
      return;
    }

    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      // Single POST: catalogue + first vaccine together (no empty orphan catalogue).
      const result = await createCatalogue(payload);
      qc.setQueryData(["catalogue", result.id], result);
      await qc.invalidateQueries({ queryKey: ["catalogues", ownerAccountId] });
      toast.success("Catalogue created");
      router.replace(`/(app)/catalogues/${result.id}`);
    } catch (e) {
      const msg = describeApiError(e, "create catalogue");
      setError(msg);
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => safeBack()}
          hitSlop={12}
          accessibilityLabel="Back"
          disabled={loading}
        >
          <Ionicons name="arrow-back" size={22} color={ui.brand} />
        </Pressable>
        <Text style={styles.headerTitle}>Create Catalogue</Text>
        <Pressable
          style={[styles.headerSave, loading && styles.saveBtnDisabled]}
          onPress={() => void onSubmit()}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Save catalogue"
        >
          <Text style={styles.headerSaveText}>{loading ? "…" : "Save"}</Text>
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
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Catalogue</Text>
            <Field
              label="Catalogue name"
              value={name}
              onChange={onChangeName}
              placeholder="e.g. Farm winter programme"
              required
              editable={!loading}
              accessibilityLabel="Catalogue name"
            />
            <Field
              label="Code"
              value={code}
              onChange={(v) => {
                setCodeTouched(true);
                setCode(suggestCatalogueCode(v));
              }}
              placeholder="MY_FARM_PROGRAMME"
              required
              editable={!loading}
              accessibilityLabel="Catalogue code"
            />
            <Text style={styles.meta}>Letters, numbers, and underscores. Unique on this farm.</Text>
            <Field
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Optional notes for your team"
              multiline
              editable={!loading}
              accessibilityLabel="Catalogue description"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>First vaccine</Text>
            <Text style={styles.sectionHint}>
              Saved with the catalogue in one step. Leave optional fields blank when unknown.
            </Text>
            <Field
              label="Vaccine Name"
              value={vaxName}
              onChange={setVaxName}
              placeholder="Required"
              required
              editable={!loading}
              accessibilityLabel="Vaccine name"
            />
            <Field
              label="Disease Targeted"
              value={disease}
              onChange={setDisease}
              editable={!loading}
              accessibilityLabel="Disease targeted"
            />
            <Field
              label="Recommended Age (Days)"
              value={ageDays}
              onChange={setAgeDays}
              keyboardType="number-pad"
              placeholder="0 = hatch day"
              editable={!loading}
              accessibilityLabel="Recommended age days"
            />
            <Field
              label="Dose / Concentration"
              value={dose}
              onChange={setDose}
              editable={!loading}
              accessibilityLabel="Dose concentration"
            />

            <View style={styles.field}>
              <Text style={styles.label}>Route of Administration</Text>
              <View style={styles.routeRow}>
                {ROUTE_OPTIONS.map((opt) => {
                  const on = route === opt || (opt === "Other" && route.length > 0 && !routeKnown);
                  return (
                    <Pressable
                      key={opt}
                      style={[styles.routeChip, on && styles.routeChipOn]}
                      disabled={loading}
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
                  editable={!loading}
                  accessibilityLabel="Custom route"
                />
              ) : null}
            </View>

            <Field
              label="Diluent / Reconstitution"
              value={diluent}
              onChange={setDiluent}
              multiline
              editable={!loading}
              accessibilityLabel="Diluent"
            />
            <Field
              label="Notes"
              value={notes}
              onChange={setNotes}
              multiline
              editable={!loading}
              accessibilityLabel="Notes"
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.saveBtn, loading && styles.saveBtnDisabled]}
            onPress={() => void onSubmit()}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Save catalogue"
          >
            <Text style={styles.saveBtnText}>{loading ? "Creating…" : "Create catalogue"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: ui.ink },
  headerSave: {
    backgroundColor: ui.brand,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerSaveText: { color: ui.white, fontWeight: "800", fontSize: 14 },
  content: {
    paddingLeft: ui.horizontal,
    paddingRight: Math.max(ui.horizontal, 52),
    paddingTop: 10,
    paddingBottom: 40,
    gap: 12,
  },
  card: {
    backgroundColor: ui.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: ui.cardBorder,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: ui.ink, marginBottom: 2 },
  sectionHint: { fontSize: 12, color: ui.muted, lineHeight: 17, fontWeight: "500", marginBottom: 4 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: "700", color: ui.muted },
  required: { color: "#DC2626" },
  input: {
    backgroundColor: "#F8FAF9",
    borderWidth: 1,
    borderColor: ui.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: "600",
    color: ui.ink,
  },
  inputMulti: { minHeight: 72, textAlignVertical: "top" },
  meta: { fontSize: 11, color: ui.mutedSoft, fontWeight: "500", marginTop: -2, marginBottom: 2 },
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
  error: { color: "#B91C1C", fontWeight: "600", fontSize: 13 },
  saveBtn: {
    backgroundColor: ui.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { color: ui.white, fontWeight: "800", fontSize: 15 },
});
