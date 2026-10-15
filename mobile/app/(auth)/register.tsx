import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { registerOwner, warmApi } from "../../src/api/auth";
import { describeApiError } from "../../src/api/client";
import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { TextField } from "../../src/components/ui/TextField";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, radius, space } from "../../src/theme/tokens";

const schema = z.object({
  full_name: z.string().min(1, "Required"),
  organization_name: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterScreen() {
  const { acceptSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", organization_name: "", email: "", password: "" },
  });

  useEffect(() => {
    warmApi();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    try {
      const session = await registerOwner(values);
      if (session.user) {
        await acceptSession(session.user);
      } else {
        const { fetchMe } = await import("../../src/api/auth");
        await acceptSession(await fetchMe());
      }
      router.replace("/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "register"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll edges={["top", "left", "right", "bottom"]}>
      <View style={styles.hero}>
        <Text style={styles.brand}>Create your farm</Text>
        <Text style={styles.sub}>You’ll be the owner of this PoultryTrack organization.</Text>
      </View>

      <View style={styles.card}>
        <TextField
          control={control}
          name="full_name"
          label="Your name"
          placeholder="Alex Farmer"
          autoCapitalize="words"
          leftIcon="person-outline"
        />
        <TextField
          control={control}
          name="organization_name"
          label="Farm / organization"
          placeholder="Green Valley Poultry"
          autoCapitalize="words"
          leftIcon="leaf-outline"
        />
        <TextField
          control={control}
          name="email"
          label="Email"
          placeholder="you@farm.com"
          keyboardType="email-address"
          leftIcon="mail-outline"
        />
        <TextField
          control={control}
          name="password"
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          leftIcon="lock-closed-outline"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Create account" onPress={onSubmit} loading={loading} />
      </View>

      <Text style={styles.footer}>
        Already have an account?{" "}
        <Link href="/(auth)/login" style={styles.link}>
          Sign in
        </Link>
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.sm, marginBottom: space.sm, marginTop: space.md },
  brand: { fontSize: 28, fontWeight: "800", color: colors.brand, letterSpacing: -0.4 },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  error: { color: colors.danger, fontSize: 14 },
  footer: { color: colors.inkMuted, fontSize: 15, textAlign: "center", marginTop: space.sm },
  link: { color: colors.brand, fontWeight: "700" },
});
