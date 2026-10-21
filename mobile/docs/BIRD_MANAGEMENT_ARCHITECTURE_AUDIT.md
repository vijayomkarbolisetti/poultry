# PoultryTrack — Bird Management Architecture Audit

**Date:** 2026-10-20  
**Scope:** Duplicate headers, disabled banded registration, group/batch coupling, DOB enforcement, HTTP 500s, count integrity  
**Mode:** Investigation only — **no application code, schema, or deploy changes made**  
**Commit/push:** None

---

## A. Executive summary

The Birds redesign on the mobile client assumes a **newer local backend** than the **preview APK’s production API** (`https://3.6.160.64.sslip.io`). That deploy skew is the dominant, confirmed cause of broken bird loading and several “server error” experiences on physical devices.

Separately, the UI has **intentional product gates and navigation stacking bugs**:

1. **Duplicate back buttons** — Tab navigator headers (`headerLeft: backButton`) remain enabled while screens also draw their own back control.
2. **Register banded bird disabled** when a shed has **zero flocks** — UI-only gate in `AddBirdsSheet`, because every bird row requires a non-null `flock_id` FK. That conflicts with the desired “register a banded bird in an empty shed” rule.
3. **Groups/batches/flocks** are not cosmetic labels: they are the **core persistence model** for unbanded counts, DOB cohorts, tracking mode, and bird placement. Removing them from UX is feasible; deleting them from the database is not a small change.
4. **DOB** is partially enforced in local services/forms, but **DB columns remain nullable** with default `unknown`. Local service rules allow conversion/inherit paths without an exact hatch date.
5. **HTTP 500 / “check the details”** messages mix (a) real 5xx from production, (b) FastAPI **422** validation arrays remapped by `describeApiError`, and (c) **404** from missing production routes. Production OpenAPI does **not** expose `/birds/in-shed`, `/sheds/{id}/overview`, `add_unbanded`, or shed-transfer endpoints that the current mobile client calls.

---

## B. Architecture map

### Mobile navigation

| Layer | File | Role |
|-------|------|------|
| Root stack | `mobile/app/_layout.tsx` | `headerShown: false` for `(app)` |
| App tabs | `mobile/app/(app)/_layout.tsx` | Expo Router **Tabs**; default **header shown** |
| Hidden routes helper | same file, `hidden(title)` | Sets `href: null`, `title`, `headerLeft: backButton` — **does not set `headerShown: false`** |
| Safe area wrapper | `mobile/src/components/ui/Screen.tsx` | Pads left/right (and optional edges); not a nav header |
| Back helper | `mobile/src/navigation/safeBack.ts` | `router.back()` or `replace(fallback)` |

Relevant pushed screens (custom in-screen back **and** tab header):

- `sheds/[id]/index`, `sheds/[id]/birds`, `sheds/[id]/groups`
- `birds/add`, `birds/add-unbanded`, `birds/[id]`, `birds/transfer`, …

API base URL:

- Dev: `EXPO_PUBLIC_API_URL` (often `http://10.0.2.2:8002`)
- Preview/production EAS: **`https://3.6.160.64.sslip.io`** (`mobile/eas.json`)

### Backend domain (confirmed from models)

```
OwnerAccount
  └── Shed
        └── Flock (batch/group)  ← carrier of unbanded_count + cohort DOB
              └── Bird            ← flock_id NOT NULL FK
        └── LifecycleEvent (shed/flock/bird scoped, optional idempotency_key)
```

| Entity | Key fields | Notes |
|--------|------------|-------|
| `flocks` | `shed_id`, `batch_code`, `unbanded_count`, `banded_count`, `current_count`, `tracking_mode`, DOB trio | Unique `(owner_account_id, batch_code)` |
| `birds` | `shed_id`, **`flock_id` NOT NULL**, `band_id`, DOB trio, `lifecycle_status` | Partial unique index on active `band_id` |
| DOB | `hatch_date`, `estimated_age_days`, `age_reported_on`, `dob_confidence` | DB allows null hatch / default `unknown` |

### Primary user journey (intended vs actual)

```
Sheds list → Shed overview → Add birds sheet
  ├─ Add unbanded count → POST /flocks  (or PATCH add_unbanded locally)
  └─ Register banded → requires flock → POST /birds
→ Birds list → GET /birds/in-shed (+ overview)
→ Profile → PATCH band / POST lifecycle / transfer-to-shed
```

