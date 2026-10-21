# Bird Management UX — Implementation & QA Report

**Date:** 2026-10-20  
**Scope:** Shed-centric Add birds workflow (reference collage)  
**APK build:** NOT RUN (JS-only Expo changes; Fast Refresh sufficient)  
**Git commit/push:** Not performed (per task instructions)

---

## Summary

Implemented a shed-first bird onboarding flow matching the reference collage:

Sheds list → Shed Overview → **Add birds** sheet → **New group** wizard **or** **Tag birds** → confirmations.

All create operations call existing authenticated APIs (`POST /flocks`, `POST /birds`). Tracking mode defaults to `batch` for new groups; banding auto-promotes to `mixed` via existing backend rules.

---

## Screens implemented

| # | Screen | Status | Route / entry |
|---|--------|--------|----------------|
| 1 | Sheds list | PASS (preserved) | `/(app)/sheds` |
| 2 | Shed Overview | PASS (redesigned) | `/(app)/sheds/[id]` |
| 3 | Add Birds sheet | PASS | Modal `AddBirdsSheet` |
| 4 | New Group Step 1 | PASS | `/(app)/birds/new-group` step 1 |
| 5 | New Group Step 2 | PASS | same route step 2 |
| 6 | Group Created | PASS | `/(app)/birds/group-created` |
| 7 | Tag Birds | PASS | `/(app)/birds/add` |
| 8 | Bird Added | PASS | `/(app)/birds/bird-added` |

Reports row on overview: **NOT RUN / omitted** — no shed-scoped reports route exists. Dose tasks / Shed details / Batches / Birds rows are wired.

---

## Files modified / added

### Added
- `mobile/src/theme/birdManagementUi.ts`
- `mobile/src/features/birds/groupOnboardingHelpers.ts`
- `mobile/src/components/birds/AddBirdsSheet.tsx`
- `mobile/app/(app)/birds/new-group.tsx`
- `mobile/app/(app)/birds/group-created.tsx`
- `mobile/app/(app)/birds/bird-added.tsx`
- `mobile/scripts/check-group-onboarding-helpers.mjs`
- `mobile/docs/BIRD_MANAGEMENT_UX_IMPLEMENTATION_REPORT.md`

### Modified
- `mobile/app/(app)/sheds/[id].tsx` — overview UI + Add birds CTA
- `mobile/app/(app)/birds/add.tsx` — Tag birds rapid-entry UX
- `mobile/app/(app)/_layout.tsx` — register new routes
- `mobile/src/components/sheds/ShedBirdsSection.tsx` — “Tag bird” label
- `mobile/scripts/check-bird-selection-helpers.mjs`
- `mobile/scripts/check-shed-birds-helpers.mjs`

---

## Reused components & services

| Layer | Reused |
|-------|--------|
| API | `createFlock`, `createBird`, `listFlocks`, `getShed`, `getShedOverview` |
| Auth | `useAuth`, `hasPermission` (`flock.create`, `bird.create`, …) |
| UI | `Button`, `Screen`, `DateField`, `SelectField`, `HenLoader`, `EmptyState`, `DataQualityBanner` |
| Nav | Expo Router tabs, `safeBack`, `firstRouteParam` |
| Domain | Backend tracking_mode batch→mixed on band; active band uniqueness |

No mock data. No schema migrations. No second create-flock/create-bird implementation.

---

## API contracts used

### Create group (`POST /flocks`)
```json
{
  "shed_id": "<uuid>",
  "batch_code": "AS1105-2026-10-20",
  "initial_count": 100,
  "tracking_mode": "batch",
  "dob_confidence": "estimated|exact|unknown",
  "estimated_age_days": 0,
  "age_reported_on": "YYYY-MM-DD",
  "hatch_date": "YYYY-MM-DD",
  "unbanded_count": 100
}
```

Age chips map as:
- Day-old / 1–4 weeks → `estimated` + days (0/7/14/21/28); **no invented hatch_date**
- Exact date → `exact` + user hatch date
- Don't know → `unknown`

### Create bird (`POST /birds`)
```json
{
  "flock_id": "<uuid>",
  "band_id": "WING-101",
  "dob_confidence": "unknown",
  "breed": null,
  "sex": null,
  "notes": null
}
```
`shed_id` is assigned by the server from the flock.

---

## Data relationships preserved

