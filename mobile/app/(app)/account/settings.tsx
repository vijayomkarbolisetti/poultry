import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { changePassword, updateProfile } from "../../../src/api/auth";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { FormBottomSheet } from "../../../src/components/ui/FormBottomSheet";
import { Screen } from "../../../src/components/ui/Screen";
import {
  profileInitials,
  validatePasswordChange,
  validateUsername,
} from "../../../src/features/auth/accountSettingsHelpers";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { safeBack } from "../../../src/navigation/safeBack";
import {
  colors,
  icons,
  layout,
  radius,
  space,
  states,
  typography,
} from "../../../src/theme/tokens";
import { toast } from "../../../src/ui/toast/toastStore";

export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, acceptSession } = useAuth();
  const nameSubmit = useRef(false);
  const passwordSubmit = useRef(false);

  const [editingName, setEditingName] = useState(false);
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!user) return <Redirect href="/(auth)/login" />;

  const resetPasswordForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setPasswordError(null);
  };

  const closePassword = () => {
    if (passwordSubmit.current) return;
    setPasswordOpen(false);
    resetPasswordForm();
  };

  const startEditName = () => {
    setFullName(user.full_name ?? "");
    setNameError(null);
    setEditingName(true);
  };

  const cancelEditName = () => {
    setEditingName(false);
    setFullName(user.full_name ?? "");
    setNameError(null);
  };

  const onSaveName = async () => {
    if (nameSubmit.current) return;
    const error = validateUsername(fullName);
    if (error) {
      setNameError(error);
      return;
    }
    nameSubmit.current = true;
    setNameLoading(true);
    setNameError(null);
    try {
      const updated = await updateProfile({ full_name: fullName.trim() });
      await acceptSession(updated);
      toast.success("Username updated");
      setEditingName(false);
    } catch (e: unknown) {
      setNameError(describeApiError(e, "update username"));
    } finally {
      setNameLoading(false);
      nameSubmit.current = false;
    }
  };

  const onSavePassword = async () => {
    if (passwordSubmit.current) return;
    const error = validatePasswordChange({ currentPassword, newPassword, confirmPassword });
    if (error) {
      setPasswordError(error);
      return;
    }
    passwordSubmit.current = true;
    setPasswordLoading(true);
    setPasswordError(null);
    try {
      const updated = await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      await acceptSession({ ...updated, must_change_password: false });
      toast.success("Password updated");
      setPasswordOpen(false);
      resetPasswordForm();
    } catch (e: unknown) {
      setPasswordError(describeApiError(e, "change password"));
    } finally {
      setPasswordLoading(false);
      passwordSubmit.current = false;
    }
  };

  const username = user.full_name || "—";

  return (
    <Screen
      scroll
      edges={["left", "right"]}
      style={{
        paddingTop: Math.max(insets.top, 8),
        paddingBottom: space.xl,
        backgroundColor: colors.bg,
        gap: space.lg,
      }}
    >
      <View style={styles.topBar}>
        <Pressable
          onPress={() => safeBack("/(app)/settings")}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: states.pressedOpacity }]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={icons.lg} color={colors.brandDark} />
        </Pressable>
      </View>

      <View style={styles.profile}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar} accessibilityLabel={`Profile, ${username}`}>
            <Text style={styles.avatarText}>{profileInitials(user.full_name)}</Text>
          </View>
          <Pressable
            onPress={startEditName}
            style={({ pressed }) => [styles.editBadge, pressed && { opacity: states.pressedOpacity }]}
            accessibilityRole="button"
            accessibilityLabel="Edit username"
            hitSlop={6}
          >
            <Ionicons name="pencil" size={12} color={colors.brandDark} />
          </Pressable>
        </View>
        <Text style={styles.profileName} numberOfLines={2}>
          {username}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <View style={styles.usernameBlock}>
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name="person-outline" size={icons.md} color={colors.ink} />
              </View>
              <Text style={styles.rowTitle}>Username</Text>
              {!editingName ? (
                <>
                  <Text style={styles.rowValue} numberOfLines={1}>
                    {username}
                  </Text>
                  <Pressable
                    onPress={startEditName}
                    accessibilityRole="button"
                    accessibilityLabel="Edit username"
                    hitSlop={8}
                    style={styles.editHit}
                  >
                    <Text style={styles.editLink}>Edit</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            {editingName ? (
              <View style={styles.editPanel}>
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={(t) => {
                    setFullName(t);
                    setNameError(null);
                  }}
                  autoCapitalize="words"
                  placeholder="Your name"
                  placeholderTextColor={colors.textPlaceholder}
                  accessibilityLabel="Username"
                />
                {nameError ? <Text style={styles.error}>{nameError}</Text> : null}
                <View style={styles.actions}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={cancelEditName}
                      disabled={nameLoading}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label="Save" onPress={() => void onSaveName()} loading={nameLoading} />
                  </View>
                </View>
              </View>
            ) : nameError ? (
              <Text style={[styles.error, styles.errorPad]}>{nameError}</Text>
            ) : null}
          </View>

          <View style={styles.divider} />

          <Pressable
            onPress={() => {
              resetPasswordForm();
              setPasswordOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Change password"
            style={({ pressed }) => [styles.row, pressed && { opacity: states.pressedOpacity }]}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="lock-closed-outline" size={icons.md} color={colors.ink} />
            </View>
            <Text style={[styles.rowTitle, { flex: 1 }]}>Change password</Text>
            <Ionicons name="chevron-forward" size={icons.md} color={colors.inkMuted} />
          </Pressable>
        </View>
      </View>

      <FormBottomSheet
        visible={passwordOpen}
        onClose={closePassword}
        dismissAccessibilityLabel="Dismiss change password"
        maxHeightFraction={0.88}
        sheetStyle={styles.sheetPad}
        header={
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Change password</Text>
            <Pressable onPress={closePassword} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close" size={icons.lg} color={colors.inkMuted} />
            </Pressable>
          </View>
        }
        footer={
          <View style={styles.sheetActions}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" onPress={closePassword} disabled={passwordLoading} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Save password" onPress={() => void onSavePassword()} loading={passwordLoading} />
            </View>
          </View>
        }
      >
        <SecretField
          label="Current password"
          value={currentPassword}
          onChangeText={(t) => {
            setCurrentPassword(t);
            setPasswordError(null);
          }}
          hidden={!showCurrent}
          onToggle={() => setShowCurrent((v) => !v)}
        />
        <SecretField
          label="New password"
          value={newPassword}
          onChangeText={(t) => {
            setNewPassword(t);
            setPasswordError(null);
          }}
          hidden={!showNew}
          onToggle={() => setShowNew((v) => !v)}
        />
        <SecretField
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={(t) => {
            setConfirmPassword(t);
            setPasswordError(null);
          }}
          hidden={!showConfirm}
          onToggle={() => setShowConfirm((v) => !v)}
        />
        {passwordError ? <Text style={styles.error}>{passwordError}</Text> : null}
      </FormBottomSheet>
    </Screen>
  );
}

function SecretField({
  label,
  value,
  onChangeText,
  hidden,
  onToggle,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  hidden: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.secretLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.inputFlex}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          accessibilityLabel={label}
        />
        <Pressable onPress={onToggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Toggle ${label}`}>
          <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={icons.md} color={colors.inkMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: layout.touchTarget,
  },
  backBtn: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: layout.touchTarget / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  profile: {
    alignItems: "center",
    gap: space.sm,
    marginTop: -space.sm,
  },
  avatarWrap: {
    width: 88,
    height: 88,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: typography.display.fontSize,
    fontWeight: "700",
    color: colors.textOnPrimary,
    letterSpacing: 0.4,
  },
  editBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: {
    ...typography.bodyStrong,
    color: colors.ink,
    textAlign: "center",
  },
  section: { gap: space.sm },
  sectionLabel: {
    ...typography.secondary,
    color: colors.inkMuted,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  usernameBlock: { paddingBottom: 0 },
  row: {
    minHeight: layout.touchTarget,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  rowIcon: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "500",
    color: colors.ink,
    flexShrink: 0,
  },
  rowValue: {
    ...typography.body,
    color: colors.inkMuted,
    flex: 1,
    textAlign: "right",
  },
  editHit: {
    minHeight: layout.touchTarget,
    justifyContent: "center",
    marginRight: -4,
  },
  editLink: {
    ...typography.label,
    fontWeight: "700",
    color: colors.brand,
  },
  editPanel: {
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    gap: space.sm,
  },
  input: {
    minHeight: layout.inputMinHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBgMuted,
    paddingHorizontal: space.md,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.ink,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: space.md + 28 + space.sm,
  },
  field: { gap: space.xs, marginBottom: space.md },
  secretLabel: { ...typography.label, color: colors.ink },
  inputRow: {
    minHeight: layout.inputMinHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBgMuted,
    paddingHorizontal: space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  inputFlex: { flex: 1, fontSize: typography.body.fontSize, color: colors.ink, fontWeight: "600" },
  error: { color: colors.danger, fontWeight: "600", fontSize: typography.secondary.fontSize },
  errorPad: { paddingHorizontal: space.md, paddingBottom: space.sm },
  actions: { flexDirection: "row", gap: space.sm },
  sheetPad: { paddingHorizontal: 20 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 4,
  },
  sheetTitle: {
    ...typography.screenTitle,
    color: colors.ink,
  },
  sheetActions: { flexDirection: "row", gap: space.sm },
});
