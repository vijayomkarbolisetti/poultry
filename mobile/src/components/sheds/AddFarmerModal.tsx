import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
  "vaccination.view",
  "vaccination.record",
  "schedule.view",
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Add farmer</Text>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: space.lg,
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
  body: { padding: space.md, gap: space.sm },
  hint: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14 },
});
