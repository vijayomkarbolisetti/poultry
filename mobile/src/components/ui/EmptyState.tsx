import {
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, radius, shadow, space, typography } from "../../theme/tokens";
import { Button } from "./Button";

type Props = {
  title: string;
  body: string;
  /** Remote URL (legacy empty states). Prefer `imageSource` for bundled assets. */
  imageUri?: string;
  /** Local require() / bundled asset. Takes precedence over `imageUri`. */
  imageSource?: ImageSourcePropType;
  actionLabel?: string;
  onAction?: () => void;
  /** `compact` = small illustration well; default keeps full-bleed photo card. */
  variant?: "default" | "compact";
};

export function EmptyState({
  title,
  body,
  imageUri,
  imageSource,
  actionLabel,
  onAction,
  variant = "default",
}: Props) {
  const source = imageSource ?? (imageUri ? { uri: imageUri } : undefined);
  const compact = variant === "compact";

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, shadow.card]}>
      {source ? (
        compact ? (
          <View style={styles.illustrationWell} accessibilityElementsHidden>
            <Image source={source} style={styles.illustration} resizeMode="contain" />
          </View>
        ) : (
          <Image source={source} style={styles.image} resizeMode="cover" />
        )
      ) : null}
      <View style={[styles.copy, compact && styles.copyCompact]}>
        <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
        <Text style={[styles.body, compact && styles.bodyCompact]}>{body}</Text>
        {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginTop: space.sm,
  },
  wrapCompact: {
    borderRadius: radius.md,
    marginTop: space.md,
  },
  image: { width: "100%", height: 160 },
  illustrationWell: {
    alignSelf: "center",
    marginTop: space.lg,
    width: 112,
    height: 88,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.borderMuted,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  illustration: {
    width: "100%",
    height: "100%",
  },
  copy: { padding: space.lg, gap: space.sm },
  copyCompact: {
    paddingTop: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    alignItems: "stretch",
  },
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: colors.ink },
  titleCompact: {
    fontSize: typography.sectionTitle.fontSize,
    lineHeight: typography.sectionTitle.lineHeight,
    textAlign: "center",
  },
  body: {
    fontSize: typography.label.fontSize,
    color: colors.inkMuted,
    lineHeight: 20,
    marginBottom: space.xs,
  },
  bodyCompact: {
    textAlign: "center",
    alignSelf: "center",
    maxWidth: 320,
  },
});