```
Owner → Shed → Flock/Batch → Bird (optional band_id)
```
- Bird always inherits shed from flock.
- Band uniqueness remains owner-scoped for active birds.
- Inactive sheds still block new groups/birds via existing `assert_shed_accepts_new_records`.

---

## Smart defaults

| Situation | Behavior |
|-----------|----------|
| No active batch | Tag option disabled; prompt to create group |
| One active batch | Tag opens with flock preselected |
| Multiple active batches | Sheet lists groups; user must pick (no silent attach) |
| New group | `tracking_mode: batch`; suggested name `{SHEDCODE}-YYYY-MM-DD` |
| First band on batch flock | Backend promotes to `mixed` |

---

## Tests executed

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** |
| `node scripts/check-group-onboarding-helpers.mjs` | **PASS** |
| `node scripts/check-bird-selection-helpers.mjs` | **PASS** |
| `node scripts/check-shed-birds-helpers.mjs` | **PASS** |
| `node scripts/check-shed-nav-params.mjs` | **PASS** |
| `node scripts/check-shed-overview-fallback.mjs` | **PASS** |
| Backend pytest (flocks/birds) | **NOT RUN** (no API contract change) |
| Emulator E2E full flow | **NOT RUN** |
| Physical device | **NOT RUN** |
| EAS APK rebuild | **NOT RUN** (JS-only) |
| Visual screenshot capture vs collage | **BLOCKED** — requires interactive Expo session navigation; source layout matches reference structure/colors |

### Helper assertions covered
- Week chips never invent `hatch_date`
- Count validation rejects empty/zero/negative/non-integer
- Suggested group name format
- Single vs multi active batch resolution

---

## Bugs found and fixed during implementation

1. **Regression:** `check-bird-selection-helpers` expected “linked batch…” copy → updated to “linked group…”.
2. **Regression:** `check-shed-birds-helpers` expected “Add Bird” → updated to “Tag bird”.
3. **UX:** Multi-batch Tag option could open without a flock → sheet now requires an explicit group pick when multiple actives exist.

---

## Visual verification (against reference)

| Aspect | Status | Notes |
|--------|--------|-------|
| Mint/emerald palette (`#F1F8F5`, `#07835D`, …) | PASS (tokens) | `birdManagementUi.ts` + overview |
| Primary Add birds CTA | PASS | Full-width green button |
| Bottom sheet two options | PASS | New group / Tag |
| Wizard progress `1 of 3` / `2 of 3` | PASS | Step 3 = confirmation screen |
| Age chips | PASS | Day-old … Don't know |
| Success confirmations | PASS | Group created / Bird added |
| Device pixel screenshots | BLOCKED | Not captured in this pass |
| Scanner icon on band field | Intentionally omitted | No working scanner implementation |

---

## Edge cases (design coverage)

| Case | Handling |
|------|----------|
| Double-tap Create group | `submitting` ref + loading |
| Double-tap Save bird | same |
| Duplicate band | Backend error surfaced via `describeApiError` |
| Duplicate batch code | Backend `DUPLICATE_BATCH` surfaced |
| Inactive shed | Banner + blocked Add birds options |
| No permission | Dedicated deny screens |
| Android back | Modal `onRequestClose`; route `safeBack` |
| Keyboard | `Screen` scroll + `keyboardShouldPersistTaps` |

---

## Remaining limitations

1. **Reports** nav row not added (no shed reports route).
2. **Barcode scan** not shown (no real scanner).
3. **Interactive UI screenshots / Maestro E2E** not executed in this session.
4. Legacy `/(app)/flocks/create` still exists for Batches tab advanced create (tracking-mode exposed there intentionally).
5. Emulator/physical QA scripts that look for the string `Add Bird` may need label updates (`Tag bird` / `Add birds`).

---

## How to verify manually (Expo)

1. Open Sheds → select a shed.
2. Tap **Add birds**.
3. Choose **New group of birds** → enter count → pick age chip → Next → keep/edit name → **Create group**.
4. Confirm success → **Tag birds now** → enter band → **Save & add another**.
5. Return to shed overview and confirm Live / Banded / Unbanded metrics refresh.

---

## APK status

| Item | Status |
|------|--------|
| New EAS build | **NOT RUN** |
| Prior APK path | `mobile/builds/poultrytrack-overview-fix-e3e9b8a3.apk` (pre-existing; does **not** include this UX) |

Use Expo Go / `npx expo start` for this JS change set.
