/**
 * Remote photography for in-app content cards (batches, sheds).
 * Login uses the local `assets/login-background.png` — do not point auth screens here.
 * `flockHen` key retained for import stability (asset URI is poultry imagery).
 * Home dashboard uses local `header` art (require path).
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

/** Local dashboard artwork — keep filenames as supplied (double `.png` extension). */
export const dashboardArt = {
  header: require("../../assets/header.png.png"),
};

/** Shed / bird-management header — clear left space for text; art weighted right. */
export const shedHeaderArt = require("../../assets/Pastel Farm Shed and Rooster Header.png");
