import { Image, ImageStyle, StyleProp, View, ViewStyle } from "react-native";

type Props = {
  /** Rendered size (square mark). */
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Kept for call-site compatibility; logo is always the PNG brand mark. */
  preferPng?: boolean;
  accessibilityLabel?: string;
};

/**
 * Canonical PoultryTrack brand mark from `assets/brand-logo.png`
 * (sourced from `assets/android/play_store_512.png`).
 */
export function BrandLogo({
  size = 64,
  style,
  accessibilityLabel = "PoultryTrack",
}: Props) {
  const wrapStyle: StyleProp<ViewStyle> = [{ width: size, height: size }, style];

  return (
    <View style={wrapStyle} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Image
        source={require("../../../assets/brand-logo.png")}
        style={{ width: size, height: size } as ImageStyle}
        resizeMode="contain"
      />
    </View>
  );
}
