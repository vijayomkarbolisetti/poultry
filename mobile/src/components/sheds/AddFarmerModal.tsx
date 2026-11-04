import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { z } from "zod";

import { createFarmer, type Farmer } from "../../api/farmers";
import { describeApiError } from "../../api/client";
import { DEFAULT_FARMER_PERMS } from "../../features/auth/permissions";
import { Button } from "../ui/Button";
import { FormBottomSheet } from "../ui/FormBottomSheet";
import { TextField } from "../ui/TextField";
import { colors, radius, space, typography } from "../../theme/tokens";
import { toast } from "../../ui/toast/toastStore";

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
 * Keyboard avoidance comes from FormBottomSheet (Android pan mode covers bare Modals).
 */
export function AddFarmerModal({ visible, onClose, onCreated }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const { control, handleSubmit, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: "" },
  });

  const close = () => {
    if (loading || submitting.current) return;
    Keyboard.dismiss();
    setError(null);
    reset();
    onClose();
  };

  const submitFarmer = async (values: FormValues) => {
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
      toast.success("Farmer added");
      onCreated(farmer);
    } catch (e: unknown) {
      setError(describeApiError(e, "add the farmer"));
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  return (
    <FormBottomSheet
      visible={visible}
      onClose={close}
      dismissAccessibilityLabel="Dismiss"
      sheetStyle={styles.sheet}
      header={
        <View style={styles.header}>
          <Text style={styles.title}>Add farmer</Text>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close">
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
      }
      footer={
        <View style={styles.footerPad}>
          <Button
            label="Create farmer"
            onPress={() => {
              void handleSubmit(submitFarmer)();
            }}
            loading={loading}
          />
        </View>
      }
      contentContainerStyle={styles.body}
    >
      <Text style={styles.hint}>
        Create a farmer login for this organization. You can assign sheds and adjust permissions
        later.
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
    </FormBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
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
  title: { fontSize: typography.screenTitle.fontSize, fontWeight: "800", color: colors.brand },
  close: { fontSize: typography.body.fontSize, fontWeight: "600", color: colors.inkMuted },
  body: { paddingHorizontal: space.md, gap: space.sm, paddingBottom: space.md },
  footerPad: { paddingHorizontal: space.md },
  hint: { color: colors.inkMuted, fontSize: typography.secondary.fontSize, lineHeight: 20 },
  error: { color: colors.danger, fontSize: typography.label.fontSize },
});
