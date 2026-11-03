import { Redirect, router } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable } from "react-native";

import { updateProfile } from "../../../src/api/auth";
import { describeApiError } from "../../../src/api/client";
import { Button } from "../../../src/components/ui/Button";
import { useAuth } from "../../../src/features/auth/AuthContext";
import { safeBack } from "../../../src/navigation/safeBack";
import { colors, radius, space, typography } from "../../../src/theme/tokens";
import { toast } from "../../../src/ui/toast/toastStore";

export default function EditProfileScreen() {
  const { user, acceptSession } = useAuth();
  const insets = useSafeAreaInsets();
  const submitting = useRef(false);
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <Redirect href="/(auth)/login" />;

  const onSave = async () => {
    if (submitting.current) return;
    const name = fullName.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const updated = await updateProfile({ full_name: name });
      await acceptSession(updated);
      toast.success("Name updated");
      router.back();
    } catch (e: unknown) {
      setError(describeApiError(e, "update name"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 8) }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => safeBack("/(app)/settings")} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={colors.brand} />
        </Pressable>
        <Text style={styles.title}>Change name</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          placeholder="Your name"
          placeholderTextColor={colors.inkMuted}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Save" onPress={() => void onSave()} loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.md },
  topBar: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.md },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: colors.ink },
  form: { gap: space.md },
  label: { fontWeight: "700", color: colors.ink, fontSize: typography.label.fontSize },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.md,
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.ink,
  },
  error: { color: colors.danger, fontWeight: "600" },
});
