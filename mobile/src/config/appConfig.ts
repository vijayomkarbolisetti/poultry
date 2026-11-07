/**
 * User-facing product identity. Change `name` in `app-identity.json` to rebrand.
 *
 * Native / store labels that cannot import this TypeScript module:
 * - `android/app/src/main/res/values/strings.xml` (`app_name`) — updated on native rebuild
 * - `android/settings.gradle` `rootProject.name` — Gradle project name, not the launcher label
 * - Android `applicationId` / iOS bundle id — never change these for a rename
 * - EAS `projectId` / `owner` — never change these for a rename
 *
 * Expo `name` and image-picker permission strings are wired through `app.config.js`.
 */
import identity from "./app-identity.json";

export const APP_CONFIG = {
  name: identity.name,
  shortName: identity.shortName,
} as const;

/** @deprecated Prefer `APP_CONFIG.name` — kept for existing imports. */
export const APP_BRAND_NAME = APP_CONFIG.name;
