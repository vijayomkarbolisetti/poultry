import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";

import { createFarmer, type Farmer } from "../../api/farmers";
import { describeApiError } from "../../api/client";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { colors, radius, space } from "../../theme/tokens";

const DEFAULT_FARMER_PERMS = [
  "shed.view",
  "flock.view",
  "bird.view",
  "report.view",
];

const schema = z.object({
  full_name: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (farmer: Farmer) => void;
};

/**
 * Nested farmer creation for New Shed — reuses createFarmer API without navigating away.
 * Keyboard height is applied explicitly because Android `pan` mode covers Modal sheets.
 */
export function AddFarmerModal({ visible, onClose, onCreated }: Props) {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const submitting = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const { control, handleSubmit, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: "" },
  });

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      // Keep fields / submit above the keyboard after layout.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
    });
    const onHide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [visible]);

  const close = () => {
    if (loading || submitting.current) return;
    Keyboard.dismiss();
    setError(null);
    reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    if (submitting.current || loading) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const farmer = await createFarmer({
        ...values,
        role: "farmer",
        permission_codes: DEFAULT_FARMER_PERMS,
        shed_ids: [],
      });
      reset();
      onCreated(farmer);
    } catch (e: unknown) {
      setError(describeApiError(e, "add the farmer"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  });

  const bottomPad = Math.max(insets.bottom, space.md) + (keyboardHeight > 0 ? keyboardHeight : 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.backdrop}>
          <Pressable style={styles.dismissArea} onPress={close} accessibilityLabel="Dismiss" />
          <View style={[styles.sheet, { paddingBottom: bottomPad }]}>
            <View style={styles.header}>
              <Text style={styles.title}>Add farmer</Text>
              <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.close}>Close</Text>
              </Pressable>
            </View>
            <ScrollView
              ref={scrollRef}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.hint}>
                Create a farmer login for this organization. You can assign sheds and adjust
                permissions later.
              </Text>
              <TextField
                control={control}
                name="full_name"
                label="Full name"
                autoCapitalize="words"
                leftIcon="person-outline"
              />
              <TextField
                control={control}
                name="email"
                label="Email"
                keyboardType="email-address"
                leftIcon="mail-outline"
                autoCapitalize="none"
              />
              <TextField
                control={control}
                name="password"
                label="Temp password"
                secureTextEntry
                leftIcon="lock-closed-outline"
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button label="Create farmer" onPress={onSubmit} loading={loading} />
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  dismissArea: { flex: 1 },
  sheet: {
    maxHeight: "92%",
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.brand },
  close: { fontSize: 15, fontWeight: "600", color: colors.inkMuted },
  body: { padding: space.md, gap: space.sm, paddingBottom: space.xl },
  hint: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14 },
});
