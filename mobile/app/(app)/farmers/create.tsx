import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { createFarmer } from "../../../src/api/farmers";
import { describeApiError } from "../../../src/api/client";
import { listSheds } from "../../../src/api/sheds";
import { MultiSelectField } from "../../../src/components/ui/MultiSelectField";
import { useResetSearchOnContextChange } from "../../../src/features/search/searchLifecycle";
import { useAuth } from "../../../src/features/auth/AuthContext";
import {
  ALL_GRANTABLE_FARMER_PERMS,
  CREATE_FARMER_INITIAL_PERMS,
  DEFAULT_FARMER_PERMS,
  FARMER_CREATE_PERM_CATEGORIES,
  hasPermission,
  type FarmerPermCode,
} from "../../../src/features/auth/permissions";
import { safeBack } from "../../../src/navigation/safeBack";
import { birdUi } from "../../../src/theme/birdManagementUi";
import { farmerHeaderArt } from "../../../src/theme/media";
import { toast } from "../../../src/ui/toast/toastStore";
import { typography } from "../../../src/theme/tokens";


type ContactMode = "email" | "phone";

/**
 * Backend FarmerCreate requires EmailStr — phone-only account creation is not supported.
 * Phone mode shows the reference UI and an explicit limitation; create stays email-based.
 */
