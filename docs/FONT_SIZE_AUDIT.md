# Font Size Audit — PoultryTrack Mobile

**Date:** 1 Nov 2026  
**Scope:** Audit only (no code changes). Covers `mobile/app/**` screens and `mobile/src/**` shared UI used by those screens.  
**Method:** Static scan of literal `fontSize: <number>` in StyleSheets, plus usage of `typography.*` from `mobile/src/theme/tokens.ts`.

---

## 1. Executive summary

| Metric | Value |
|--------|------:|
| Literal `fontSize` declarations | **477** |
| Distinct sizes in use | **19** (`9`–`34`) |
| Files with hard-coded sizes | **57** |
| Files using design-token typography | **4** |

**Verdict:** Typography is **not consistent** across screens. Most UI hard-codes sizes screen-by-screen. The shared scale in `tokens.ts` exists but is barely adopted outside auth + a few form primitives.

Dominant sizes (by count):

| Size (px) | Count | Typical role today |
|----------:|------:|--------------------|
| 13 | 104 | Labels, meta, secondary body (most common) |
| 12 | 83 | Captions, hints, muted meta |
| 14 | 77 | Row labels/values, body, errors |
| 15 | 59 | Card/section titles, chip text |
| 16 | 44 | Inputs, sheet titles, body |
| 11 | 29 | Overlines, badges, tiny meta |
| 18 | 18 | Screen/nav titles (partial) |
| 17 | 18 | Section titles, brand (Home) |
| 22 | 17 | Form-screen titles (legacy token `title`) |
| 20 | 9 | Hero/dialog titles |
| 10 | 4 | Micro badges |
| 28 | 4 | Large marketing/success titles |
| 26 | 3 | KPI / settings header |
| 24 | 3 | Profile band / token heading |
| Other | ≤3 each | Outliers (`9`, `21`, `30`, `32`, `34`) |

---

## 2. Design-system baseline (tokens)

Source: `mobile/src/theme/tokens.ts` → `typography`

| Token | Size | Weight | Intended role |
|-------|-----:|--------|---------------|
| `display` | 32 | 800 | Marketing / login brand |
| `heading` | 24 | 800 | Major page heading |
| `title` | 22 | 700 | Screen title |
| `body` / `bodyStrong` | 16 | 400 / 700 | Primary reading text |
| `label` | 14 | 600 | Form labels |
| `caption` | 14 | 500 | Supporting text *(same size as label)* |
| `overline` | 11 | 800 | Tiny uppercase labels |
| `button` | 17 | 700 | Primary buttons (`Button` component) |

**Adoption:** Only these files spread token typography:

- `app/(auth)/login.tsx`
- `app/(auth)/register.tsx`
- `src/components/ui/Button.tsx`
- `src/components/ui/TextField.tsx`

Everyone else reinvents sizes locally (especially bird/shed/vaccination mint UI).

---

## 3. Role consistency (cross-screen)

### 3.1 Screen / page titles

Same job, many sizes:

| Size | Examples |
|-----:|----------|
| **34** | Sheds list hero title (`sheds/index.tsx`) |
| **28** | Home farm title; Vaccination hub title; bird-added / group-created success |
| **26** | Settings header; Sold Birds title |
| **22** | Many older forms: Add bird, Transfer, Farmers, Flocks, Lifecycle, Groups |
| **20** | Catalogues list; Vaccination detail hero; AddBirds sheet; AppDialog |
| **18** | Bird Profile; Change band; Expo tab header; many sheets/modals |
| **17** | Home section titles; some catalogue headers |
| **15–16** | Card/section titles inside screens |

**Inconsistency hotspots**

- Bird-related titles alone use **18 / 22 / 26 / 28**.
- List hubs: Sheds **34**, Vaccination **28**, Catalogues **20**, Farmers/Flocks **22**, Settings **26**.

### 3.2 Section / card titles

| Size | Where |
|-----:|-------|
| 17 | Home sections, Vaccination sections, some empty states |
| 15 | Bird Profile cards, Add Bird cards, many catalogue/farmer cards |
| 14 | Nested titles (lifecycle event, empty parentage) |
| 13 | Home quick-action titles *(reads as body, not section)* |

### 3.3 Form labels

Token expects **14**. Actual label sizes cluster at **13**, with **11–15** also used.

| Size | Pattern |
|-----:|---------|
| 14 | TextField token; some band labels; Toast |
| 13 | Change-band `fieldLabel`; many Select/MultiSelect/DatePicker labels |
| 12 | Hints / secondary labels |
| 11 | Summary overlines (“Current band”, meta labels) |

### 3.4 Inputs / editable text

