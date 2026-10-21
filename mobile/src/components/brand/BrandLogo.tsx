import { Image, ImageStyle, StyleProp, View, ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";

import { brandLogoSvg } from "../../brand/brandLogoSvg";

type Props = {
  /** Rendered height; width follows the logo’s natural aspect ratio (~153:138). */
  size?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * Prefer SVG via react-native-svg when available.
   * Fall back to the PNG derived from the same SVG (icons / environments without SvgXml).
   */
  preferPng?: boolean;
  accessibilityLabel?: string;
};

const ASPECT = 153 / 138;

/**
 * Canonical PoultryTrack brand mark from `assets/brand-logo.svg`.
 * Do not replace with a text-only “PT” mark.
 */
export function BrandLogo({
  size = 64,
  style,
  preferPng = false,
  accessibilityLabel = "PoultryTrack",
}: Props) {
  const height = size;
  const width = Math.round(size * ASPECT);
  const wrapStyle: StyleProp<ViewStyle> = [{ width, height }, style];

  if (preferPng) {
    return (
      <View style={wrapStyle} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        <Image
          source={require("../../../assets/brand-logo.png")}
          style={{ width, height } as ImageStyle}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={wrapStyle} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <SvgXml xml={brandLogoSvg} width={width} height={height} />
    </View>
  );
}
