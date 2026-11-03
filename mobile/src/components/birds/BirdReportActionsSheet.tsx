import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { birdUi } from "../../theme/birdManagementUi";
import { typography } from "../../theme/tokens";

type Props = {
  visible: boolean;
  busy?: boolean;
  onClose: () => void;
  onDownload: () => void;
  onShare: () => void;
};

/**
 * Compact bottom sheet for bird profile PDF: Download or Share.
 * Matches AddBirdsSheet / lifecycle sheet patterns (scrim dismiss + X).
 */
export function BirdReportActionsSheet({
  visible,
  busy = false,
  onClose,
  onDownload,
  onShare,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <Pressable
        style={styles.scrim}
        onPress={() => {
          if (!busy) onClose();
        }}
        accessibilityLabel="Close report options"
      >
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>Bird report</Text>
            <Pressable
              onPress={() => {
                if (!busy) onClose();
              }}
              disabled={busy}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.closeBtn, busy && { opacity: 0.45 }]}
            >
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>
          <Text style={styles.sub}>Export this bird’s profile as a PDF</Text>

          <Pressable
            style={({ pressed }) => [
              styles.option,
              pressed && !busy && styles.optionPressed,
              busy && styles.optionDisabled,
            ]}
            onPress={onDownload}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Download report"
            accessibilityState={{ disabled: busy }}
          >
            <View style={[styles.iconCircle, { backgroundColor: birdUi.paleMint }]}>
              {busy ? (
                <ActivityIndicator size="small" color={birdUi.primary} />
              ) : (
                <Ionicons name="download-outline" size={22} color={birdUi.primary} />
              )}
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Download</Text>
              <Text style={styles.optionSub}>Choose a folder and save the PDF</Text>
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.option,
              pressed && !busy && styles.optionPressed,
              busy && styles.optionDisabled,
            ]}
            onPress={onShare}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Share report"
            accessibilityState={{ disabled: busy }}
          >
            <View style={[styles.iconCircle, { backgroundColor: birdUi.bluePale }]}>
              <Ionicons name="share-social-outline" size={22} color={birdUi.blue} />
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Share</Text>
              <Text style={styles.optionSub}>Open Android’s share sheet</Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(2, 44, 34, 0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: birdUi.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: birdUi.horizontal,
    paddingTop: 10,
    gap: 8,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: birdUi.border,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: birdUi.text,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sub: {
    fontSize: typography.caption.fontSize,
    color: birdUi.muted,
    fontWeight: "600",
    marginBottom: 4,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: birdUi.border,
    backgroundColor: birdUi.bg,
  },
  optionPressed: { opacity: 0.92, backgroundColor: birdUi.paleMint },
  optionDisabled: { opacity: 0.55 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "800",
    color: birdUi.text,
  },
  optionSub: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: birdUi.muted,
  },
});
