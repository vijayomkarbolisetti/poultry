# Typography Visual Verification Report

**Date:** 1 Nov 2026  
**Device:** Xiaomi 2406ERN9CI (`2639a611`), Android 16  
**APK:** `mobile/builds/poultrytrack-typography-verified-*.apk` (debug, installed with `adb install -r`)  
**Screenshots:** `mobile/docs/qa-screenshots/typography-verify/`

---

## 1. Screens checked

| Screen | How verified | Result |
|--------|--------------|--------|
| Home | Screenshot + UI dump (default + font scale 1.3) | Pass after fixes |
| Sheds | Screenshot + UI dump (default + font scale 1.3) | Pass |
| Bird Profile | Opened bird `67A` via shed list chevron | Pass — no clipping |
| Change Band | From Bird Profile action | Pass — hierarchy clear; keyboard OK |
| Vaccination hub | Bottom tab | Pass |
| Settings / More (Account) | Profile Account control | Pass — list text readable |
| Search bird ID | Query `BAF0004` | Pass — ID/shed visible |

Long-name / ID checks used existing data: shed **Sayeed**, birds **67A** / **BAF0004**. Shed card titles already allow 2 lines (`numberOfLines={2}`).

---

## 2. Issues found

| # | Issue | Severity | Notes |
|---|--------|----------|-------|
| 1 | Home Quick Action titles truncated (`Manage s…`) after typography migration | Medium | Caused by compact 2-column cards + larger title size |
| 2 | Bottom nav labels at 11sp felt small | Low | Requested bump to 12sp |
| 3 | At Android font scale **1.3**, Overview label risk + Quick Action title mid-word wrap | Medium | Large-text accessibility |
| 4 | Quick Action **subtitles** still ellipsize in narrow cards | Low / accepted | Pre-existing compact-card pattern; full text available to TalkBack |
| 5 | Initial blank launch | Transient | Debug APK waiting on Metro; resolved after bundler ready |

No overlapping labels, button overflow, or clipped primary CTAs on Bird Profile / Change Band / Sheds / Vaccination / More.

---

## 3. Fixes made

| Fix | File | Detail |
|-----|------|--------|
| Tab labels **11 → 12** | `app/(app)/_layout.tsx` | `typography.caption`; tab bar height **68 → 72** for safe padding |
| Quick Action titles | `app/(app)/home.tsx` | Use `typography.secondary` (13); `adjustsFontSizeToFit` + `numberOfLines={1}` to avoid mid-word wrap |
| Overview labels under large text | `app/(app)/home.tsx` | `statLabel` → `numberOfLines={2}`; stat values `adjustsFontSizeToFit` |
| Lint `display-name` on tab icon | `app/(app)/_layout.tsx` | Named `TabBarIcon` inner component |

Design, colors, radii, APIs, and workflows unchanged.

---

## 4. Font scaling

- Set `font_scale` to **1.3**, relaunched, inspected Home and Sheds, then reset to **1.0**.
- App remained usable; Overview labels wrap instead of hard-clip after fix.
- Quick Action subtitles may still truncate under large scale (compact card layout).

---

## 5. Automated checks (after fixes)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass |
| Expo lint (`home.tsx`, `_layout.tsx`) | Pass (1 existing unused-var warning on Home) |
| Band change helper unit test | Pass |
| `adb install -r` | Success |
| App launch | Success |

---

## 6. Remaining accepted exceptions

1. **Quick Action subtitles** in 2-column cards may show ellipsis — intentional compact layout; titles remain fully readable.
2. **KPI / band numbers** stay large (`display` / `bandInput`) by design.
3. **Account** opens the More/settings hub; the “Manage farm · Simple” chip is visual (not a press target) — pre-existing, not changed.

---

## 7. Conclusion

Visual verification on the connected Android device is complete. Typography hierarchy holds on the required screens. Clipping risks found during QA were fixed without redesigning screens. Latest APK reinstalled on device for manual follow-up if needed.

**No push to master.**