### Local vs production API (confirmed 2026-10-20)

| Endpoint / field | Local `:8002` | Production sslip |
|------------------|---------------|------------------|
| `GET /birds/in-shed` | Present | **Absent** from OpenAPI |
| `GET /birds/{id}/profile` | Present | **Absent** |
| `GET /birds/search` | Present | **Absent** |
| `POST /birds/band-from-unbanded` | Present | **Absent** |
| `GET /sheds/{id}/overview` | Present | **Absent** (mobile has 404 fallback) |
| `POST /lifecycle-events/transfer-to-shed` | Present | **Absent** |
| `FlockUpdate.add_unbanded` | Present | **Absent** (only breed/notes/status/current_count) |
| `POST /flocks`, `POST /birds` | Present | Present (older shape) |

Production health: `{"status":"ok","environment":"production"}`.

---

## C. Root-cause matrix

| Issue | Evidence | Root cause | Affected files/endpoints | Severity | Confidence |
|-------|----------|------------|--------------------------|----------|------------|
| **A. Duplicate back buttons** | Screenshots; layout code | `hidden()` registers Tab **header** with `headerLeft: backButton` while screens also render Ionicons `arrow-back` | `(app)/_layout.tsx` L34–35, L114–135; `sheds/[id]/birds.tsx` ~L201–208; `birds/add-unbanded.tsx` ~L158–159; `sheds/[id]/index.tsx` ~L237–243 | High UX | **Confirmed** |
| **B. Register banded disabled** | Sheet copy + `disabled={noBatch}` | UI refuses tagging when `activeBatches.length === 0` | `AddBirdsSheet.tsx` L85–109; overview wires sheet in `sheds/[id]/index.tsx` | High product | **Confirmed** |
| **B2. Backend cannot create bird without flock** | Model FK | `birds.flock_id` → `flocks.id` **NOT NULL** | `models/flock.py` L84–85; migration `0003_…` | Architecture | **Confirmed** |
| **C. Group concept everywhere** | Labels “Groups”, “Batch / Group”, flock selectors | Flock is the unit of unbanded headcount + DOB cohort + bird placement | Overview, Birds list, add forms, transfer, lifecycle-batch, `Flock` API | High product | **Confirmed** |
| **D. DOB DB not mandatory** | Migration nullable + default unknown | Integrity relies on service/UI, not CHECK / NOT NULL hatch | `0003_…` hatch_date nullable; `dob_confidence` default unknown | Medium | **Confirmed** |
| **D2. Local DOB service rules** | `_validate_bird_dob_or_raise` | Exact/estimated required when net-new; unknown allowed if converting from unbanded or flock has age | `flock_service.py` `_validate_bird_dob_or_raise`, `create_bird` | Medium | **Confirmed** (local) |
| **E. Birds list fails on device APK** | Prod OpenAPI missing `in-shed` | Preview APK calls production; list uses `listBirdsInShed` → `/birds/in-shed` not deployed | `src/api/birds.ts` `listBirdsInShed`; `eas.json` API URL; prod OpenAPI | **P0** | **Confirmed** |
| **E. Add unbanded “500” on device** | Prod missing `add_unbanded`; create may still hit older host | Deploy skew; possible real 5xx on create under RLS/integrity (**logs not inspected**) | `add-unbanded.tsx` → `createFlock` / `updateFlock`; prod `FlockUpdate` | **P0** | **Confirmed skew**; **probable** specific 500 cause |
| **E. “check the details you entered”** | `describeApiError` | Any **422** with `detail: []` array maps to that string — not necessarily “load birds” root cause | `src/api/client.ts` L101–112 | Medium | **Confirmed** mapping |
| **F. Count double-count risk** | Mixed reconcile rules | Banded create from unbanded decrements unbanded; individual create without unbanded increases population | `create_bird`, `band_from_unbanded`, `reconcile_flock_counts` | Medium | **Confirmed** local rules; **unverified** under concurrent prod load |

---

## D. Group-removal dependency map

