import Ionicons from "@expo/vector-icons/Ionicons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { getCatalogueAssignment, listCatalogues } from "../../../src/api/catalogues";
import { createFlock } from "../../../src/api/flocks";
import { describeApiError } from "../../../src/api/client";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { AppDatePicker } from "../../../src/components/ui/AppDatePicker";
import { RadioChips } from "../../../src/components/ui/RadioChips";
import { Screen } from "../../../src/components/ui/Screen";
import { SelectField } from "../../../src/components/ui/SelectField";
import { todayIsoDate } from "../../../src/components/ui/selectUtils";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { hasPermission } from "../../../src/features/auth/permissions";
import { colors } from "../../../src/theme/tokens";
import { vaccineUi } from "../../../src/theme/vaccineUi";
import { toast } from "../../../src/ui/toast/toastStore";

const schema = z
  .object({
    batch_code: z.string().min(1, "Required"),
    initial_count: z.string().min(1, "Required"),
    estimated_age_days: z.string().optional(),
    breed: z.string().optional(),
  })
  .superRefine((vals, ctx) => {
    const count = Number(vals.initial_count);
    if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a whole number ≥ 0", path: ["initial_count"] });
    }
  });

type FormValues = z.infer<typeof schema>;

const DOB_OPTIONS = [
  { value: "exact", label: "Exact hatch date", hint: "You know the hatch / DOB day" },
  { value: "estimated", label: "Estimated age", hint: "Age in days is approximate" },
  { value: "unknown", label: "Unknown", hint: "Age unknown — may need review later" },
];

const MODE_OPTIONS = [
  { value: "batch", label: "Headcount", hint: "Track by unbanded headcount in the shed" },
  { value: "individual", label: "Individual", hint: "Track banded birds" },
  { value: "mixed", label: "Mixed", hint: "Banded + unbanded together" },
];

