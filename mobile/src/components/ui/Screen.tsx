import { ReactNode } from "react";
import { ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { Edge, SafeAreaView } from "react-native-safe-area-context";

import { colors, space } from "../../theme/tokens";

type Props = {
  children: ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  /** Navigation headers/tab bars already pad top/bottom; pass "top" only on header-less screens. */
  edges?: Edge[];
};

export function Screen({ children, scroll, style, edges = ["left", "right"] }: Props) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, style]}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      removeClippedSubviews={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, padding: space.lg, gap: space.md },
});