| Dependency | Classification | Notes |
|------------|----------------|-------|
| UI label “Groups” / “Batch / Group” / Batches tab | **1. UI-only terminology** (can hide/rename) | Tab still backed by `/flocks` |
| Filter “Group / Batch” on Birds | **1 or 2** | Can default to “all in shed” and hide picker |
| `AddBirdsSheet` requiring a flock before banding | **1 + 3** | Gate is UI; persistence still needs a flock |
| `BirdCreate.flock_id` required | **3. Required backend relationship** | Cannot POST bird without flock UUID |
| `birds.flock_id` NOT NULL FK | **3 + 4** | Schema change or auto-provision internal flock |
| Unbanded count on `flocks.unbanded_count` | **3** | No shed-level unbanded column today |
| Cohort DOB on flock | **3** | Multiple DOBs ⇒ multiple flocks (or new cohort table) |
| `tracking_mode` batch/individual/mixed | **2. Internal** | Can stay hidden |
| Transfer / mortality flock_id | **3** | Count ops target a flock |
| Unique `batch_code` per owner | **3** | Auto-generated codes if UX hides naming |
| Historical flocks/birds rows | **4. Integrity risk if dropped** | Must retain |

### Smallest safe shed-centric approach (recommendation)

**Do not drop `flocks`.** Introduce shed-centric UX that:

1. Auto-creates (or reuses) an **internal default flock** per shed when the user adds the first birds — generated `batch_code`, never shown as “manage groups”.
2. Creates **additional internal flocks only when DOB/age differs** (cohorts), still without a “groups” management surface.
3. Keeps bird → flock FK; list/filter/search stay shed-scoped (`/birds/in-shed`).
4. Optionally later: migrate to shed-level unbanded ledgers — larger change, not required for UX simplification.

Direct “bird without flock” would need a migration making `flock_id` nullable **or** a shed-default flock — nullable flock breaks many queries that assume flock placement.

---

## E. HTTP 500 / error investigation

### E1. Physical device + preview APK → production API

| Item | Detail |
|------|--------|
| Reproduction status | **Confirmed** by comparing `eas.json` API URL to production OpenAPI |
| Symptom | Birds list / overview-dependent flows fail; messages vary |
| Request | `GET /api/v1/birds/in-shed?shed_id=…` |
| Production | Route **not listed** in OpenAPI; not deploy-equivalent to local |
| Mobile handling | Error bubbled via React Query → `describeApiError` |
| Recommended fix | **Deploy local backend to production** (or point preview builds at an API that includes new routes) **before** more UI work |

### E2. Add unbanded birds — “server error (500)”

| Item | Detail |
|------|--------|
| Client path | `add-unbanded.tsx` → `POST /flocks` (new) or `PATCH /flocks/{id}` `{add_unbanded}` (existing) |
| Production PATCH | `add_unbanded` **not in schema** → field ignored → **silent no-op** (if only that field sent) — may confuse users; not necessarily 500 |
| Production POST /flocks | Exists; 500 **not reproduced here** (no auth QA session against prod write) |
| Local | Create flock + DOB chips covered by tests |
| Confidence | Skew **confirmed**; exact prod 500 stack **unverified** (need server logs / authenticated repro) |

### E3. “Could not load birds. Please check the details you entered.”

| Item | Detail |
|------|--------|
| Message source | `describeApiError` when `detail` is an **array** (FastAPI 422) |
| Likely causes | Validation error on some request; misattributed action string `"load birds"` / similar |
| Not | Proof of a 500 |
| Fix | Map 422 field errors to readable text; treat 404 missing route distinctly |

### E4. Error-handling expectations (recommended)

Align with existing FastAPI usage (`400` for `FlockError` today):

| Case | Status |
|------|--------|
| Invalid input | `400` or `422` (pick one convention and stick to it) |
| Unauthenticated | `401` |
| Forbidden | `403` |
| Missing | `404` |
| Duplicate band / batch / conflict | `409` (today often `400` with code) |
| Unexpected | `500` + server log with request id |

Mobile: preserve form values; show `detail` string when present; never show stack traces.

---

## F. Target architecture (shed-centric UX)

**User model:** Shed → birds (banded list + unbanded headcount).

**System model (preserve):** Shed → Flock(s) → Bird, with flocks as **hidden cohorts**.

Capabilities without exposing groups:

| Capability | Mechanism |
|------------|-----------|
| Register banded in empty shed | Auto-provision default flock (individual/mixed) + require DOB + `POST /birds` |
| Add unbanded count | Auto-provision or append to DOB-matching cohort flock |
| Different DOBs | New internal flock (cohort), not a user “group” screen |
| Band from unbanded | `POST /birds/band-from-unbanded` (local) — deploy required |
| List / search / filter | Shed-scoped APIs (`in-shed`) — deploy required |
| Transfer | Existing transfer-to-shed / count transfer — deploy required |
| Mortality | Existing lifecycle endpoints |

