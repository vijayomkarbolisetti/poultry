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
import { loginBackgroundArt } from "../../src/theme/media";
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
        source={loginBackgroundArt}
        style={styles.bg}
        resizeMode="cover"
        imageStyle={styles.bgImage}
        accessibilityIgnoresInvertColors
      >
        {/* Soft wash keeps mint scenery visible while protecting deep-green type + white card. */}
        <LinearGradient
          colors={[
            "rgba(242, 248, 245, 0.42)",
            "rgba(242, 248, 245, 0.12)",
            "rgba(6, 78, 59, 0.18)",
          ]}
          locations={[0, 0.45, 1]}
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
          <BrandLogo size={64} />
        </View>
        <Text style={styles.brand} accessibilityRole="header">
          PoultryTrack
        </Text>
        <Text style={styles.tagline}>Farm health, made simple.</Text>
      </View>

      <View style={[styles.card, shadows.card]} collapsable={false}>
        <View style={styles.cardIntro}>
          <Text style={styles.headline}>Welcome back</Text>
          <Text style={styles.introBody}>
            Sign in to manage sheds, birds, and vaccination tasks for your farm.
          </Text>
        </View>

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

      <View style={[styles.footerBlock, shadows.soft]}>
        <Text style={styles.footer}>
          Don’t have an account?{" "}
          <Link href="/(auth)/register" style={styles.link}>
            Create Farm Account
          </Link>
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Contact Admin"
          hitSlop={10}
          onPress={() => {
            /* UI only — no support channel wired yet */
          }}
          style={styles.contactPress}
        >
          <Text style={styles.contact}>
            Need access? <Text style={styles.contactLink}>Contact Admin</Text>
          </Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.backgroundFallback },
  bg: { flex: 1 },
  // Cover fill — avoid width/height percentage hacks that leave edge strips on Android.
  bgImage: { resizeMode: "cover" },
  scrim: { flex: 1 },
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    alignItems: "center",
  },
  column: { width: "100%", gap: space.md },
  header: { alignItems: "center", gap: space.xs, marginBottom: space.xs },
  logoGlow: {
    borderRadius: 36,
    padding: 6,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.9)",
  },
  brand: {
    ...typography.display,
    color: colors.brandDark,
    marginTop: space.xs,
  },
  tagline: {
    ...typography.caption,
    color: colors.brand,
    fontWeight: "700",
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: radius.card,
    paddingHorizontal: 22,
    paddingVertical: 24,
    gap: space.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.95)",
  },
  cardIntro: { gap: 6, marginBottom: 2 },
  headline: {
    ...typography.heading,
    color: colors.ink,
  },
  introBody: {
    ...typography.caption,
    color: colors.inkMuted,
    lineHeight: 20,
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
  footerBlock: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(215, 228, 222, 0.95)",
  },
  footer: {
    color: colors.brandDark,
    fontSize: 15,
    textAlign: "center",
    fontWeight: "700",
    lineHeight: 22,
  },
  link: { color: colors.brand, fontWeight: "800" },
  contactPress: {
    minHeight: layout.touchTarget * 0.75,
    justifyContent: "center",
    paddingHorizontal: space.xs,
  },
  contact: {
    color: "#4A5F56",
    fontSize: 13,
    textAlign: "center",
    fontWeight: "600",
    lineHeight: 18,
  },
  contactLink: {
    color: colors.brandDark,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
});
