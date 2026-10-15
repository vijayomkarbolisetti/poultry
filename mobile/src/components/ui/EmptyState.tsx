import { Image, StyleSheet, Text, View } from "react-native";

import { colors, radius, shadow, space } from "../../theme/tokens";
import { Button } from "./Button";

type Props = {
  title: string;
  body: string;
  imageUri: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, body, imageUri, actionLabel, onAction }: Props) {
  return (
    <View style={[styles.wrap, shadow.card]}>
      <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
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
  image: { width: "100%", height: 160 },
  copy: { padding: space.lg, gap: space.sm },
  title: { fontSize: 18, fontWeight: "800", color: colors.ink },
  body: { fontSize: 14, color: colors.inkMuted, lineHeight: 20, marginBottom: space.xs },
});
