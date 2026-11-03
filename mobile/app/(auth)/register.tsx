import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { BrandLogo } from "../../src/components/brand/BrandLogo";
import { Screen } from "../../src/components/ui/Screen";
import { APP_BRAND_NAME } from "../../src/config/appConfig";
import { colors, radius, shadows, space, typography } from "../../src/theme/tokens";

/**
 * Public self-serve farm signup is disabled (D10 revised).
 * Kept as a route so old deep links land on a clear message.
 */
export default function RegisterScreen() {
  return (
    <Screen scroll edges={["top", "left", "right"]}>
      <View style={styles.hero}>
        <BrandLogo size={56} />
        <Text style={styles.brand}>Account by invitation</Text>
        <Text style={styles.sub}>
          {APP_BRAND_NAME} farm accounts are created by a platform admin. Ask your admin for login
          details.
        </Text>
      </View>

      <View style={[styles.card, shadows.soft]}>
        <Text style={styles.body}>
          If you already received credentials, sign in with your email and password.
        </Text>
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
  hero: { gap: space.sm, marginBottom: space.sm, marginTop: space.md, alignItems: "center" },
  brand: { ...typography.heading, color: colors.primary, textAlign: "center" },
  sub: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: { ...typography.body, color: colors.ink, textAlign: "center" },
  footer: {
    color: colors.textSecondary,
    fontSize: typography.body.fontSize,
    textAlign: "center",
    marginTop: space.sm,
  },
  link: { color: colors.primary, fontWeight: "700" },
});
