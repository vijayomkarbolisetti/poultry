import { ReactNode } from "react";
import { ImageSourcePropType, ViewStyle } from "react-native";

import { ImmersiveHeroHeader } from "./ImmersiveHeroHeader";

type Props = {
  source: ImageSourcePropType;
  /** Kept for call-site compatibility; maps to ImmersiveHeroHeader minHeight. */
  height?: number;
  style?: ViewStyle;
  accessibilityLabel?: string;
  curveFill?: string;
  children?: ReactNode;
};

/**
 * @deprecated Prefer ImmersiveHeroHeader directly.
 * Renders the Home-style full-bleed immersive hero (no inset card).
 */
export function CompactHeroBanner({
  source,
  height = 168,
  style,
  accessibilityLabel = "Decorative farm illustration",
  curveFill,
  children,
}: Props) {
  return (
    <ImmersiveHeroHeader
      source={source}
      minHeight={Math.max(140, height)}
      style={style}
      accessibilityLabel={accessibilityLabel}
      curveFill={curveFill}
    >
      {children}
    </ImmersiveHeroHeader>
  );
}
