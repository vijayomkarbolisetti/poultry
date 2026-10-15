import Ionicons from "@expo/vector-icons/Ionicons";
import { ComponentProps, useState } from "react";
import { Control, Controller, FieldPath, FieldValues } from "react-hook-form";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, space } from "../../theme/tokens";

type IconName = ComponentProps<typeof Ionicons>["name"];

type Props<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address";
  leftIcon?: IconName;
};

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  secureTextEntry,
  autoCapitalize = "none",
  keyboardType = "default",
  leftIcon,
}: Props<T>) {
  const [visible, setVisible] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <View style={styles.wrap}>
          <Text style={styles.label}>{label}</Text>
          <View style={[styles.field, error ? styles.fieldError : null]}>
            {leftIcon ? <Ionicons name={leftIcon} size={20} color={colors.inkMuted} style={styles.leftIcon} /> : null}
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder={placeholder}
              placeholderTextColor={colors.inkMuted}
              secureTextEntry={isPassword && !visible}
              autoCapitalize={autoCapitalize}
              keyboardType={keyboardType}
              autoCorrect={false}
            />
            {isPassword ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={visible ? "Hide password" : "Show password"}
                hitSlop={10}
                onPress={() => setVisible((v) => !v)}
                style={styles.eye}
              >
                <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={22} color={colors.inkMuted} />
              </Pressable>
            ) : null}
          </View>
          {error?.message ? <Text style={styles.error}>{error.message}</Text> : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 52,
  },
  fieldError: { borderColor: colors.danger },
  leftIcon: { marginRight: space.sm },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: colors.ink,
    fontSize: 16,
  },
  eye: { paddingLeft: space.sm, paddingVertical: 8 },
  error: { color: colors.danger, fontSize: 13 },
});
