import { zodResolver } from "@hookform/resolvers/zod";
import { Link, router } from "expo-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { StyleSheet, Text, View } from "react-native";
import { z } from "zod";

import { registerOwner } from "../../src/api/auth";
import { describeApiError } from "../../src/api/client";
import { Button } from "../../src/components/ui/Button";
import { Screen } from "../../src/components/ui/Screen";
import { TextField } from "../../src/components/ui/TextField";
import { useAuth } from "../../src/features/auth/AuthContext";
import { colors, space } from "../../src/theme/tokens";

const schema = z.object({
  full_name: z.string().min(1, "Required"),
  organization_name: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterScreen() {
  const { refreshSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", organization_name: "", email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true);
    setError(null);
    try {
      await registerOwner(values);
      await refreshSession();
      router.replace("/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "register"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.brand}>Create your farm</Text>
        <Text style={styles.sub}>Registers you as the organization owner for this farm account.</Text>
      </View>

      <TextField control={control} name="full_name" label="Your name" placeholder="Alex Farmer" autoCapitalize="words" />
      <TextField
        control={control}
        name="organization_name"
        label="Farm / organization name"
        placeholder="Green Valley Poultry"
        autoCapitalize="words"
      />
      <TextField control={control} name="email" label="Email" placeholder="you@farm.com" keyboardType="email-address" />
      <TextField control={control} name="password" label="Password" placeholder="••••••••" secureTextEntry />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Create account" onPress={onSubmit} loading={loading} />

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
  hero: { gap: space.sm, marginBottom: space.sm },
  brand: { fontSize: 26, fontWeight: "800", color: colors.brand },
  sub: { fontSize: 15, color: colors.inkMuted, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14 },
  footer: { color: colors.inkMuted, fontSize: 15, marginTop: space.sm },
  link: { color: colors.brand, fontWeight: "700" },
});
