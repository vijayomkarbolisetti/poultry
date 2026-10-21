# Bird onboarding, tagging, and shed / batch assignment

This document explains how birds are linked to **sheds** and **batches** (flocks) in PoultryTrack, how banding works, and how onboarding is done in the app.

> **Naming:** In the UI we say **batch**. In the API and database the same record is a **flock** (`flocks` table, `flock_id`). They are the same thing.

---

## 1. How things fit together

```
Owner account
  └── Shed (physical housing unit)
        └── Batch / Flock (group of birds with a batch code)
              ├── Unbanded population (counts only)
              └── Banded birds (individual bird records with band IDs)
```

| Entity | What it is | Key identifiers |
|--------|------------|-----------------|
| **Shed** | Place where birds live | Name, shed code |
| **Batch (flock)** | A group onboarded into one shed | `batch_code` (unique per owner) |
| **Bird** | Individual animal record (usually banded) | Optional `band_id` |

Rules that always hold:

1. Every **batch** belongs to exactly one **shed** (`flock.shed_id`).
2. Every **bird** belongs to exactly one **batch** and one **shed** (`bird.flock_id` + `bird.shed_id`).
3. A bird’s shed is **not chosen separately** when you add the bird. You pick a batch; the bird inherits that batch’s shed.

---

## 2. How birds are tagged (banding)

**Tagging** means giving a bird a **band ID** (`band_id`) — a wing tag / leg band number used for individual tracking.

| | Banded bird | Unbanded bird |
|---|-------------|----------------|
| Record | Yes — row in `birds` | Usually **no** individual row |
| Tracked by | Band ID + bird profile | Batch / shed **counts** |
| Vaccination | Can be recorded per bird | Recorded at batch (or shed) level |

### Band rules

- Banding is **optional** for the farm overall; required when you create an individual bird from the mobile “Add bird” flow.
- Active band IDs must be **unique within the owner account**. You cannot reuse an active band on another bird.
- When a band is set, `display_code` usually mirrors it.
- Editing a bird can correct band / age / breed notes; it does **not** move the bird to another shed or batch.

### Tracking modes on a batch

Each batch has a `tracking_mode`:

| Mode | Meaning |
|------|---------|
| **batch** | Count-only headcount; no (or not yet) banded individuals |
| **individual** | All birds expected as banded individuals (`unbanded_count` starts at 0) |
| **mixed** | Some birds banded as individuals + an unbanded remainder count |

If you add a banded bird to a **batch**-mode flock, the system automatically promotes that flock to **mixed**.

---

## 3. How birds get assigned to sheds

Birds are tied to sheds **through batches**:

1. Create (or choose) a **shed**.
2. Create a **batch** in that shed (`POST /flocks` with `shed_id`).
3. Add birds to that **batch** (`POST /birds` with `flock_id` only).
4. On create, the server sets `bird.shed_id = flock.shed_id`.

You never pass `shed_id` on the bird create payload. Changing a bird’s shed later by updating the bird is **not** supported; placement is fixed at onboarding via the batch.

Inactive sheds block **new** batches, birds, and schedules. Existing history remains readable.

---

## 4. How batches are assigned to sheds

### Creating a batch

From the mobile app: **Batches → Add batch**, or from a shed detail screen (shed pre-selected).

Required / important fields:

- **Shed** (`shed_id`) — where this batch lives
- **Batch code** — unique per owner (stored uppercased)
- **Initial count** — starting headcount
- **Tracking mode** — batch / individual / mixed
- **Age** — exact hatch date, estimated age in days, or unknown
- Optional: breed, notes, explicit unbanded count

Defaults for unbanded count if not provided:

- `individual` → `unbanded_count = 0`
- `batch` / `mixed` → `unbanded_count = initial_count`

Creating a batch writes an **onboarding** lifecycle event and an audit log entry.

### What you cannot change later

- A batch’s **shed** cannot be moved via flock update (only breed, notes, status, current count).
- “Transfer” in the app means **transfer out** (bird/batch exit), not “move to another shed.”

