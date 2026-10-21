/**
 * Remote photography for in-app content cards (batches, sheds, vaccines).
 * Login uses the local `assets/loginbackround.png` — do not point auth screens here.
 * `flockHen` key retained for import stability (asset URI is poultry imagery).
 * Home dashboard uses local `headerArt` / `vaccinationTasksBanner` (require paths).
 */
export const media = {
  flockHen:
    "https://images.unsplash.com/photo-1612170153139-a4abf4923880?auto=format&fit=crop&w=800&q=80",
  shedYard:
    "https://images.unsplash.com/photo-1612170153139-a4abf4923880?auto=format&fit=crop&w=800&q=80",
  vaccineCare:
    "https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?auto=format&fit=crop&w=800&q=80",
  farmMorning:
    "https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?auto=format&fit=crop&w=1200&q=80",
};

/** Local dashboard artwork — keep filenames as supplied (double `.png` extension). */
export const dashboardArt = {
  header: require("../../assets/header.png.png"),
  vaccinationTasks: require("../../assets/vaccination_tasks.png.png"),
};
