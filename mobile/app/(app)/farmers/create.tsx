import Ionicons from "@expo/vector-icons/Ionicons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";

import { createFarmer } from "../../../src/api/farmers";
import { describeApiError } from "../../../src/api/client";
import { listSheds } from "../../../src/api/sheds";
import { Button } from "../../../src/components/ui/Button";
import { ImmersiveHeroHeader } from "../../../src/components/ui/ImmersiveHeroHeader";
import { MultiSelectField } from "../../../src/components/ui/MultiSelectField";
import { TextField } from "../../../src/components/ui/TextField";
import { useAuth } from "../../../src/features/auth/AuthContext";
import {
  DEFAULT_FARMER_PERMS,
  FARMER_PERM_GROUPS,
  FARMER_ROLE_PRESETS,
  PERMISSION_LABELS,
  hasPermission,
} from "../../../src/features/auth/permissions";
import { safeBack } from "../../../src/navigation/safeBack";
import { farmerHeaderArt } from "../../../src/theme/media";
import { radius, shadow, space } from "../../../src/theme/tokens";
import { toast } from "../../../src/ui/toast/toastStore";

const ui = {
  mint: "#EFFFEB",
  deep: "#176B45",
  copper: "#B96F3B",
  card: "#FFFFFF",
  border: "#D7E4DE",
  ink: "#102A22",
  muted: "#6B7C75",
  softRow: "#F3FBF6",
  screen: "#F2F8F5",
} as const;