---

## 5. Bird onboarding flows

### 5.1 Recommended order

1. Create the **shed** (and assign a farmer if needed).
2. Create a **batch** in that shed (age + count + tracking mode).
3. Optionally generate / attach vaccine schedules for the batch.
4. Add **banded birds** one-by-one or via bulk import into that batch.
5. Keep unbanded headcount reconciled (`banded_count` + `unbanded_count` vs `current_count`).

You can onboard at **any age** (day-old chicks through mature birds). Schedules use the recorded hatch / estimated age — the app does not assume every bird starts at day one.

### 5.2 Individual bird onboarding (single add)

**API:** `POST /birds`  
**Mobile:** Shed birds section → Add bird, or from batch detail.

Payload is built around the **batch**:

- Required: `flock_id`
- Typical: `band_id`, age fields (`dob_confidence` + hatch date or estimated age), optional breed / sex / notes
- **No** `shed_id` in the request

What the server does:

1. Checks shed access (`bird.create`) and that the shed accepts new records.
2. Sets `shed_id` from the flock.
3. Rejects duplicate active band IDs (`DUPLICATE_BAND`).
4. If the flock was pure batch mode and a band is provided → switches flock to **mixed**.
5. Falls hatch date / breed back to the flock when the bird omits them.
6. Reconciles banded / unbanded / current counts.

### 5.3 Bulk banded onboarding

**API:** `POST /birds/bulk-import` with `flock_id` + rows (each row needs a `band_id`).

- Promotes batch-mode flocks to **mixed**.
- Skips duplicate bands (in file or already in the account) and reports per-row errors.
- Can use an idempotency key so retries do not double-create.
- Records a `band_assignment` lifecycle event for the import.

### 5.4 Unbanded population (count-only)

Unbanded birds are **not** listed as individual bird cards. They appear as batch summaries (counts) on shed / batch screens.

Lifecycle actions like mortality, sale, or transfer-out can be applied:

- To a **specific banded bird**, or
- As a **count-only** quantity against the unbanded remainder (not allowed when tracking mode is `individual`).

---

## 6. Mobile entry points (shed-centric UX)

Primary path (recommended):

| Goal | Where in the app |
|------|------------------|
| Add birds to a shed | Shed overview → **Add birds** |
| New headcount group | Add birds → **New group of birds** wizard |
| Band / tag individuals | Add birds → **Tag birds already here** |
| Rapid consecutive banding | Tag birds → **Save & add another** |

Also available:

| Goal | Where |
|------|--------|
| Advanced batch create (tracking mode) | Batches tab → Add batch |
| Tag from birds list | Shed birds section → Tag bird |
| Search a band | Global search / bird search |
| Exit bird (sold / dead / transferred out) | Bird profile or multi-select → lifecycle actions |

See also: `mobile/docs/BIRD_MANAGEMENT_UX_IMPLEMENTATION_REPORT.md`.

---

## 7. Quick mental model

```
Tagging          = assign band_id to an individual bird
Batch assignment = choose flock_id when creating the bird
Shed assignment  = automatic from that flock’s shed_id
Unbanded birds   = live in batch counts, not as bird rows
Transfer         = leave the farm (transferred_out), not relocate to another shed
```

---

## 8. Related code (for developers)

| Topic | Location |
|-------|----------|
| Bird / flock models | `backend/app/models/flock.py` |
| Create / update schemas | `backend/app/schemas/flock.py` |
| Create flock / bird / bulk | `backend/app/services/flock_service.py` |
| HTTP routes | `backend/app/api/v1/birds.py`, `flocks.py`, `lifecycle.py` |
| Mobile add bird | `mobile/app/(app)/birds/add.tsx` |
| Mobile create batch | `mobile/app/(app)/flocks/create.tsx` |
| Product requirements | `poultry_vaccine_tracker_requirements.md` (§6 Onboarding) |