export default function CreateFarmerScreen() {
  const { ownerAccountId, user } = useAuth();
  const canManage = hasPermission(user, ownerAccountId, "farmer.manage");
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const submitting = useRef(false);

  const sheds = useQuery({
    queryKey: ["sheds", ownerAccountId],
    queryFn: () => listSheds(),
    enabled: canManage,
  });

  const [contactMode, setContactMode] = useState<ContactMode>("email");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedSheds, setSelectedSheds] = useState<string[]>([]);
  const [perms, setPerms] = useState<string[]>([...CREATE_FARMER_INITIAL_PERMS]);
  const [loading, setLoading] = useState(false);

  useResetSearchOnContextChange(ownerAccountId, () => setSelectedSheds([]));

  const shedOptions = useMemo(
    () =>
      (sheds.data ?? [])
        .filter((s) => s.is_active)
        .map((s) => ({ value: s.id, label: s.name })),
    [sheds.data],
  );

  const selectedShedMeta = useMemo(
    () => shedOptions.filter((o) => selectedSheds.includes(o.value)),
    [shedOptions, selectedSheds],
  );

  const allEnabled =
    ALL_GRANTABLE_FARMER_PERMS.length > 0 &&
    ALL_GRANTABLE_FARMER_PERMS.every((c) => perms.includes(c));

  const categoryOn = (codes: FarmerPermCode[]) => codes.every((c) => perms.includes(c));

  const toggleCategory = (codes: FarmerPermCode[]) => {
    const on = categoryOn(codes);
    setPerms((prev) => {
      if (on) return prev.filter((c) => !codes.includes(c as FarmerPermCode));
      const next = new Set(prev);
      for (const c of codes) next.add(c);
      return [...next];
    });
  };

  const resetToDefault = () => {
    setPerms([...DEFAULT_FARMER_PERMS]);
  };

  const enableAll = () => {
    setPerms([...ALL_GRANTABLE_FARMER_PERMS]);
  };

  const removeShed = (id: string) => {
    setSelectedSheds((prev) => prev.filter((x) => x !== id));
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const nameOk = fullName.trim().length > 0;
  const passwordOk = password.length >= 8;
  const phoneModeBlocked = contactMode === "phone";
  const canSubmit =
    !loading &&
    !phoneModeBlocked &&
    nameOk &&
    emailOk &&
    passwordOk;

  const onSubmit = async () => {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    try {
      const validShedIds = selectedSheds.filter((id) => shedOptions.some((o) => o.value === id));
      // Only submit codes that are grantable via this UI (tenant-safe allow-list).
      const permission_codes = perms.filter((c) =>
        (ALL_GRANTABLE_FARMER_PERMS as readonly string[]).includes(c),
      );
      await createFarmer({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: "farmer",
        permission_codes,
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
  };

  if (!canManage) return <Redirect href="/(app)/home" />;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 12) + 88 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.hero}>
            <Image source={farmerHeaderArt} style={styles.heroArt} resizeMode="cover" />
            <View style={styles.heroRow}>
              <Pressable
                onPress={() => safeBack("/(app)/farmers")}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Ionicons name="arrow-back" size={22} color={birdUi.primary} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Create Farmer</Text>
                <Text style={styles.heroSub}>Invite a teammate with sheds and access</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Contact Details</Text>
            <View style={styles.segment}>
              {(
                [
                  ["email", "Email"],
                  ["phone", "Phone"],
                ] as const
              ).map(([value, label]) => {
                const on = contactMode === value;
                return (
                  <Pressable
                    key={value}
                    style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                    onPress={() => setContactMode(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {contactMode === "phone" ? (
              <View style={styles.limitBanner}>
                <Ionicons name="information-circle" size={18} color={birdUi.orange} />
                <Text style={styles.limitText}>
                  Phone sign-in is not supported by the server yet. Switch to Email to create a
                  farmer login. (Accounts require an email address and password.)
                </Text>
              </View>
            ) : null}

            {contactMode === "email" ? (
              <>
                <Text style={styles.label}>Email address</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="mail-outline" size={18} color={birdUi.muted} />
                  <TextInput
                    style={styles.inputFlex}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="farmer@farm.com"
                    placeholderTextColor={birdUi.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Email address"
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.label}>Phone number</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="call-outline" size={18} color={birdUi.muted} />
                  <TextInput
                    style={styles.inputFlex}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="Enter phone number"
                    placeholderTextColor={birdUi.muted}
                    keyboardType="phone-pad"
                    accessibilityLabel="Phone number"
                  />
                </View>
              </>
            )}

            <Text style={styles.label}>Full name</Text>
            <View style={styles.inputRow}>
              <Ionicons name="person-outline" size={18} color={birdUi.muted} />
              <TextInput
                style={styles.inputFlex}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Full name"
                placeholderTextColor={birdUi.muted}
                autoCapitalize="words"
                accessibilityLabel="Full name"
              />
            </View>

            <Text style={styles.label}>Temporary password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={birdUi.muted} />
              <TextInput
                style={styles.inputFlex}
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                placeholderTextColor={birdUi.muted}
                secureTextEntry={!showPassword}
                accessibilityLabel="Temporary password"
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={10}
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={birdUi.muted}
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Assign Sheds</Text>
              <Text style={styles.countPill}>{selectedShedMeta.length} selected</Text>
            </View>
            <MultiSelectField
              label="Search sheds"
              placeholder="Search and select sheds…"
              helper={
                sheds.isLoading
                  ? "Loading sheds…"
                  : shedOptions.length === 0
                    ? "No eligible sheds yet — create a shed first."
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
            {selectedShedMeta.length > 0 ? (
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
                    </Text>
                    <Ionicons name="close" size={14} color={birdUi.white} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Access Permissions</Text>
            <View style={styles.allBanner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.allBannerTitle}>
                  {allEnabled ? "All permissions enabled" : "Custom permissions"}
                </Text>
                <Text style={styles.allBannerSub}>
                  Owner-granted access only. Turn on Record doses to let this farmer mark vaccinations.
                </Text>
              </View>
              <Pressable onPress={allEnabled ? resetToDefault : enableAll} hitSlop={8}>
                <Text style={styles.resetLink}>
                  {allEnabled ? "Reset to default" : "Enable all"}
                </Text>
              </Pressable>
            </View>

            {FARMER_CREATE_PERM_CATEGORIES.map((cat) => {
              const on = categoryOn(cat.codes);
              return (
                <View key={cat.id} style={[styles.permRow, on && styles.permRowOn]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permTitle}>{cat.title}</Text>
                    <Text style={styles.permHint}>{cat.hint}</Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={() => toggleCategory(cat.codes)}
                    trackColor={{ false: "#D7E4DE", true: birdUi.primary }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor="#D7E4DE"
                    accessibilityLabel={cat.title}
                  />
                </View>
              );
            })}
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            style={[styles.createBtn, !canSubmit && styles.disabled]}
            disabled={!canSubmit}
            onPress={() => void onSubmit()}
            accessibilityRole="button"
            accessibilityLabel="Create farmer"
          >
            <Ionicons name="person-add-outline" size={20} color="#fff" />
            <Text style={styles.createBtnText}>
              {loading ? "Creating…" : "Create Farmer"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: birdUi.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  hero: {
    marginHorizontal: -16,
    minHeight: 96,
    overflow: "hidden",
    backgroundColor: birdUi.paleMint,
  },
  heroArt: { ...StyleSheet.absoluteFill, opacity: 0.45 },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: birdUi.white,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: birdUi.deepGreen },
  heroSub: { fontSize: typography.secondary.fontSize, fontWeight: "600", color: birdUi.muted, marginTop: 2 },
  card: {
    backgroundColor: birdUi.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.deepGreen },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  countPill: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    color: birdUi.primary,
    backgroundColor: birdUi.successBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  segment: {
    flexDirection: "row",
    backgroundColor: birdUi.bg,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnOn: { backgroundColor: birdUi.primary },
  segmentText: { fontSize: typography.label.fontSize, fontWeight: "800", color: birdUi.muted },
  segmentTextOn: { color: birdUi.white },
  limitBanner: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: birdUi.orangePale,
    borderRadius: 12,
    padding: 10,
    alignItems: "flex-start",
  },
  limitText: { flex: 1, fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.orange, lineHeight: 17 },
  label: { fontSize: typography.label.fontSize, fontWeight: "700", color: birdUi.muted },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: birdUi.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: birdUi.bg,
  },
  inputFlex: { flex: 1, fontSize: typography.body.fontSize, fontWeight: "600", color: birdUi.text, paddingVertical: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: birdUi.primary,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  chipText: { fontSize: typography.caption.fontSize, fontWeight: "700", color: birdUi.white, maxWidth: 140 },
  allBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: birdUi.successBg,
    borderRadius: 12,
    padding: 12,
  },
  allBannerTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.primary },
  allBannerSub: { fontSize: typography.overline.fontSize, fontWeight: "600", color: birdUi.muted, marginTop: 2, lineHeight: 15 },
  resetLink: { fontSize: typography.caption.fontSize, fontWeight: "800", color: birdUi.primary },
  permRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: birdUi.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: birdUi.bg,
  },
  permRowOn: { backgroundColor: "#F3FBF6", borderColor: "#C8E6D8" },
  permTitle: { fontSize: typography.sectionTitle.fontSize, fontWeight: "800", color: birdUi.text },
  permHint: { fontSize: typography.caption.fontSize, fontWeight: "600", color: birdUi.muted, marginTop: 2 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: birdUi.border,
    backgroundColor: birdUi.bg,
  },
  createBtn: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: birdUi.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  createBtnText: { fontSize: typography.bodyStrong.fontSize, fontWeight: "800", color: "#fff" },
  disabled: { opacity: 0.45 },
});
