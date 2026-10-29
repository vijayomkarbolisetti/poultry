import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toast, type ToastPayload, type ToastTone } from "../../ui/toast/toastStore";
import { radius, space } from "../../theme/tokens";

/** Tab bar height in app/(app)/_layout — keep toast above it when present. */
const TAB_BAR_CLEARANCE = 72;

const TONE_UI: Record<
  ToastTone,
  { bg: string; border: string; text: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  success: {
    bg: "#E8F8F0",
    border: "#A7E3C5",
    text: "#176B45",
    icon: "checkmark-circle",
  },
  error: {
    bg: "#FEECEC",
    border: "#F5C2C0",
    text: "#B91C1C",
    icon: "alert-circle",
  },
  warning: {
    bg: "#FFF6E8",
    border: "#F5D9A8",
    text: "#9A5B12",
    icon: "warning",
  },
  info: {
    bg: "#EAF2FF",
    border: "#BFD3F5",
    text: "#1D4ED8",
    icon: "information-circle",
  },
};

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [display, setDisplay] = useState<ToastPayload | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return toast.subscribe((next) => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (!next) {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 16, duration: 160, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) setDisplay(null);
        });
        return;
      }
      setDisplay(next);
      opacity.setValue(0);
      translateY.setValue(16);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
      hideTimer.current = setTimeout(() => toast.hide(), next.durationMs);
    });
  }, [opacity, translateY]);

  if (!display) return null;

  const bottom = Math.max(insets.bottom, 8) + TAB_BAR_CLEARANCE;
  const tone = TONE_UI[display.tone];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.wrap,
          {
            bottom,
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={display.message}
          accessibilityLiveRegion="polite"
          onPress={() => toast.hide()}
          style={[styles.pill, { backgroundColor: tone.bg, borderColor: tone.border }]}
        >
          <Ionicons name={tone.icon} size={18} color={tone.text} style={styles.icon} />
          <Text style={[styles.text, { color: tone.text }]} numberOfLines={3}>
            {display.message}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 16,
    right: 16,
    alignItems: "center",
    zIndex: 9999,
    elevation: 24,
  },
  pill: {
    maxWidth: 420,
    width: "100%",
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  icon: { marginTop: 1 },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
  },
});
