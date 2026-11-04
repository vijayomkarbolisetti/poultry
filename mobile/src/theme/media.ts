/**
 * Remote photography for empty-state cards + local hero / header art.
 * Login uses `login-background.png` (exact supplied asset).
 * Bird management reuses `shedHeaderArt` — do not duplicate that file.
 */

/** Exact asset: mobile/assets/login-background.png */
export const loginBackgroundArt = require("../../assets/login-background.png");
export const media = {
  flockHen:
    "https://images.unsplash.com/photo-1612170153139-a4abf4923880?auto=format&fit=crop&w=800&q=80",
  shedYard:
    "https://images.unsplash.com/photo-1612170153139-a4abf4923880?auto=format&fit=crop&w=800&q=80",
  farmMorning:
    "https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?auto=format&fit=crop&w=1200&q=80",
};

/** Local dashboard artwork — Home hero (pastel farm). */
export const dashboardArt = {
  header: require("../../assets/home-farm-hero.png"),
};

/**
 * Home card watermark illustrations — subject weighted right/bottom; left clear for copy.
 * Overview KPIs use the three portrait themed assets; quick actions use dedicated local art.
 */
export const homeCardArt = {
  liveBirds: require("../../assets/live-birds.png"),
  activeSheds: require("../../assets/active-sheds.png"),
  farmers: require("../../assets/farmers.png"),
  manageSheds: require("../../assets/quick-actions-sheds.png"),
  manageBirds: require("../../assets/quick-actions-birds.png"),
  vaccination: require("../../assets/quick-actions-Vaccine.png"),
  catalogues: require("../../assets/quick-actions-catologe.png"),
} as const;

/** Shed / bird-management header — left clear space for text; art weighted right. */
export const shedHeaderArt = require("../../assets/Pastel Farm Shed and Rooster Header.png");

/** Local bird / parent avatars for profile, band change, and lists. */
export const birdIcons = {
  bird: require("../../assets/Bird-icon.png"),
  male: require("../../assets/Male-Icon.png"),
  female: require("../../assets/Female-Icon.png"),
} as const;

/**
 * Pastoral farmer + chick (local).
 * Used for Create Farmer header and Farmers empty-state illustration.
 */
export const farmerHeaderArt = require("../../assets/farmer-header.png");

/**
 * Full-bleed immersive heroes (Home-style cover headers).
 * Vaccination uses the supplied `vaccination-hero.png` asset exactly.
 */
export const heroArt = {
  home: require("../../assets/home-farm-hero.png"),
  /** Multi-shed panorama — left clear for copy; use with ImmersiveHeroHeader cover. */
  sheds: require("../../assets/sheds-farm-hero.png"),
  /** Exact asset: mobile/assets/vaccination-hero.png */
  vaccination: require("../../assets/vaccination-hero.png"),
  /** Exact asset: mobile/assets/login-background.png */
  login: loginBackgroundArt,
};
