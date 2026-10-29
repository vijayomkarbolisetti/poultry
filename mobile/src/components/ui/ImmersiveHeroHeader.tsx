import { ReactNode } from "react";
import {
  Dimensions,
  ImageBackground,
  ImageSourcePropType,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Matches Home `ui.horizontal` — keep all immersive heroes on the same gutter. */
export const IMMERSIVE_HERO_HORIZONTAL = 20;

/** Matches Home `styles.header.minHeight` (safe-area padding is applied on top). */
export const IMMERSIVE_HERO_MIN_HEIGHT = 188;

/** Matches Home sheet pull-up under the curve (`styles.sheet.marginTop`). */
export const IMMERSIVE_HERO_SHEET_OVERLAP = -18;

type Props = {
  source: ImageSourcePropType;
  children?: ReactNode;
  /** Fill color for the soft bottom curve (match screen content bg). */
  curveFill?: string;
  /**
   * Minimum header height before safe-area padding.
   * Defaults to Home's 188 — pass only when a screen truly needs a shorter hero.
   */
  minHeight?: number;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  accessibilityLabel?: string;
};

const SCREEN_W = Dimensions.get("window").width;

/**
 * Full-bleed farm hero cloned from Home's ImageBackground + HeaderCurve recipe:
 * edge-to-edge cover art, status-bar padding, horizontal content gutter, soft bottom curve.
 *
 * Do not set `width` on the outer style — RN proxies it onto the inner Image and that
 * conflicts with paddingHorizontal (right-edge mint strip).
 */
export function ImmersiveHeroHeader({
  source,
  children,
  curveFill = "#F4FAF7",
  minHeight = IMMERSIVE_HERO_MIN_HEIGHT,
  style,
  contentStyle,
  accessibilityLabel = "Farm illustration header",
}: Props) {
  const insets = useSafeAreaInsets();
  const topPad = Math.max(insets.top, 10) + 4;

  return (
    <ImageBackground
      source={source}
      style={[
        styles.header,
        { minHeight, paddingTop: topPad },
        style,
      ]}
      imageStyle={styles.headerImg}
      resizeMode="cover"
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.content, contentStyle]}>{children}</View>
      <HeroCurve width={SCREEN_W} fill={curveFill} />
    </ImageBackground>
  );
}

function HeroCurve({ width, fill }: { width: number; fill: string }) {
  const h = 28;
  return (
    <View style={styles.curveWrap} pointerEvents="none">
      <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none">
        <Path
          d={`M0 0 Q${width / 2} ${h * 1.35} ${width} 0 L${width} ${h} L0 ${h} Z`}
          fill={fill}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // Mirror Home `styles.header` exactly (minus per-screen dynamic paddingTop).
  header: {
    minHeight: IMMERSIVE_HERO_MIN_HEIGHT,
    paddingHorizontal: IMMERSIVE_HERO_HORIZONTAL,
    paddingBottom: 40,
    overflow: "hidden",
  },
  // Mirror Home `styles.headerImg` — cover only; no absoluteFill / width hacks.
  headerImg: { resizeMode: "cover" },
  content: {
    flexGrow: 1,
  },
  curveWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