const schema = z.object({
  full_name: z.string().min(1, "Full name is required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function CreateFarmerScreen() {
  const { ownerAccountId, user } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const twoCol = width >= 420;
  const submitting = useRef(false);

  const sheds = useQuery({
    queryKey: ["sheds", ownerAccountId],
    queryFn: () => listSheds(),
    enabled: canManage,
  });
  const [selectedSheds, setSelectedSheds] = useState<string[]>([]);
  const [perms, setPerms] = useState<string[]>([...DEFAULT_FARMER_PERMS]);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: { full_name: "", email: "", password: "" },
  });

  const watched = useWatch({ control });
  const fieldsFilled =
    Boolean(watched.full_name?.trim()) &&
    Boolean(watched.email?.trim()) &&
    Boolean(watched.password && watched.password.length >= 8);

  const shedOptions = useMemo(
    () =>
      (sheds.data ?? [])
        .filter((s) => s.is_active)
        .map((s) => ({ value: s.id, label: s.name, hint: s.code })),
    [sheds.data],
  );

  const selectedShedMeta = useMemo(
    () => shedOptions.filter((o) => selectedSheds.includes(o.value)),
    [shedOptions, selectedSheds],
  );

  const togglePerm = (code: string) => {
    setActivePreset(null);
    setPerms((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  };

  const applyPreset = (presetId: string) => {
    const preset = FARMER_ROLE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    // Explicitly exclude vaccination.record even if a future preset drifts.
    setPerms(preset.codes.filter((c) => c !== "vaccination.record"));
    setActivePreset(presetId);
  };

  const removeShed = (id: string) => {
    setSelectedSheds((prev) => prev.filter((x) => x !== id));
  };

  const onSubmit = handleSubmit(async (values) => {
    if (submitting.current || loading) return;
    submitting.current = true;
    setLoading(true);
    try {
      // Only assign sheds from the current org's active list (tenant-safe).
      const validShedIds = selectedSheds.filter((id) => shedOptions.some((o) => o.value === id));
      await createFarmer({
        ...values,
        role: "farmer",
        permission_codes: perms,
        shed_ids: validShedIds,
      });
      void qc.invalidateQueries({ queryKey: ["farmers", ownerAccountId] });
      void qc.invalidateQueries({ queryKey: ["dashboard", ownerAccountId] });
      toast.success("Farmer added");
      router.replace("/(app)/farmers");
    } catch (e: unknown) {
      toast.error(describeApiError(e, "add the farmer"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  });

  if (!canManage) return <Redirect href="/(app)/home" />;

  const canSubmit = fieldsFilled && formState.isValid && !loading;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, space.md) + 88 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <ImmersiveHeroHeader
            source={farmerHeaderArt}
            curveFill={ui.screen}
            minHeight={132}
            accessibilityLabel="Create farmer illustration"
            contentStyle={styles.heroCopy}
            style={styles.heroFlush}
          >
            <Pressable
              onPress={() => safeBack("/(app)/farmers")}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={10}
            >
              <Ionicons name="arrow-back" size={20} color={ui.deep} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle}>Create Farmer</Text>
              <Text style={styles.headerSub} numberOfLines={2}>
                Invite a teammate, assign sheds, and choose only the access they need.
              </Text>
            </View>
          </ImmersiveHeroHeader>

          {/* Personal information */}
          <View style={[styles.card, shadow.card]}>
            <Text style={styles.cardTitle}>Personal information</Text>
            <TextField
              control={control}
              name="full_name"
              label="Full name"
              autoCapitalize="words"
              leftIcon="person-outline"
              returnKeyType="next"
            />
            <TextField
              control={control}
              name="email"
              label="Email address"
              keyboardType="email-address"
              leftIcon="mail-outline"
              returnKeyType="next"
            />
            <TextField
              control={control}
              name="password"
              label="Temporary password"
              secureTextEntry
              leftIcon="lock-closed-outline"
              returnKeyType="done"
            />
          </View>

          {/* Assign sheds */}
          <View style={[styles.card, shadow.card]}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Assign sheds</Text>
              <Text style={styles.countPill}>
                {selectedShedMeta.length} selected
              </Text>
            </View>
            <Text style={styles.helper}>
              Farmers can only access the sheds assigned to them. Search by name or shed code.
            </Text>
            <MultiSelectField
              label="Eligible sheds"
              placeholder="Search and select sheds…"
              helper={
                sheds.isLoading
                  ? "Loading sheds…"
                  : shedOptions.length === 0
                    ? "No eligible sheds on this farm yet — create a shed first."
                    : undefined
              }
              values={selectedSheds}
              options={shedOptions}
              onChange={setSelectedSheds}
              searchable
              emptyMessage={
                sheds.isLoading ? "Loading sheds…" : "No eligible sheds match your search."
              }
            />
            {selectedShedMeta.length === 0 ? (
              <View style={styles.shedEmpty}>
                <Ionicons name="home-outline" size={18} color={ui.muted} />
                <Text style={styles.shedEmptyText}>
                  No sheds selected yet. Assign at least one when this farmer should work in the field.
                </Text>
              </View>
            ) : (
              <View style={styles.chips}>
                {selectedShedMeta.map((s) => (
                  <Pressable
                    key={s.value}
                    onPress={() => removeShed(s.value)}
                    style={styles.chip}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${s.label}`}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>
                      {s.label}
                      {s.hint ? ` · ${s.hint}` : ""}
                    </Text>
                    <Ionicons name="close-circle" size={16} color={ui.deep} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Permissions */}
          <View style={[styles.card, shadow.card]}>
            <Text style={styles.cardTitle}>Permissions</Text>
            <Text style={styles.helper}>
              Toggle only what this farmer should access. Recording vaccinations is never granted by
              default — enable it explicitly when appropriate.
            </Text>

            <Text style={styles.presetLabel}>Select common role</Text>
            <View style={styles.presetRow}>
              {FARMER_ROLE_PRESETS.map((p) => {
                const on = activePreset === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => applyPreset(p.id)}
                    style={[styles.presetChip, on && styles.presetChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.presetChipText, on && styles.presetChipTextOn]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {FARMER_PERM_GROUPS.map((group) => (
              <View key={group.title} style={styles.group}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                <View style={[styles.permGrid, twoCol && styles.permGridTwo]}>
                  {group.codes.map((code) => {
                    const on = perms.includes(code);
                    const label = PERMISSION_LABELS[code];
                    const sensitive = code === "vaccination.record";
                    return (
                      <View
                        key={code}
                        style={[
                          styles.permRow,
                          twoCol && styles.permRowHalf,
                          on && styles.permRowOn,
                          sensitive && on && styles.permRowSensitive,
                        ]}
                      >
                        <View style={styles.permCopy}>
                          <Text style={styles.permTitle}>{label?.title ?? code}</Text>
                          <Text style={styles.permHint} numberOfLines={2}>
                            {label?.hint ?? code}
                          </Text>
                        </View>
                        <Switch
                          value={on}
                          onValueChange={() => togglePerm(code)}
                          trackColor={{ false: "#D7E4DE", true: ui.deep }}
                          thumbColor="#FFFFFF"
                          ios_backgroundColor="#D7E4DE"
                          accessibilityLabel={label?.title ?? code}
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          <Button
            label="Create farmer"
            onPress={onSubmit}
            loading={loading}
            disabled={!canSubmit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ui.screen },
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: space.md,
    gap: space.md,
  },
  heroFlush: {
    marginHorizontal: -space.md,
    marginBottom: 4,
  },
  heroCopy: {
    gap: 12,
    justifyContent: "space-between",
    minHeight: 96,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    maxWidth: "58%",
    paddingBottom: 4,
    gap: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: ui.deep,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    lineHeight: 16,
    color: ui.muted,
    fontWeight: "500",
  },
  card: {
    backgroundColor: ui.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: ui.border,
    padding: space.md,
    gap: space.sm,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: ui.ink,
  },
  countPill: {
    fontSize: 12,
    fontWeight: "700",
    color: ui.deep,
    backgroundColor: "#E8F6F0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  helper: {
    color: ui.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -2,
  },
  shedEmpty: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "flex-start",
    backgroundColor: ui.mint,
    borderRadius: radius.md,
    padding: space.sm,
  },
  shedEmptyText: {
    flex: 1,
    color: ui.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    backgroundColor: "#E8F6F0",
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#C8E6D8",
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    color: ui.deep,
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: ui.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: ui.border,
    backgroundColor: ui.card,
  },
  presetChipOn: {
    borderColor: ui.deep,
    backgroundColor: "#E8F6F0",
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: ui.muted,
  },
  presetChipTextOn: {
    color: ui.deep,
  },
  group: {
    gap: 8,
    marginTop: 6,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: ui.copper,
  },
  permGrid: {
    gap: 8,
  },
  permGridTwo: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  permRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: ui.border,
    backgroundColor: ui.card,
    minHeight: 56,
  },
  permRowHalf: {
    width: "48.5%",
    flexGrow: 1,
  },
  permRowOn: {
    backgroundColor: ui.softRow,
    borderColor: "#C8E6D8",
  },
  permRowSensitive: {
    borderColor: ui.copper,
  },
  permCopy: {
    flex: 1,
    gap: 2,
  },
  permTitle: {
    fontWeight: "700",
    color: ui.ink,
    fontSize: 14,
  },
  permHint: {
    color: ui.muted,
    fontSize: 11,
    lineHeight: 14,
  },
});
