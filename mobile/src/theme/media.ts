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
 * Home card watermark illustrations — subject weighted right; left clear for copy.
 * Overview KPIs use the three themed scenes; quick actions reuse matching art.
 */
export const homeCardArt = {
  liveBirds: require("../../assets/Pastel Live Birds Farm Scene.png"),
  activeSheds: require("../../assets/Pastel Blue Farmstead Landscape.png"),
  farmers: require("../../assets/Warm Sunset Farm Silhouette.png"),
  manageSheds: require("../../assets/Pastel Blue Farmstead Landscape.png"),
  manageBirds: require("../../assets/Pastel Live Birds Farm Scene.png"),
  vaccination: require("../../assets/Pastel Veterinary Farm Vaccination Landscape.png"),
  catalogues: require("../../assets/Pastel Farm Catalogue Landscape.png"),
} as const;

/** Shed / bird-management header — left clear space for text; art weighted right. */
export const shedHeaderArt = require("../../assets/Pastel Farm Shed and Rooster Header.png");

/** Create Farmer header — pastoral farmer + chick; art weighted right, left clear for copy. */
export const farmerHeaderArt = require("../../assets/farmer-header.png");

/**
 * Full-bleed immersive heroes (Home-style cover headers).
 * Vaccination uses the supplied `vaccination-hero.png` asset exactly.
 */
export const heroArt = {
  home: require("../../assets/home-farm-hero.png"),
  sheds: require("../../assets/sheds-farm-hero.png"),
  /** Exact asset: mobile/assets/vaccination-hero.png */
  vaccination: require("../../assets/vaccination-hero.png"),
  /** Exact asset: mobile/assets/login-background.png */
  login: loginBackgroundArt,
};
