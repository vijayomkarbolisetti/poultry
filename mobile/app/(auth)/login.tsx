import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { login, warmApi } from "../../src/api/auth";
import { describeApiError } from "../../src/api/client";
import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { TextField } from "../../src/components/ui/TextField";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../src/theme/tokens";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginScreen() {
  const { acceptSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    warmApi();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    try {
      const session = await login(values);
      if (session.user) {
        await acceptSession(session.user);
      } else {
        // Older API without embedded user — fall back (extra round-trip).
        const { fetchMe } = await import("../../src/api/auth");
        await acceptSession(await fetchMe());
      }
      router.replace("/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "sign in"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll edges={["top", "left", "right", "bottom"]}>
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <Text style={styles.logoMarkText}>PT</Text>
        </View>
        <Text style={styles.brand}>PoultryTrack</Text>
        <Text style={styles.sub}>Sign in to manage sheds, flocks, and vaccinations.</Text>
      </View>

      <View style={styles.card}>
        <TextField
          control={control}
          name="email"
          label="Email"
          placeholder="you@farm.com"
          keyboardType="email-address"
          leftIcon="person-outline"
        />
        <TextField
          control={control}
          name="password"
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          leftIcon="lock-closed-outline"
        />

        <View style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: remember }}
            onPress={() => setRemember((v) => !v)}
            style={styles.remember}
          >
            <View style={[styles.checkbox, remember && styles.checkboxOn]}>
              {remember ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
            <Text style={styles.rememberLabel}>Remember me</Text>
          </Pressable>
          <Text style={styles.forgot}>Forgot password?</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Sign In" onPress={onSubmit} loading={loading} />
      </View>

      <Text style={styles.footer}>
        Don’t have an account?{" "}
        <Link href="/(auth)/register" style={styles.link}>
          Create farm
        </Link>
      </Text>
      <Text style={styles.contact}>Need access? Contact Admin</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: space.sm, marginTop: space.lg, marginBottom: space.md },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMarkText: { color: "#fff", fontWeight: "800", fontSize: 20 },
  brand: { fontSize: 28, fontWeight: "800", color: colors.brand, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22, textAlign: "center", paddingHorizontal: space.md },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  remember: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkMark: { color: "#fff", fontSize: 12, fontWeight: "800" },
  rememberLabel: { color: colors.inkMuted, fontSize: 14 },
  forgot: { color: colors.brand, fontWeight: "700", fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  footer: { color: colors.inkMuted, fontSize: 15, textAlign: "center", marginTop: space.sm },
  link: { color: colors.brand, fontWeight: "700" },
  contact: { color: colors.inkMuted, fontSize: 13, textAlign: "center" },
});
