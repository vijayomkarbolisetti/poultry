import Ionicons from "@expo/vector-icons/Ionicons";
import { zodResolver } from "@hookform/resolvers/zod";
import { LinearGradient } from "expo-linear-gradient";
import { Link, router } from "expo-router";
import {
  Dispatch,
  type RefObject,
  type ReactNode,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { Control, useForm } from "react-hook-form";
import {
  Dimensions,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";

import { login, warmApi } from "../../src/api/auth";
import { describeApiError } from "../../src/api/client";
import { BrandLogo } from "../../src/components/brand/BrandLogo";
import { Button } from "../../src/components/ui/Button";
import { TextField } from "../../src/components/ui/TextField";
import { useAuth } from "../../src/features/auth/AuthContext";
import {
  colors,
  icons,
  layout,
  radius,
  shadows,
  space,
  typography,
} from "../../src/theme/tokens";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

/** Stable at module load — live window size re-renders on IME resize and can blur inputs. */
const SCREEN_WIDTH = Dimensions.get("window").width;

/**
 * Unified login — guest entry point.
 * Remember me / Forgot password / Contact Admin are UI-only (no backend hooks yet).
 * Auth uses existing JWT login — never bypassed.
 */
export default function LoginScreen() {
  const { acceptSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);
  const submitting = useRef(false);
  const passwordRef = useRef<TextInput>(null);
  const { control, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const formMaxWidth = Math.min(layout.maxFormWidth, SCREEN_WIDTH - space.lg * 2);

  useEffect(() => {
    warmApi();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    if (submitting.current || loading) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const session = await login(values);
      if (session.user) {
        await acceptSession(session.user);
      } else {
        const { fetchMe } = await import("../../src/api/auth");
        await acceptSession(await fetchMe());
      }
      router.replace("/(app)/home");
    } catch (e: unknown) {
      setError(describeApiError(e, "sign in"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  });

  const form = (
    <LoginForm
      control={control}
      remember={remember}
      setRemember={setRemember}
      error={error}
      loading={loading}
      onSubmit={onSubmit}
      passwordRef={passwordRef}
    />
  );

  return (
    <View style={styles.root} accessibilityLabel="PoultryTrack sign in">
      <ImageBackground
        source={require("../../assets/loginbackround.png")}
        style={styles.bg}
        resizeMode="cover"
        imageStyle={styles.bgImage}
      >
        <LinearGradient
          colors={["rgba(52, 211, 153, 0.10)", "transparent", "rgba(2, 44, 34, 0.14)"]}
          locations={[0, 0.35, 1]}
          style={styles.scrim}
        >
          {/* Omit bottom safe-area: IME inset changes remount children and dismiss keyboard on Android. */}
          <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
            {Platform.OS === "ios" ? (
              <KeyboardAvoidingView style={styles.flex} behavior="padding">
                <LoginScroll formMaxWidth={formMaxWidth}>{form}</LoginScroll>
              </KeyboardAvoidingView>
            ) : (
              <LoginScroll formMaxWidth={formMaxWidth}>{form}</LoginScroll>
            )}
          </SafeAreaView>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

function LoginScroll({
  formMaxWidth,
  children,
}: {
  formMaxWidth: number;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      removeClippedSubviews={false}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.column, { maxWidth: formMaxWidth }]} collapsable={false}>
        {children}
      </View>
    </ScrollView>
  );
}

function LoginForm({
  control,
  remember,
  setRemember,
  error,
  loading,
  onSubmit,
  passwordRef,
}: {
  control: Control<FormValues>;
  remember: boolean;
  setRemember: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  loading: boolean;
  onSubmit: () => void;
  passwordRef: RefObject<TextInput | null>;
}) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.logoGlow} collapsable={false}>
          <BrandLogo size={76} />
        </View>
        <Text style={styles.brand} accessibilityRole="header">
          PoultryTrack
        </Text>
        <Text style={styles.tagline}>Farm health, made simple.</Text>
      </View>

      <View style={styles.intro}>
        <Text style={styles.headline}>Smarter Farms. Healthier Flocks.</Text>
        <Text style={styles.introBody}>
          Manage sheds, bird records, and flock health monitoring in one place — for
          every life stage on your farm.
        </Text>
      </View>

      <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />

      <View style={[styles.card, shadows.card]} collapsable={false}>
        <TextField
          control={control}
          name="email"
          label="Email"
          placeholder="you@farm.com"
          keyboardType="email-address"
          leftIcon="mail-outline"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <TextField
          control={control}
          name="password"
          label="Password"
          placeholder="••••••••"
          secureTextEntry
          leftIcon="lock-closed-outline"
          inputRef={passwordRef}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        <View style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: remember }}
            accessibilityLabel="Remember me"
            onPress={() => setRemember((v) => !v)}
            style={styles.remember}
            hitSlop={6}
          >
            <View style={[styles.checkbox, remember && styles.checkboxOn]}>
              {remember ? (
                <Ionicons name="checkmark" size={icons.sm} color={colors.textOnPrimary} />
              ) : null}
            </View>
            <Text style={styles.rememberLabel}>Remember me</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Forgot password"
            hitSlop={8}
            onPress={() => {
              /* UI only — password reset API is not wired yet */
            }}
          >
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button label="Sign In" onPress={onSubmit} loading={loading} disabled={loading} />
      </View>

      <View style={styles.footerBlock}>
        <Text style={styles.footer}>
          Don’t have an account?{" "}
          <Link href="/(auth)/register" style={styles.link}>
            Create Farm Account
          </Link>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Contact Admin"
          hitSlop={8}
          onPress={() => {
            /* UI only — no support channel wired yet */
          }}
        >
          <Text style={styles.contact}>Need access? Contact Admin</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundFallback },
  bg: { flex: 1 },
  bgImage: { width: "100%", height: "100%" },
  scrim: { flex: 1 },
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "flex-start",
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.xl,
    alignItems: "center",
  },
  column: { width: "100%", gap: space.md },
  header: { alignItems: "center", gap: space.xs },
  logoGlow: {
    borderRadius: 40,
    padding: 4,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  brand: {
    ...typography.display,
    color: colors.textOnDark,
    marginTop: space.xs,
    textShadowColor: "rgba(2, 44, 34, 0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  tagline: {
    ...typography.caption,
    color: colors.textOnDarkMuted,
    fontWeight: "600",
  },
  intro: { alignItems: "center", gap: space.xs, marginBottom: space.xs },
  headline: {
    ...typography.title,
    color: colors.textOnDark,
    textAlign: "center",
    textShadowColor: "rgba(2, 44, 34, 0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  introBody: {
    ...typography.caption,
    color: colors.textOnDarkSecondary,
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: space.sm,
  },
  divider: {
    alignSelf: "center",
    width: 56,
    height: 1,
    backgroundColor: colors.dividerOnDark,
    marginVertical: space.xs,
  },
  card: {
    backgroundColor: colors.surfaceTranslucent,
    borderRadius: radius.card,
    paddingHorizontal: 24,
    paddingVertical: 26,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: layout.touchTarget * 0.75,
  },
  remember: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.checkboxOff,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkboxOn: {
    backgroundColor: colors.checkboxOn,
    borderColor: colors.checkboxOn,
  },
  rememberLabel: { color: colors.textFormLabel, fontSize: 14, fontWeight: "500" },
  forgot: { color: colors.textLink, fontWeight: "700", fontSize: 14 },
  error: { color: colors.error, fontSize: 14 },
  footerBlock: { alignItems: "center", gap: space.sm, marginTop: space.xs },
  footer: { color: colors.textOnDarkMuted, fontSize: 15, textAlign: "center" },
  link: { color: colors.mintHighlight, fontWeight: "700" },
  contact: {
    color: colors.textOnDarkSecondary,
    fontSize: 13,
    textAlign: "center",
    fontWeight: "500",
  },
});