| Size | Pattern |
|-----:|---------|
| **22** | Band number inputs (Change band, Add bird, band-from-unbanded) — intentional large type |
| **16–17** | Most TextInputs / TextField |
| **15** | Several chips/fields |
| **14** | Occasional |

Band inputs being larger is fine; body inputs should standardize on **16**.

### 3.5 Body / detail rows

| Size | Pattern |
|-----:|---------|
| 14 | Bird Profile detail rows (label + value) |
| 13 | Very common secondary body |
| 12 | Lifecycle/vax meta |

Profile detail rows (14) vs summary meta (11/13) is intentional hierarchy; elsewhere 13 vs 14 for the same “secondary text” role is noise.

### 3.6 Captions, badges, overlines

| Size | Pattern |
|-----:|---------|
| 11 | Token `overline`; tab labels; status/meta |
| 10 | Catalogue/vaccination micro badges |
| **9** | Catalogue day caption (`catalogues/[id].tsx`) — smallest in app |

### 3.7 Buttons

| Source | Size |
|--------|-----:|
| Shared `Button` | **17** (`typography.button`) |
| Custom CTAs / chips | 13–16 mixed |
| Header text actions (“Edit”, “View all”) | often **13** |

---

## 4. Screen-by-screen inventory

Sizes listed are the distinct `fontSize` values present on that screen/file.

### Auth

| Screen | File | Sizes |
|--------|------|-------|
| Login | `app/(auth)/login.tsx` | 13, 14, 15 + tokens (`display` 32, `heading` 24, `caption` 14) |
| Register | `app/(auth)/register.tsx` | 14, 15 + tokens (`heading` 24, `body` 16) |

### Home / navigation / search / settings

| Screen | File | Sizes |
|--------|------|-------|
| Tab shell | `app/(app)/_layout.tsx` | 11 (tab label), 18 (header title) |
| Home | `app/(app)/home.tsx` | 11, 12, 13, 14, **17**, **26**, **28** |
| Search | `app/(app)/search.tsx` | 12, 13, 14, 16 |
| Settings | `app/(app)/settings.tsx` | 11, 12, 13, 14, 15, 17, 20, **26** |
| Inline search panel | `src/features/search/HomeInlineSearchPanel.tsx` | 11, 13, 15, 16 |

### Sheds

| Screen | File | Sizes |
|--------|------|-------|
| Sheds list | `app/(app)/sheds/index.tsx` | 11–16, 18, 20, **21**, **30**, **34** *(widest range)* |
| Shed birds | `app/(app)/sheds/[id]/birds.tsx` | 11–17, **24** |
| Shed groups | `app/(app)/sheds/[id]/groups.tsx` | 11, 13, 15, 17, 22 |
| Shed editor | `src/features/sheds/ShedEditorScreen.tsx` | 12–16, 18 |
| Shed birds section | `src/components/sheds/ShedBirdsSection.tsx` | 11–17 |
| Manage panel / Add farmer | `ShedManagePanel`, `AddFarmerModal` | 12–18 |

### Birds

| Screen | File | Sizes |
|--------|------|-------|
| Bird Profile | `app/(app)/birds/[id].tsx` | 11–15, 18, **24** |
| Change / Assign band | `app/(app)/birds/edit/[id].tsx` | 11–16, 18, 20, **22** |
| Add bird | `app/(app)/birds/add.tsx` | 12–16, **22** |
| Add unbanded | `app/(app)/birds/add-unbanded.tsx` | 13, 15, 16, 22 |
| Sold birds | `app/(app)/birds/sold.tsx` | 11–15, 17, **26** |
| Transfer | `app/(app)/birds/transfer.tsx` | 12–14, 16, 17, 22 |
| New group | `app/(app)/birds/new-group.tsx` | 13–15, 17, 18, 22 |
| Success: bird added | `app/(app)/birds/bird-added.tsx` | 15, 20, **28** |
| Success: group created | `app/(app)/birds/group-created.tsx` | 14, 16, **28** |
| Band from unbanded | `app/(app)/birds/band-from-unbanded.tsx` | 22 |
| Parentage fields | `src/components/birds/ParentageFields.tsx` | 13, 15, 16 |
| Sale / Mortality / Transfer sheets | `SaleActionSheet`, `MortalityActionSheet`, `TransferActionSheet` | 12–18 |
| Add birds / filter sheets | `AddBirdsSheet`, `BirdsFilterSheet` | 13–20 |

### Vaccination

| Screen | File | Sizes |
|--------|------|-------|
| Vaccination hub | `app/(app)/vaccination/index.tsx` | 10–18, 20, **28** |
| Vaccination detail | `app/(app)/vaccination/[id].tsx` | 11–16, 18, 20 |
| Bird selector | `src/components/vaccination/VaccinationBirdSelector.tsx` | 11–16, 18 |

