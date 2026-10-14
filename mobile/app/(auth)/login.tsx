import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { login } from "../../src/api/auth";
import { API_URL, describeApiError } from "../../src/api/client";
import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { TextField } from "../../src/components/ui/TextField";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, space } from "../../src/theme/tokens";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginScreen() {
  const { refreshSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    try {
      await login(values);
      await refreshSession();
      router.replace("/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "sign in"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.brand}>Poultry Vaccine Tracker</Text>
        <Text style={styles.sub}>Sign in to manage sheds, flocks, and vaccination schedules.</Text>
      </View>

      <TextField control={control} name="email" label="Email" placeholder="you@farm.com" keyboardType="email-address" />
      <TextField control={control} name="password" label="Password" placeholder="••••••••" secureTextEntry />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Sign in" onPress={onSubmit} loading={loading} />

      <Text style={styles.footer}>
        New owner?{" "}
        <Link href="/(auth)/register" style={styles.link}>
          Create farm account
        </Link>
      </Text>
      <Text style={styles.apiHint}>API: {API_URL}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.sm, marginBottom: space.sm },
  brand: { fontSize: 28, fontWeight: "800", color: colors.brand, letterSpacing: -0.5 },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14 },
  footer: { color: colors.inkMuted, fontSize: 15, marginTop: space.sm },
  link: { color: colors.brand, fontWeight: "700" },
  apiHint: { color: colors.inkMuted, fontSize: 12, marginTop: space.md },
});
