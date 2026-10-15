import Ionicons from "@expo/vector-icons/Ionicons";
import { ComponentProps, ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, shadow, space } from "../../theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

type Props = {
  title: string;
  subtitle?: string;
  meta?: string;
  imageUri?: string;
  icon?: IconName;
  badge?: string;
  badgeTone?: "good" | "warn" | "danger" | "neutral";
  onPress?: () => void;
  footer?: ReactNode;
};

export function MediaCard({
  title,
  subtitle,
  meta,
  imageUri,
  icon = "egg-outline",
  badge,
  badgeTone = "good",
  onPress,
  footer,
}: Props) {
  const badgeColor =
    badgeTone === "danger"
      ? colors.danger
      : badgeTone === "warn"
        ? colors.accent
        : badgeTone === "neutral"
          ? colors.inkMuted
          : colors.brand;

  const body = (
    <View style={[styles.card, shadow.card]}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.thumb} />
      ) : (
        <View style={styles.thumbFallback}>
          <Ionicons name={icon} size={22} color={colors.brand} />
        </View>
      )}
      <View style={styles.content}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: `${badgeColor}1A` }]}>
              <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {footer}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.92 }}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: space.md,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    alignItems: "center",
  },
  thumb: { width: 64, height: 64, borderRadius: 16 },
  thumbFallback: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, gap: 3 },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { flex: 1, fontSize: 16, fontWeight: "800", color: colors.ink },
  subtitle: { fontSize: 13, color: colors.inkMuted, fontWeight: "600" },
  meta: { fontSize: 12, color: colors.inkMuted },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontSize: 11, fontWeight: "800" },
});