### Farmers / flocks / catalogues / lifecycle

| Screen | File | Sizes |
|--------|------|-------|
| Farmers list | `app/(app)/farmers/index.tsx` | 11, 13–16, 22 |
| Farmer create | `app/(app)/farmers/create.tsx` | 11–16, 22 |
| Farmer detail | `app/(app)/farmers/[id].tsx` | 12–15, 22 |
| Flocks list / detail / create | `flocks/*` | 12–15, 22 |
| Catalogues list | `catalogues/index.tsx` | 10, 12–15, 17, 20 |
| Catalogue detail | `catalogues/[id].tsx` | **9**, 10–15, 17 |
| Catalogue create / item edit | `create.tsx`, `item-edit.tsx` | 11–15, 18 |
| Lifecycle bulk / batch | `lifecycle-bulk.tsx`, `lifecycle-batch.tsx` | 13–17, 22 |

### Shared UI primitives

| Component | Sizes |
|-----------|-------|
| `Button` | 17 (token) |
| `TextField` | 14 label (token), 16 input |
| `SelectField` / `MultiSelectField` / `AppDatePicker` | 12–16 |
| `AppDialog` | 15, 16, 20 |
| `EmptyState` | 14, 18 |
| `MediaCard` | 11–13, 16 |
| `ToastHost` | 14 |
| `DataQualityBanner` | 13 |
| `HenLoader` | 15 |
| `RadioChips` | 12–14 |

---

## 5. Outliers (review first if standardizing)

| Size | Location | Style key | Why it stands out |
|-----:|----------|-----------|-------------------|
| **9** | `catalogues/[id].tsx` | `dayCaption` | Smallest text in app; likely accessibility risk |
| **10** | catalogues + vaccination badges | `*BadgeText` | Micro badges; OK if rare, but below token floor (11) |
| **21** | `sheds/index.tsx` | `cardTitle` | One-off between 20 and 22 |
| **30** | `sheds/index.tsx` | `summaryValue` | KPI not used elsewhere |
| **34** | `sheds/index.tsx` | `title` | Largest screen title; exceeds token `display` (32) |
| **28** | Home / Vaccination / success screens | titles | Larger than Settings (26) and Profile (18) |

---

## 6. Consistency findings (no fixes applied)

1. **Token typography is unused on almost all product screens.** Bird/shed/vaccination mint UI defines its own scale (heavy on 11–15).
2. **Screen titles lack a single contract.** Observed title band: **18–34** depending on feature era.
3. **Section titles oscillate between 15 and 17** (Profile cards vs Home/Vaccination sections).
4. **Form labels should be 14 per tokens; many screens use 13.**
5. **Caption vs label collision in tokens:** both `label` and `caption` are 14 — only weight differs — so “caption” does not visually step down.
6. **Micro sizes (9–10)** appear on catalogues/vaccination badges; Profile/Home stop at 11.
7. **Same feature family is inconsistent:**  
   - Bird Profile title **18** vs Sold Birds **26** vs Add Bird **22** vs Success **28**.  
   - Change-band title **18** but band input **22** (input larger than title — intentional emphasis, still unusual).
8. **Shared sheets** (Sale/Mortality/Transfer/Filter) align better around **18** titles and **13–14** body — a useful internal pattern to promote.

---

## 7. Proposed target scale (recommendation only)

*Not implemented — audit recommendation for a future pass.*

| Role | Target size | Notes |
|------|------------:|-------|
| Display / rare hero | 28 | Cap; avoid 30–34 unless marketing |
| Screen title | 20 or 22 | Pick one; use everywhere |
| Section / card title | 16 | Or 15 if mint UI stays denser |
| Body | 16 | |
| Label | 14 | Match token |
| Secondary / meta | 13 | |
| Caption / hint | 12 | |
| Overline / badge | 11 | Avoid &lt; 11 |
| Primary button | 17 | Keep token |
| Special: band input | 20–22 | Allowed exception |

Also recommend: extend `typography` (or a `birdUi.type` map) and migrate screens instead of adding more one-off sizes.

---

## 8. Suggested migration priority (future work)

1. Unify **screen titles** (hubs + bird flows).  
2. Unify **section/card titles** (15 vs 17).  
3. Unify **form labels** to 14.  
4. Raise or remove **9–10** micro text.  
5. Adopt tokens (or a documented bird-management type scale) for new UI.

---

## 9. Scan notes / limitations

- Counts hard-coded numeric `fontSize` only.  
- Does not expand `...typography.*` into every consumer count (those are listed in §2).  
- Does not evaluate `lineHeight`, letter-spacing, or Dynamic Type / font scaling.  
- Does not include `android/` generated assets or Maestro XML dumps.  
---

*End of audit — no application code was changed for this document.*