---

## G. Prioritized remediation plan

### P0 — Deploy skew + broken registration/list (data / availability)

| Task | Files / systems | DB | Acceptance |
|------|-----------------|----|------------|
| Deploy backend that matches mobile (in-shed, overview, add_unbanded, transfer-to-shed, band-from-unbanded, profile) | Host behind `3.6.160.64.sslip.io` | Run pending Alembic if any | Prod OpenAPI lists routes; APK birds list loads |
| Or ship a preview profile pointing at a staging API with those routes | `eas.json` | — | Device QA against known-good API |
| Capture authenticated prod logs for any remaining true 500 on `POST /flocks` | Ops | — | Root exception identified |

### P1 — Duplicate headers + enable empty-shed banding + hide groups

| Task | Files | Backend | Acceptance |
|------|-------|---------|------------|
| Set `headerShown: false` on all `hidden()` routes (or remove custom back and keep one header) | `(app)/_layout.tsx`; optionally screens | None | Exactly one back control |
| Remove `disabled={noBatch}` gate; navigate to register with shedId only | `AddBirdsSheet.tsx` | Auto-flock or create-on-submit | Empty shed can open register form |
| Auto-create default flock when registering first bird / first unbanded count | `flock_service` + thin API or client orchestration | Prefer **server-side** one-shot | No user-facing group picker for the common path |
| Rename/hide Groups nav & Batches jargon on shed hub | `sheds/[id]/index.tsx`, tabs copy | None | No “manage groups” in primary path |

### P2 — DOB hardening, errors, regression

| Task | Files | DB | Acceptance |
|------|-------|----|------------|
| Align FE/BE DOB: reject unknown for net-new banded; keep unknown only as explicit unbanded exception | schemas + forms | Optional later CHECK | Tests for missing/future DOB |
| Improve `describeApiError` for 404/422/409 | `client.ts` | — | Actionable messages |
| Physical-device matrix after deploy | QA | Disposable data | List/add/band/transfer/mortality |

**Which fixes need no DB change:** P1 header fix; UI gate removal **if** server auto-creates flock; error message mapping; deploy-only P0.

**Which need backend (not necessarily migration):** auto-provision flock endpoint/service; deploy new routes.

**Which need schema (optional later):** nullable `flock_id`, shed-level unbanded table, NOT NULL DOB columns.

---

## H. Test plan (before declaring fixed)

1. **API:** empty shed → register banded with DOB; empty shed → add unbanded; band-from-unbanded idempotency; transfer; mortality; duplicate band → 409/400.
2. **Authz:** farmer unassigned shed → 403; inactive shed → blocked writes.
3. **Contract:** OpenAPI smoke that preview API URL exposes `in-shed`, `overview`, `add_unbanded`.
4. **UI:** single back button on Birds / Add unbanded / Overview; register enabled with zero flocks.
5. **Counts:** banded+unbanded=live; conversion preserves total; concurrent double-submit.
6. **Physical device:** install APK against **deployed** matching API; disposable QA org only.
7. **Regression:** existing `pytest` suite (local currently 100 passed as of prior QA).

---

## I. Outstanding questions / blockers

1. **Production server logs** for the exact 500 on “add unbanded” (stack trace / request id) — not available in this audit.
2. **Who owns production deploy** of `3.6.160.64.sslip.io` and what commit is running?
3. Product confirmation: is a **hidden auto-flock** acceptable forever, or is a future shed-level ledger required?
4. Should the Batches tab remain for power users after shed-centric UX?

---

## Investigations performed

- Read `(app)/_layout.tsx`, `Screen.tsx`, `AddBirdsSheet.tsx`, birds list/add/add-unbanded/profile, `client.ts`, `eas.json`, flock/bird models, `flock_service` DOB/create/band-from-unbanded, migration `0003`.
- Compared **local OpenAPI (`:8002`)** vs **production OpenAPI (sslip)** — confirmed missing routes/fields on production.
- Did **not** modify code, schema, or production data.
- Did **not** authenticate against production to force write-path 500 reproduction.

---

## Implementation follow-up (2026-10-20)

Approved direction implemented in-repo. See `BIRD_MANAGEMENT_IMPLEMENTATION_STATUS.md`.

**Stop for APK:** production deploy of `3.6.160.64.sslip.io` is still required before a physical-device preview build can be declared successful.
