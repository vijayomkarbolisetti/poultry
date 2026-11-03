import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { scrollFocusedInputIntoView } from "./scrollFocusedInputIntoView";
import { useKeyboardBottomInset } from "./useKeyboardBottomInset";

export type FormBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Scrollable form fields. Ignored when `body` is provided. */
  children?: ReactNode;
  /** Sticky header above the scroll body (handle, title row, etc.). */
  header?: ReactNode;
  /** Sticky footer below the scroll body (Confirm / Cancel). Stays above the keyboard. */
  footer?: ReactNode;
  /** Optional body when the sheet is not using the default ScrollView (e.g. custom picker). */
  body?: ReactNode;
  /** Extra styles for the white sheet container. */
  sheetStyle?: StyleProp<ViewStyle>;
  /** Extra styles for ScrollView content container. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Scrim accessibility label. */
  dismissAccessibilityLabel?: string;
  /**
   * When true (default), tapping the dimmed scrim closes the sheet.
   * If the keyboard is open, the first tap only dismisses the keyboard.
   */
  dismissOnScrimPress?: boolean;
  statusBarTranslucent?: boolean;
  /** Max sheet height as a fraction of the window (default 0.92). */
  maxHeightFraction?: number;
  /** Forwarded ScrollView ref when using default body scrolling. */
  scrollRef?: RefObject<ScrollView | null>;
  testID?: string;
};

/**
 * Shared keyboard-aware bottom sheet for forms inside transparent Modals.
 *
 * Why this exists: Android `softwareKeyboardLayoutMode: "pan"` does not resize
 * Modal windows, so fields and footers get covered unless the sheet lifts itself
 * using the live keyboard inset and keeps content scrollable.
 */
export function FormBottomSheet({
  visible,
  onClose,
  children,
  header,
  footer,
  body,
  sheetStyle,
  contentContainerStyle,
  dismissAccessibilityLabel = "Dismiss",
  dismissOnScrimPress = true,
  statusBarTranslucent = true,
  maxHeightFraction = 0.92,
  scrollRef: scrollRefProp,
  testID,
}: FormBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardBottomInset(visible);
  const internalScrollRef = useRef<ScrollView>(null);
  const scrollRef = scrollRefProp ?? internalScrollRef;
  const keyboardOpen = keyboardHeight > 0;

  useEffect(() => {
    if (!visible || !keyboardOpen || body != null) return;
    const t = setTimeout(() => scrollFocusedInputIntoView(scrollRef), 60);
    return () => clearTimeout(t);
  }, [visible, keyboardOpen, keyboardHeight, body, scrollRef]);

  const closeOrDismissKeyboard = () => {
    if (keyboardOpen) {
      Keyboard.dismiss();
      return;
    }
    if (dismissOnScrimPress) onClose();
  };

  const safePad = keyboardOpen ? 12 : Math.max(insets.bottom, 16) + 8;
  // Keep sheet + keyboard within the window (percentage maxHeight + marginBottom can overflow).
  const windowHeight = Dimensions.get("window").height;
  const maxSheetHeight = Math.max(
    240,
    Math.round((windowHeight - keyboardHeight) * maxHeightFraction),
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent={statusBarTranslucent}
      onRequestClose={() => {
        if (keyboardOpen) {
          Keyboard.dismiss();
          return;
        }
        onClose();
      }}
      testID={testID}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // Android lift is handled via keyboardHeight margin — KAV would double-count.
        keyboardVerticalOffset={0}
      >
        <View style={styles.root}>
          <Pressable
            style={styles.dismissArea}
            onPress={closeOrDismissKeyboard}
            accessibilityLabel={dismissAccessibilityLabel}
          />
          <View
            style={[
              styles.sheet,
              {
                maxHeight: maxSheetHeight,
                marginBottom: keyboardHeight,
                paddingBottom: safePad,
              },
              sheetStyle,
            ]}
          >
            {header}
            {body != null ? (
              <View style={styles.customBody}>{body}</View>
            ) : (
              <ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                {children}
              </ScrollView>
            )}
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2, 44, 34, 0.35)",
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    gap: 10,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  customBody: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 8,
    flexGrow: 1,
  },
  footer: {
    gap: 10,
  },
});
