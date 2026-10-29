/**
 * PoultryTrack centralized visual system.
 * Emerald / forest agri-tech palette (login redesign Oct 2026).
 * Existing keys (`brand`, `ink`, `space`, `radius`, `shadow`) are preserved for current screens.
 */

export const colors = {
  // Surfaces
  bg: "#F2F8F5",
  bgElevated: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceTranslucent: "rgba(255, 255, 255, 0.86)",
  surfaceMint: "rgba(209, 250, 229, 0.92)",
  cream: "#ECFDF5",
  background: "#F2F8F5",
  backgroundFallback: "#022C22",

  // Brand (canonical) + semantic aliases — forest / emerald system
  brand: "#047857",
  brandDark: "#064E3B",
  brandSoft: "#D1FAE5",
  primary: "#047857",
  primaryDark: "#064E3B",
  primarySoft: "#D1FAE5",
  secondary: "#059669",
  secondaryEmerald: "#059669",
  accent: "#10B981",
  teal: "#0F766E",
  aqua: "#34D399",
  mint: "#D1FAE5",
  mintHighlight: "#34D399",
  paleMint: "#D1FAE5",

  // Text
  ink: "#102A22",
  inkMuted: "#6B7C75",
  textPrimary: "#102A22",
  textSecondary: "#6B7C75",
  textOnPrimary: "#FFFFFF",
  textInverse: "#FFFFFF",
  textLink: "#047857",
  textFormLabel: "#183B30",
  textOnDark: "#FFFFFF",
  textOnDarkMuted: "#ECFDF5",
  textOnDarkSecondary: "#D1FAE5",
  textDisabled: "#94A3A0",
  textPlaceholder: "#6B7C75",

  // Feedback
  info: "#2F80ED",
  danger: "#E74C3C",
  error: "#E74C3C",
  success: "#047857",
  warning: "#E67E22",

  // Borders / overlays
  border: "#D7E4DE",
  borderFocus: "#059669",
  borderMuted: "#E8F0EB",
  borderCard: "rgba(255, 255, 255, 0.65)",
  overlay: "rgba(2, 44, 34, 0.14)",
  scrimSoft: "rgba(2, 44, 34, 0.12)",
  topGlow: "rgba(52, 211, 153, 0.10)",
  dividerOnDark: "rgba(255, 255, 255, 0.22)",

  // Control states
  disabled: "#94A3A0",
  disabledBg: "#E8EFEC",
  pressedOverlay: "rgba(4, 120, 87, 0.12)",
  focusRing: "rgba(5, 150, 105, 0.10)",
  checkboxOff: "#D7E4DE",
  checkboxOn: "#047857",
  inputBg: "rgba(255, 255, 255, 0.96)",
  inputBgMuted: "#F4FAF6",
  iconMuted: "#64756D",
};

export const gradients = {
  primary: ["#047857", "#0F766E"] as const,
  primaryPressed: ["#064E3B", "#0F766E"] as const,
  heroSoft: ["#D1FAE5", "#ECFDF5"] as const,
  decorative: ["#064E3B", "#047857", "#059669"] as const,
};

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
};

/** Semantic alias for `space` — prefer this in new UI. */
export const spacing = space;

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  card: 28,
  pill: 999,
};

export const typography = {
  display: { fontSize: 32, fontWeight: "800" as const, lineHeight: 38, letterSpacing: -0.6 },
  heading: { fontSize: 24, fontWeight: "800" as const, lineHeight: 30, letterSpacing: -0.4 },
  title: { fontSize: 22, fontWeight: "700" as const, lineHeight: 28 },
  body: { fontSize: 16, fontWeight: "400" as const, lineHeight: 24 },
  bodyStrong: { fontSize: 16, fontWeight: "700" as const, lineHeight: 24 },
  label: { fontSize: 14, fontWeight: "600" as const, lineHeight: 18 },
  caption: { fontSize: 14, fontWeight: "500" as const, lineHeight: 20 },
  overline: { fontSize: 11, fontWeight: "800" as const, lineHeight: 14, letterSpacing: 1.1 },
  button: { fontSize: 17, fontWeight: "700" as const, lineHeight: 22 },
};

export const icons = {
  sm: 16,
  md: 20,
  lg: 22,
  xl: 28,
  color: colors.iconMuted,
  colorActive: colors.secondary,
  colorOnPrimary: colors.textOnPrimary,
  colorDanger: colors.danger,
  colorMuted: colors.inkMuted,
};

export const layout = {
  maxFormWidth: 440,
  screenPadding: space.lg,
  touchTarget: 48,
  inputMinHeight: 56,
  buttonMinHeight: 56,
};

export const breakpoints = {
  phone: 0,
  largePhone: 400,
  tablet: 768,
};

export const shadows = {
  card: {
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 5,
  },
  soft: {
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 2,
  },
  /** Prefer applying on an outer wrapper — not on clipped / gradient fills. */
  button: {
    shadowColor: "#022C22",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
};

/** Backward-compatible alias used across existing screens. */
export const shadow = {
  card: shadows.soft,
};

export const states = {
  pressedScale: 0.98,
  pressedOpacity: 0.92,
  disabledOpacity: 0.55,
  loadingOpacity: 0.85,
};
