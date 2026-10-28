/**
 * Shared visual tokens for Vaccine Tracker screens (10-screen approved collage).
 * Pale mint surfaces, emerald actions, restrained status colors.
 */

export const vaccineUi = {
  bg: "#F0F7F4",
  white: "#FFFFFF",
  cardBorder: "#D7E8E0",
  ink: "#15342C",
  muted: "#71837C",
  mutedSoft: "#8A9A93",
  brand: "#07835D",
  brandSoft: "#E3F5EE",
  brandSoftStrong: "#D1FAE5",
  highlightRow: "#E8F6F0",

  overdueBg: "#FDECEC",
  overdueText: "#C62828",
  overdueIcon: "#E53935",
  dueBg: "#FFF6E5",
  dueText: "#C05600",
  dueIcon: "#F59E0B",
  upcomingBg: "#E8F7F0",
  upcomingText: "#047857",
  upcomingIcon: "#0D9488",
  /** Reference uses soft blue for Needs review (not purple). */
  reviewBg: "#E8F1FB",
  reviewText: "#1D4ED8",
  reviewIcon: "#2563EB",

  infoBg: "#E8F1FB",
  infoText: "#1E40AF",
  infoBorder: "#BFDBFE",

  progressTrack: "#E8EEF0",
  progressFill: "#07835D",

  dayPalette: ["#F59E0B", "#07835D", "#E53935", "#2563EB", "#0D9488", "#C05600"] as const,
  iconPalette: ["#07835D", "#F59E0B", "#E53935", "#2563EB", "#0D9488"] as const,
  iconSoftPalette: ["#DDF4EA", "#FFF1E6", "#FEE7E5", "#E5F0FA", "#D1FAE5"] as const,

  cardRadius: 16,
  horizontal: 20,
} as const;
