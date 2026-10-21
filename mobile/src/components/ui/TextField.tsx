import Ionicons from "@expo/vector-icons/Ionicons";
import { ComponentProps, Ref, useState } from "react";
import { Control, Controller, FieldPath, FieldValues } from "react-hook-form";
import {
  Platform,
  Pressable,
  ReturnKeyTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, icons, layout, radius, space, typography } from "../../theme/tokens";

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
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  inputRef?: Ref<TextInput>;
};

/**
 * Shared form text input.
 *
 * Android notes (physical devices + New Architecture):
 * - Never call setState in onFocus/onBlur to restyle the wrapper — that remounts
 *   the TextInput and the soft keyboard opens then closes immediately.
 * - Keep the field wrapper `collapsable={false}` so focus-time layout diffs do
 *   not remove/insert the native TextInput.
 */
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  secureTextEntry,
  autoCapitalize = "none",
  keyboardType = "default",
  leftIcon,
  returnKeyType,
  onSubmitEditing,
  inputRef,
}: Props<T>) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const isPassword = Boolean(secureTextEntry);
  const showFocusChrome = Platform.OS === "ios" && focused;
  const autoComplete = isPassword ? "password" : keyboardType === "email-address" ? "email" : "off";

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <View style={styles.wrap} collapsable={false}>
          <Text style={styles.label}>{label}</Text>
          <View
            collapsable={false}
            style={[
              styles.field,
              showFocusChrome && !error ? styles.fieldFocused : null,
              error ? styles.fieldError : null,
            ]}
          >
            {leftIcon ? (
              <Ionicons
                name={leftIcon}
                size={icons.md}
                color={showFocusChrome ? icons.colorActive : icons.color}
                style={styles.leftIcon}
              />
            ) : null}
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={value}
              onChangeText={onChange}
              onBlur={() => {
                if (Platform.OS === "ios") setFocused(false);
                onBlur();
              }}
              onFocus={() => {
                if (Platform.OS === "ios") setFocused(true);
              }}
              placeholder={placeholder}
              placeholderTextColor={colors.textPlaceholder}
              secureTextEntry={isPassword && !visible}
              autoCapitalize={autoCapitalize}
              keyboardType={keyboardType}
              autoComplete={autoComplete}
              autoCorrect={false}
              spellCheck={false}
              blurOnSubmit={false}
              returnKeyType={returnKeyType}
              onSubmitEditing={onSubmitEditing}
              selectionColor={colors.secondary}
              cursorColor={colors.secondary}
              underlineColorAndroid="transparent"
              importantForAutofill="yes"
            />
            {isPassword ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={visible ? "Hide password" : "Show password"}
                hitSlop={10}
                onPress={() => setVisible((v) => !v)}
                style={styles.eye}
              >
                <Ionicons
                  name={visible ? "eye-off-outline" : "eye-outline"}
                  size={icons.lg}
                  color={icons.color}
                />
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
  label: { color: colors.textFormLabel, ...typography.label },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: layout.inputMinHeight,
  },
  fieldFocused: {
    borderColor: colors.borderFocus,
    backgroundColor: colors.surface,
    shadowColor: colors.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  fieldError: { borderColor: colors.error },
  leftIcon: { marginRight: space.sm },
  input: {
    flex: 1,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontSize: 16,
  },
  eye: { paddingLeft: space.sm, paddingVertical: 8, minWidth: layout.touchTarget / 2 },
  error: { color: colors.error, fontSize: typography.caption.fontSize },
});
