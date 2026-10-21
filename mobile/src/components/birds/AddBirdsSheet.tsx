import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { birdUi } from "../../theme/birdManagementUi";

type Props = {
  visible: boolean;
  shedName: string;
  shedActive: boolean;
  canCreateGroup: boolean;
  canTagBirds: boolean;
  onClose: () => void;
  onAddUnbanded: () => void;
  onRegisterBanded: () => void;
};

export function AddBirdsSheet({
  visible,
  shedName,
  shedActive,
  canCreateGroup,
  canTagBirds,
  onClose,
  onAddUnbanded,
  onRegisterBanded,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close add birds">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>
              Add birds to {shedName}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={birdUi.muted} />
            </Pressable>
          </View>

          {!shedActive ? (
            <Text style={styles.warn}>This shed is inactive. Reactivate it before adding birds.</Text>
          ) : null}

          {canTagBirds && shedActive ? (
            <Pressable
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              onPress={onRegisterBanded}
              accessibilityRole="button"
              accessibilityLabel="Register banded bird"
            >
              <View style={[styles.iconCircle, { backgroundColor: birdUi.orangePale }]}>
                <Ionicons name="pricetag-outline" size={22} color={birdUi.orange} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Register banded bird</Text>
                <Text style={styles.optionSub}>
                  Add an individually identified bird with a band number and hatch date
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
            </Pressable>
          ) : null}

          {canCreateGroup && shedActive ? (
            <Pressable
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              onPress={onAddUnbanded}
              accessibilityRole="button"
              accessibilityLabel="Add unbanded birds"
            >
              <View style={[styles.iconCircle, { backgroundColor: birdUi.iconCircle }]}>
                <Ionicons name="people-outline" size={22} color={birdUi.primary} />
              </View>
              <View style={styles.optionText}>
                <Text style={styles.optionTitle}>Add unbanded birds</Text>
                <Text style={styles.optionSub}>
                  Record a headcount with an exact hatch date (no individual band numbers)
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={birdUi.muted} />
            </Pressable>
          ) : null}
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
    gap: 10,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: birdUi.divider,
    marginBottom: 6,
  },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    color: birdUi.text,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: birdUi.paleMint,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: birdUi.white,
    borderWidth: 1,
    borderColor: birdUi.border,
    borderRadius: birdUi.cardRadius,
    padding: 14,
  },
  optionPressed: { opacity: 0.92, backgroundColor: birdUi.paleMint },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 16, fontWeight: "700", color: birdUi.text },
  optionSub: { fontSize: 13, color: birdUi.muted, lineHeight: 18 },
  warn: {
    color: birdUi.orange,
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: birdUi.orangePale,
    padding: 10,
    borderRadius: 12,
  },
});
