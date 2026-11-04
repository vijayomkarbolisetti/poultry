import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { changePassword } from "../../src/api/auth";
import { describeApiError } from "../../src/api/client";
import { BrandLogo } from "../../src/components/brand/BrandLogo";
import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, radius, shadows, space, typography } from "../../src/theme/tokens";

/**
 * Forced or voluntary password change. When must_change_password is set,
 * this is the only screen available until the password is updated.
 */
export default function ChangePasswordScreen() {
  const { user, acceptSession, signOut } = useAuth();
  // Capture whether this visit was a forced first-login change. After success,
  // must_change_password flips false — leave automatically instead of staying
  // on the voluntary "Change password" form.
  const wasForced = useRef(Boolean(user?.must_change_password));
  const submitting = useRef(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user) return <Redirect href="/(auth)/login" />;
  if (done || (wasForced.current && !user.must_change_password)) {
    return <Redirect href="/(app)/home" />;
  }

  const required = Boolean(user.must_change_password);

  const onSubmit = async () => {
    if (submitting.current) return;
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const updated = await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      await acceptSession({ ...updated, must_change_password: false });
      setDone(true);
      router.replace("/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "change password"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  return (
    <Screen scroll edges={["top", "left", "right"]}>
      <View style={styles.hero}>
        <BrandLogo size={48} />
        <Text style={styles.title}>{required ? "Set a new password" : "Change password"}</Text>
        <Text style={styles.sub}>
          {required
            ? "For security, change the temporary password before using the app."
            : "Choose a new password for your account."}
        </Text>
      </View>

      <View style={[styles.card, shadows.soft]}>
        <Field
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secure={!showCurrent}
          onToggleSecure={() => setShowCurrent((v) => !v)}
        />
        <Field
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secure={!showNew}
          onToggleSecure={() => setShowNew((v) => !v)}
        />
        <Field
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secure={!showConfirm}
          onToggleSecure={() => setShowConfirm((v) => !v)}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Save password" onPress={() => void onSubmit()} loading={loading} />
        {!required ? (
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        ) : (
          <Pressable
            onPress={async () => {
              await signOut();
              router.replace("/(auth)/login");
            }}
            style={styles.signOut}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  secure,
  onToggleSecure,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  onToggleSecure?: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={colors.inkMuted}
        />
        {onToggleSecure ? (
          <Pressable onPress={onToggleSecure} hitSlop={10} accessibilityRole="button">
            <Ionicons
              name={secure ? "eye-outline" : "eye-off-outline"}
              size={20}
              color={colors.inkMuted}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.sm, marginBottom: space.md, marginTop: space.md, alignItems: "center" },
  title: { ...typography.heading, color: colors.primary, textAlign: "center" },
  sub: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: typography.label.fontSize, fontWeight: "700" },
  inputRow: {
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
  input: { flex: 1, fontSize: typography.body.fontSize, color: colors.ink, fontWeight: "600" },
  error: { color: colors.danger, fontWeight: "600" },
  signOut: { alignItems: "center", paddingVertical: 8 },
  signOutText: { color: colors.inkMuted, fontWeight: "700" },
});
