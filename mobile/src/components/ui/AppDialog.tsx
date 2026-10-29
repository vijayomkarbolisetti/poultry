import Ionicons from "@expo/vector-icons/Ionicons";
import { ReactNode, useEffect } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, space } from "../../theme/tokens";

export type AppDialogTone = "neutral" | "success" | "warning" | "danger" | "info";

export type AppDialogAction = {
  label: string;
  onPress: () => void;
  /** Visual emphasis — primary fills, secondary outlines, destructive uses danger. */
  variant?: "primary" | "secondary" | "destructive";
  loading?: boolean;
  disabled?: boolean;
};

type Props = {
  visible: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  tone?: AppDialogTone;
  icon?: keyof typeof Ionicons.glyphMap;
  primary?: AppDialogAction;
  secondary?: AppDialogAction;
  /** When true, Android back / backdrop dismiss calls onDismiss (if provided). */
  dismissible?: boolean;
  onDismiss?: () => void;
};

const TONE_ICON: Record<AppDialogTone, keyof typeof Ionicons.glyphMap> = {
  neutral: "help-circle-outline",
  success: "checkmark-circle",
  warning: "warning-outline",
  danger: "alert-circle-outline",
  info: "information-circle-outline",
};

const TONE_COLOR: Record<AppDialogTone, string> = {
  neutral: colors.primary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
};

/**
 * Themed confirmation / info dialog. Prefer for blocking confirms;
 * keep existing sheets/pickers for multi-step flows.
 */
export function AppDialog({
  visible,
  title,
  description,
  children,
  tone = "neutral",
  icon,
  primary,
  secondary,
  dismissible = true,
  onDismiss,
}: Props) {
  const insets = useSafeAreaInsets();
  const iconName = icon ?? TONE_ICON[tone];
  const iconColor = TONE_COLOR[tone];

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (dismissible && onDismiss) {
        onDismiss();
        return true;
      }
      return true; // consume back while open so underlying screen does not pop
    });
    return () => sub.remove();
  }, [visible, dismissible, onDismiss]);

  const busy = Boolean(primary?.loading || secondary?.loading);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (dismissible && onDismiss) onDismiss();
      }}
      statusBarTranslucent
    >
      <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable
          style={styles.scrim}
          onPress={() => {
            if (dismissible && !busy && onDismiss) onDismiss();
          }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss dialog"
        />
        <View
          style={styles.card}
          accessibilityViewIsModal
          accessibilityRole="summary"
          accessibilityLabel={title}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${iconColor}18` }]}>
            <Ionicons name={iconName} size={26} color={iconColor} />
          </View>
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
          {children}

          <View style={styles.actions}>
            {secondary ? (
              <DialogButton
                action={secondary}
                busy={busy}
                fallbackVariant="secondary"
              />
            ) : null}
            {primary ? (
              <DialogButton action={primary} busy={busy} fallbackVariant="primary" />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DialogButton({
  action,
  busy,
  fallbackVariant,
}: {
  action: AppDialogAction;
  busy: boolean;
  fallbackVariant: NonNullable<AppDialogAction["variant"]>;
}) {
  const variant = action.variant ?? fallbackVariant;
  const disabled = Boolean(action.disabled || busy || action.loading);
  const isPrimary = variant === "primary";
  const isDestructive = variant === "destructive";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled, busy: Boolean(action.loading) }}
      disabled={disabled}
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.btn,
        isPrimary && styles.btnPrimary,
        variant === "secondary" && styles.btnSecondary,
        isDestructive && styles.btnDestructive,
        pressed && !disabled && styles.btnPressed,
        disabled && styles.btnDisabled,
      ]}
    >
      {action.loading ? (
        <ActivityIndicator
          color={isPrimary || isDestructive ? colors.textOnPrimary : colors.primary}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.btnLabel,
            (isPrimary || isDestructive) && styles.btnLabelOnFill,
            variant === "secondary" && styles.btnLabelSecondary,
          ]}
        >
          {action.label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: space.lg,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(2, 44, 34, 0.42)",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 8,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: space.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.ink,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  description: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkMuted,
    textAlign: "center",
    fontWeight: "500",
  },
  actions: {
    marginTop: space.lg,
    gap: 10,
  },
  btn: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  btnDestructive: { backgroundColor: colors.danger },
  btnPressed: { opacity: 0.9 },
  btnDisabled: { opacity: 0.55 },
  btnLabel: { fontSize: 16, fontWeight: "700" },
  btnLabelOnFill: { color: colors.textOnPrimary },
  btnLabelSecondary: { color: colors.primary },
});
