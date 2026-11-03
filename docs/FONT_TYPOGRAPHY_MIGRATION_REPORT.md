# Typography Migration Report — PoultryTrack Mobile

**Date:** 1 Nov 2026  
**Scope:** App-wide typography consistency (tokens + screens + shared UI)  
**Source audit:** `docs/FONT_SIZE_AUDIT.md` (baseline 1 Nov 2026)

---

## 1. Metrics — before vs after

| Metric | Before | After |
|--------|-------:|------:|
| Hard-coded `fontSize: <number>` (app + src) | **477** | **13** (all in `tokens.ts` only) |
| Distinct numeric sizes outside tokens | **18–19** (`9`–`34`) | **0** |
| Distinct sizes in the design system | ad hoc | **8** (`11`, `12`, `13`, `14`, `16`, `17`, `22`, `28`) |
| `typography.*` references | **9** | **477** |
| Files using shared typography | **4** | **~55** migrated consumers |

---

## 2. Shared typography tokens

Updated: `mobile/src/theme/tokens.ts`

| Role | Size | Weight | Notes |
|------|-----:|--------|-------|
| `display` | 28 | 800 | Rare hero / success / KPI emphasis (was 32) |
| `screenTitle` | 22 | 800 | Normal page titles |
| `sectionTitle` | 16 | 700 | Section and card headings |
| `body` | 16 | 400 | Primary body |
| `bodyStrong` | 16 | 700 | Emphasized body |
| `label` | 14 | 600 | Form labels |
| `secondary` | 13 | 500 | Metadata / secondary text (**new**) |
| `caption` | 12 | 500 | Hints / captions (was 14) |
| `overline` | 11 | 700 | Badges / tab labels |
| `button` | 17 | 700 | Primary buttons |
| `bandInput` | 22 | 800 | Band number entry (**new**, intentional) |
| `heading` / `title` | 22 | 800 | Deprecated aliases → `screenTitle` |

---

## 3. Screens and components migrated

All screens under `mobile/app/` and shared UI under `mobile/src/components` / `mobile/src/features` that previously hard-coded font sizes now reference `typography.*`.

Including (non-exhaustive): Home, Sheds, Shed birds, Bird Profile, Add/Edit Bird, Change Band, Sold, Transfer, Vaccination hub/detail, Farmers, Flocks, Catalogues, Settings, Search, Lifecycle, auth, and shared sheets/dialogs/fields.

Shared primitives updated:

- `Button` (already used `typography.button`)
- `TextField` → `body` input, `secondary` errors, `label` labels
- `SelectField`, `MultiSelectField`, `AppDatePicker`, `AppDialog`, `EmptyState`, action sheets, etc.

---

## 4. Priority fixes applied (from audit)

| Issue | Change |
|-------|--------|
| Sheds title 34 | → `screenTitle` (22) |
| Home / Vaccination hub 28 | → `screenTitle` (22) |
| Settings 26 | → `screenTitle` (22) |
| Bird Profile 18 | → `screenTitle` (22) |
| Catalogue list 20 | → `screenTitle` (22) |
| Form labels 11–13 | → `label` (14) where role is label |
| Section titles 15–17 | → `sectionTitle` (16) |
| Catalogue day caption 9 | → `caption` (12) |
| Micro badges 10 | → `overline` (11) |
| Sheds summary/KPI 30 | → `display` (28) |
| Sheds card title 21 | → `sectionTitle` / `screenTitle` by role |
| Band inputs | → `bandInput` (22) |

---

## 5. Remaining exceptions (justified)

| Exception | Token / size | Justification |
|-----------|--------------|---------------|
| Band number inputs & prominent band display | `bandInput` 22 | Primary data being entered/shown |
| KPI / live counts (`statValue`, `summaryValue`, `metricValue`, vaccination `summaryCount`) | `display` 28 | Important numeric values; do not shrink to title size |
| Success screens (`bird-added`, `group-created`) | `display` 28 | Rare hero titles |
| Login brand display | `display` 28 | Auth marketing hero |
| Tab bar labels | `overline` 11 | Compact bottom navigation |
| Deprecated `heading` / `title` aliases | 22 | Compatibility with existing spreads |

No unexplained one-off sizes remain outside `tokens.ts`.

---

## 6. Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **Pass** |
| Expo lint (key screens) | **Pass** (3 pre-existing warnings, 0 errors) |
| Band change helper unit test | **Pass** |
| Font re-audit | Hard-codes only in `tokens.ts`; sizes ⊂ allowed set |
| Android device | Connected `2639a611` — build/install status in agent final message |

Layouts, colors, radii, APIs, permissions, and workflows were not redesigned; only typography roles/sizes were standardized.

---

## 7. Follow-ups (optional)

- Prefer `...typography.screenTitle` spreads over `fontSize: typography.screenTitle.fontSize` for fewer lines.
- Remove deprecated `heading` / `title` aliases after a quiet period.
- Visual QA on long shed/farmer names with Dynamic Type enabled.

---

*No push to master was performed as part of this migration.*
