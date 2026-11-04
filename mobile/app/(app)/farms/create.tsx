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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { describeApiError } from "../../../src/api/client";
import { createOwnerAccount } from "../../../src/api/owners";
import { Button } from "../../../src/components/ui/Button";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { safeBack } from "../../../src/navigation/safeBack";
import { colors, radius, space, typography } from "../../../src/theme/tokens";
import { toast } from "../../../src/ui/toast/toastStore";

const ui = {
  mint: "#EFFFEB",
  deep: "#176B45",
} as const;

export default function CreateFarmScreen() {
  const { user, setActiveOwner } = useAuth();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const submitting = useRef(false);
  const isSuper = Boolean(user?.is_platform_super_admin);

  const [organizationName, setOrganizationName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSuper) return <Redirect href="/(app)/home" />;

  const onSubmit = async () => {
    if (submitting.current) return;
    const org = organizationName.trim();
    const name = fullName.trim();
    const mail = email.trim().toLowerCase();
    if (!org || !name || !mail || password.length < 8) {
      setError("Farm name, owner name, email, and a password (8+ chars) are required.");
      return;
    }
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const created = await createOwnerAccount({
        organization_name: org,
        full_name: name,
        email: mail,
        password,
      });
      await qc.invalidateQueries({ queryKey: ["owners", "all"] });
      await setActiveOwner(created.owner.id);
      const pwd = created.owner_user.password;
      toast.success(
        pwd
          ? `Created ${created.owner.name}. Owner password: ${pwd}`
          : `Created ${created.owner.name}`,
      );
      router.replace("/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "create farm"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable
          onPress={() => safeBack("/(app)/farms")}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={22} color={ui.deep} />
        </Pressable>
        <View style={styles.topBarCopy}>
          <Text style={styles.title}>Create farm</Text>
          <Text style={styles.sub}>Provisions the farm and its owner login</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.form, { paddingBottom: Math.max(insets.bottom, 24) }]}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="Farm / organization"
          value={organizationName}
          onChangeText={setOrganizationName}
          placeholder="Green Valley Poultry"
          autoCapitalize="words"
        />
        <Field
          label="Owner full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Alex Farmer"
          autoCapitalize="words"
        />
        <Field
          label="Owner email"
          value={email}
          onChangeText={setEmail}
          placeholder="owner@farm.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Temporary password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1, borderWidth: 0 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.inkMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            >
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.inkMuted}
              />
            </Pressable>
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Create farm account" onPress={() => void onSubmit()} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "words";
  keyboardType?: "email-address" | "default";
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkMuted}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ui.mint,
  },
  topBarCopy: { flex: 1, gap: 2 },
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: colors.ink },
  sub: { fontSize: typography.caption.fontSize, color: colors.inkMuted, fontWeight: "600" },
  form: { paddingHorizontal: space.md, gap: space.md },
  fieldWrap: { gap: 6 },
  label: { color: colors.ink, fontSize: typography.label.fontSize, fontWeight: "700" },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.md,
    fontSize: typography.body.fontSize,
    color: colors.ink,
    fontWeight: "600",
  },
  passwordRow: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  error: { color: colors.danger, fontSize: typography.secondary.fontSize, fontWeight: "600" },
});