export default function CreateFlockScreen() {
  const { shedId: shedIdParam } = useLocalSearchParams<{ shedId?: string }>();
  const lockedShedId = typeof shedIdParam === "string" && shedIdParam.length > 0 ? shedIdParam : null;
  const { user, ownerAccountId } = useAuth();
  const canCatalogue = hasPermission(user, ownerAccountId, "schedule.view");
  const qc = useQueryClient();
  const sheds = useQuery({ queryKey: ["sheds", ownerAccountId], queryFn: () => listSheds() });
  const catalogues = useQuery({
    queryKey: ["catalogues", ownerAccountId],
    queryFn: () => listCatalogues(),
    enabled: canCatalogue,
  });
  const assignment = useQuery({
    queryKey: ["catalogue-assignment", ownerAccountId],
    queryFn: () => getCatalogueAssignment(),
    enabled: canCatalogue,
  });

  const [shedId, setShedId] = useState<string | null>(lockedShedId);
  const [shedError, setShedError] = useState<string | null>(null);
  /** null = inherit farm default catalogue (A2′). */
  const [catalogueId, setCatalogueId] = useState<string | null>(null);
  const [catalogueReady, setCatalogueReady] = useState(false);

  useEffect(() => {
    if (lockedShedId) setShedId(lockedShedId);
  }, [lockedShedId]);

  useEffect(() => {
    if (!canCatalogue || catalogueReady) return;
    if (assignment.isLoading || catalogues.isLoading) return;
    // Keep null = inherit farm default (A2′). UI shows “Farm default” via __inherit__.
    setCatalogueId(null);
    setCatalogueReady(true);
  }, [canCatalogue, catalogueReady, assignment.isLoading, catalogues.isLoading]);

  const [mode, setMode] = useState<"batch" | "individual" | "mixed">("batch");
  const [dobConfidence, setDobConfidence] = useState<"exact" | "estimated" | "unknown">("estimated");
  const [hatchDate, setHatchDate] = useState<string | null>(null);
  const [dobError, setDobError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { batch_code: "", initial_count: "100", estimated_age_days: "45", breed: "" },
  });

  const shedOptions = useMemo(() => {
    const rows = (sheds.data ?? [])
      .filter((s) => s.is_active)
      .filter((s) => (lockedShedId ? s.id === lockedShedId : true))
      .map((s) => ({
        value: s.id,
        label: s.name,
        hint: `${s.code}${s.is_owner_managed ? " · owner-managed" : " · farmer-managed"}`,
      }));
    return rows;
  }, [sheds.data, lockedShedId]);

  const onDobChange = (v: string) => {
    const next = v as typeof dobConfidence;
    setDobConfidence(next);
    setDobError(null);
    if (next === "exact") {
      setValue("estimated_age_days", "");
    } else if (next === "estimated") {
      setHatchDate(null);
      setValue("estimated_age_days", "45");
    } else {
      setHatchDate(null);
      setValue("estimated_age_days", "");
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!shedId) {
      setShedError("Select a shed");
      return;
    }
    if (dobConfidence === "exact" && !hatchDate) {
      setDobError("Hatch date is required for exact DOB");
      return;
    }
    if (dobConfidence === "estimated") {
      const age = Number(values.estimated_age_days);
      if (!Number.isFinite(age) || age < 0 || !Number.isInteger(age)) {
        setDobError("Estimated age (days) is required");
        return;
      }
    }
    setLoading(true);
    setError(null);
    setShedError(null);
    setDobError(null);
    try {
      const count = Number(values.initial_count);
      const age =
        dobConfidence === "estimated" && values.estimated_age_days
          ? Number(values.estimated_age_days)
          : undefined;
      const flock = await createFlock({
        shed_id: shedId,
        batch_code: values.batch_code,
        initial_count: count,
        tracking_mode: mode,
        dob_confidence: dobConfidence,
        hatch_date: dobConfidence === "exact" ? hatchDate : undefined,
        estimated_age_days: age,
        age_reported_on: age != null ? todayIsoDate() : undefined,
        breed: values.breed || undefined,
        unbanded_count: mode === "individual" ? 0 : count,
        // null / omit = inherit farm default; explicit id = flock override (A2′).
        vaccination_catalogue_id:
          !canCatalogue || !catalogueId || catalogueId === "__inherit__" ? null : catalogueId,
      });
      void qc.invalidateQueries({ queryKey: ["flocks", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["vaccination"] });
      toast.success("Flock created");
      if (lockedShedId) {
        void qc.invalidateQueries({ queryKey: ["shed-overview", lockedShedId] });
        router.replace(`/(app)/sheds/${lockedShedId}/birds`);
      } else {
        router.replace(`/(app)/flocks/${flock.id}`);
      }
    } catch (e: unknown) {
      const msg = describeApiError(e, "add birds");
      setError(msg);
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <SelectField
        label="Shed"
        required
        searchable={!lockedShedId}
        disabled={Boolean(lockedShedId)}
        placeholder="Choose shed"
        value={shedId}
        options={shedOptions}
        onChange={(v) => {
          if (lockedShedId) return;
          setShedId(v);
          setShedError(null);
        }}
        loading={sheds.isLoading}
        error={shedError ?? (sheds.isError ? "Could not load sheds" : undefined)}
        onRetry={() => sheds.refetch()}
        emptyMessage="No active sheds yet — create a shed first"
        helper={
          lockedShedId
            ? "These birds will be added in the selected shed"
            : "Required — birds belong to one shed"
        }
      />

      <RadioChips
        label="Tracking mode"
        required
        value={mode}
        options={MODE_OPTIONS}
        onChange={(v) => setMode(v as typeof mode)}
      />

      <RadioChips
        label="Date of birth confidence"
        required
        value={dobConfidence}
        options={DOB_OPTIONS}
        onChange={onDobChange}
        error={dobError ?? undefined}
        helper="Hatch date or estimated age helps track bird age"
      />

      {dobConfidence === "exact" ? (
        <AppDatePicker
          label="Hatch / DOB date"
          required
          value={hatchDate}
          maximumDate={todayIsoDate()}
          placeholder="Select hatch date"
          onChange={(v) => {
            setHatchDate(v);
            setDobError(null);
          }}
          error={dobError ?? undefined}
        />
      ) : null}

      {dobConfidence === "estimated" ? (
        <TextField control={control} name="estimated_age_days" label="Estimated age (days)" />
      ) : null}

      <TextField control={control} name="batch_code" label="Internal code" autoCapitalize="characters" />
      <TextField control={control} name="initial_count" label="Initial count" keyboardType="default" />
      <TextField control={control} name="breed" label="Breed (optional)" autoCapitalize="words" />

      {canCatalogue ? (
        <View style={styles.catalogueBlock}>
          <Text style={styles.catalogueLabel}>Select Vaccination Catalogue</Text>
          <Text style={styles.catalogueHelper}>
            Farm default is preselected. Override only when this flock needs a different schedule.
          </Text>
          {(catalogues.data ?? []).length === 0 && !catalogues.isLoading ? (
            <Text style={styles.catalogueEmpty}>
              No catalogues available — set a farm default under More → Catalogues
            </Text>
          ) : (
            <View style={styles.catalogueList}>
              <Pressable
                style={[
                  styles.catalogueCard,
                  (!catalogueId || catalogueId === "__inherit__") && styles.catalogueCardOn,
                ]}
                onPress={() => setCatalogueId(null)}
              >
                <View style={[styles.catalogueIcon, { backgroundColor: vaccineUi.brandSoft }]}>
                  <Ionicons name="leaf" size={20} color={vaccineUi.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.catalogueTitle}>Farm default</Text>
                  <Text style={styles.catalogueMeta} numberOfLines={2}>
                    {assignment.data?.catalogue_name
                      ? `Inherit ${assignment.data.catalogue_name}`
                      : "Inherit farm assignment"}
                  </Text>
                </View>
                {(!catalogueId || catalogueId === "__inherit__") ? (
                  <Ionicons name="checkmark-circle" size={22} color={vaccineUi.brand} />
                ) : null}
              </Pressable>
              {(catalogues.data ?? []).map((c, index) => {
                const selected = catalogueId === c.id;
                const iconColor = vaccineUi.iconPalette[index % vaccineUi.iconPalette.length];
                const iconBg = vaccineUi.iconSoftPalette[index % vaccineUi.iconSoftPalette.length];
                const isFarmDefault = assignment.data?.catalogue_id === c.id;
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.catalogueCard, selected && styles.catalogueCardOn]}
                    onPress={() => setCatalogueId(c.id)}
                  >
                    <View style={[styles.catalogueIcon, { backgroundColor: iconBg }]}>
                      <Ionicons name="paw" size={20} color={iconColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.catalogueTitle} numberOfLines={2}>
                        {c.name}
                      </Text>
                      <Text style={styles.catalogueMeta}>
                        {c.is_platform ? "Platform" : "Farm"} · {c.item_count} vaccine
                        {c.item_count === 1 ? "" : "s"}
                        {isFarmDefault ? " · farm default" : ""}
                      </Text>
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={22} color={vaccineUi.brand} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color={vaccineUi.infoText} />
            <Text style={styles.infoText}>
              The catalogue sets due dates from hatch age. Farm default applies unless you pick an
              explicit override for this flock.
            </Text>
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Add birds" onPress={onSubmit} loading={loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  catalogueBlock: { gap: 8 },
  catalogueLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  catalogueHelper: { fontSize: 12, fontWeight: "600", color: colors.inkMuted, lineHeight: 16 },
  catalogueEmpty: { fontSize: 13, color: colors.inkMuted, fontWeight: "600" },
  catalogueList: { gap: 8 },
  catalogueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: vaccineUi.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: vaccineUi.cardBorder,
    padding: 12,
  },
  catalogueCardOn: {
    borderColor: vaccineUi.brand,
    backgroundColor: vaccineUi.brandSoft,
  },
  catalogueIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  catalogueTitle: { fontSize: 15, fontWeight: "800", color: vaccineUi.ink },
  catalogueMeta: { fontSize: 12, fontWeight: "600", color: vaccineUi.muted, marginTop: 2 },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: vaccineUi.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: vaccineUi.infoBorder,
    padding: 12,
    marginTop: 4,
  },
  infoText: { flex: 1, fontSize: 12, fontWeight: "600", color: vaccineUi.infoText, lineHeight: 17 },
});
