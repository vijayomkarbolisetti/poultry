# Poultry Vaccine Tracker --- Product Requirements Specification

**Document status:** Product requirements baseline  
**Product:** Poultry Vaccine Tracker  
**Target platform:** Android mobile app  
**Current technical direction:** Flutter + Supabase (authentication,
PostgreSQL, Row-Level Security)  
**Primary users:** Farm Owner and Farmer  
**Primary purpose:** Track flock/shed health, vaccine schedules,
deworming, completion and overdue status, reminders, and farm-wide
operational overview.

------------------------------------------------------------------------

## 1. Product vision

Build a reliable, easy-to-use poultry health tracker that supports both  
shed-level batch tracking and individual-bird tracking. An owner can  
manage multiple farmers and owner-managed sheds, see every shed they own  
or manage---including sheds assigned to their farmers---and monitor  
vaccine compliance across the whole operation. A farmer can see and  
update only the sheds assigned to that farmer.

The app must support farms that join at any bird age, from day-old
chicks to mature birds. It must calculate schedules from each bird or
flock's recorded hatch/date-of-birth information and must not assume
every bird starts at day one.

## 2. Core business rules

1. One owner can manage multiple farmers.
2. An owner can have their own sheds and can assign/manage other sheds

   through farmers.
3. An owner can view all sheds in their own account scope, including:
   - Owner-managed sheds.
   - Sheds assigned to their farmers.
4. A farmer can view and operate only the sheds assigned to that farmer

   under that owner. A farmer must never see another farmer's sheds or
     another owner's data.
5. Each shed contains one or more birds and may contain one or more

   batches/flocks over time.
6. A bird may have a unique band ID, but banding is optional.
7. **If a bird has no band ID, track vaccine activity at batch/flock or

   shed level. Do not force the user to create a fake individual
     identity.**
8. When a band ID is present, the bird can be tracked individually,

   including its vaccine history and current status.
9. Support both individual actions and bulk actions for onboarding and

   vaccine recording.
10. Vaccine definitions and their schedule timing are owner-controlled

    and configurable; schedules must not be hard-coded in the app.
11. Vaccine events and historical records must remain auditable even if

    a vaccine definition is later edited, disabled, or deleted from
      future use.
12. Birds/flocks that are sold, dead, transferred out, or otherwise

    inactive must not continue to receive ordinary active-flock
      reminders after their effective end date.
13. Record the difference between "not yet due," "due," "completed on

    time," "completed late," "overdue," "skipped," and "not applicable."
14. A status must be calculated from schedule rules and recorded events;

    users must not be able to mark a vaccine completed without recording
      the required completion details.

## 3. Roles and permissions

### 3.1 Owner

The owner can: - View an overview across all owner-managed sheds and all
sheds assigned to their farmers. - Create, edit, deactivate, and manage
farmer accounts/assignments. - Create and manage sheds and assign a shed
to owner-managed or farmer-managed operation. - Onboard birds
individually or in bulk. - Configure vaccine/deworming definitions and
schedule rules. - View shed-level, batch-level, and banded-bird-level
vaccine status. - Record or correct vaccine events, subject to audit
rules. - View alerts, reports, history, and compliance summaries across
their scope. - Reassign a shed or flock to another farmer with a
recorded effective date. - Archive vaccine definitions so they are no
longer used for new schedules.

### 3.2 Farmer

A farmer can: - View only their assigned sheds and birds/flocks in those
sheds. - View their shed and vaccine overview. - Onboard birds/flocks in
assigned sheds, subject to owner-configured permissions. - Record
vaccine/deworming completion for assigned sheds, individually or in
bulk. - View due, overdue, completed, and upcoming schedules for
assigned sheds. - Receive reminders for assigned sheds. - Record
operational events such as mortality, sale, or transfer if permitted.

A farmer cannot: - View other farmers' sheds or data. - View another
owner's farm data. - Change global vaccine definitions or schedule
rules. - Assign farmers, change owner-level settings, or manage users
unless explicitly granted an additional permission.

### 3.3 Authorization requirements

- Enforce authorization in the backend/database, not only by hiding UI
elements.
- Use Supabase Row-Level Security (RLS) policies for every table
containing owner, farmer, shed, flock, bird, schedule, vaccine
event, or alert data.
- Derive the active role and allowed scope from authenticated
membership records; do not trust a role or owner ID supplied by the
client.
- Test direct API/database access attempts as well as normal UI flows.
- An owner must not gain access to another owner's data merely because
a farmer or shed has a matching display name.

## 4. Information hierarchy and data model concepts

Use the following logical structure:

```text
Owner
 ├── Farmers (0..N)
 ├── Owner-managed sheds (0..N)
 └── Farmer-managed sheds (0..N)
      └── Flocks/Batches (1..N over time)
           ├── Unbanded birds tracked by flock/batch counts
           └── Banded birds tracked individually
                ├── Vaccine schedule instances
                ├── Vaccine administration history
                └── Lifecycle / movement history
```

### Required entities

- **Owner account:** Account identity and farm-level settings.
- **Farmer membership:** Farmer identity, owner relationship,
active/inactive state, and permissions.
- **Shed:** Shed name/code, owner, current manager, location/notes,
status, and created date.
- **Flock/batch:** Shed, batch identifier, breed/strain if applicable,
hatch/DOB date or date range, initial count, current count,
onboarding date, tracking mode, and status.
- **Bird:** Optional individual record for a bird with a band ID; may
include DOB, breed, sex if known, sire/father and dam/mother
references if known, and lifecycle status.
- **Vaccine definition:** Name, category, active/archive state,
instructions/notes, dose/route fields if required, and applicable
bird/flock criteria.
- **Schedule rule:** Vaccine definition, target age or interval,
repeat interval, grace period, start/end constraints, applicability,
and effective date/version.
- **Scheduled vaccine instance:** The expected vaccine for a
particular bird or flock at a particular due date.
- **Vaccine administration event:** Actual date/time, vaccine
definition/version, administered count, target scope, recorded by,
optional batch/lot number, expiry, dose/route, notes, and
correction/audit metadata.
- **Alert/notification:** Target user, target shed/flock/bird,
schedule instance, alert type, delivery state, and timestamps.
- **Lifecycle event:** Mortality, sale, transfer, flock closure, band
assignment, count adjustment, or other status change.
- **Audit log:** Who changed what, when, and why for important records
and configuration.

The implementation may normalize these into additional tables. Preserve
explicit owner scope and history.

## 5. Vaccine and deworming schedule configuration

### 5.1 Owner-managed vaccine catalogue

The owner can: - Add a vaccine or deworming item at any time. - Edit its
name, instructions, schedule rules, and applicability. - Set the target
age in days/weeks/months or a repeat interval. - Configure one-time,
repeated, and age-based schedules. - Set optional grace periods and
reminder lead times. - Activate, pause, or archive a vaccine
definition. - Preview the effect of a schedule change before applying
it.

Seed examples may include **Marek's disease vaccine at day 1** and
**deworming every month**, but these are examples only. Actual schedules
must be configured and confirmed for the relevant flock, vaccine
product, breed/production type, and veterinary guidance. Do not present
examples as universal medical advice.

### 5.2 Editing and deleting vaccine definitions safely

- Do not physically delete a vaccine definition if it is referenced by
a schedule, alert, or administration record.
- Provide **Archive/Deactivate** as the normal delete action. Archived
items are excluded from newly generated schedules but remain visible
in historical records.
- If the owner edits a schedule, record a new version with an
effective date.
- Do not silently rewrite past due dates, administration history, or
previously completed records.
- Ask whether a change applies only to future onboardings, future
schedule instances, or eligible existing active flocks.
- When applying a change to existing flocks, preview affected records
and require confirmation.
- Recalculate only eligible future schedule instances; preserve
completed events and audit history.
- If a vaccine was added after flocks were already onboarded,
determine applicable due dates from each flock/bird's recorded age
and the new rule's effective date. Flag any historical/ambiguous
situation for review rather than fabricating a completion.

### 5.3 Schedule rule types

The system should support: - One-time at a target age (for example, day
1). - One-time at a specified age window. - Repeat at a fixed interval
(for example, every 30 days). - Multiple doses with configurable
intervals. - Optional age/production/breed applicability. - Optional
start date and end date. - Optional grace period and reminder lead
time. - Optional manual-only schedule items that do not generate
automatic reminders.

"Monthly" must have a clearly defined meaning in settings: calendar
month or fixed interval (for example, every 30 days). Do not mix the two
silently.

## 6. Onboarding flows

### 6.1 Initial setup

1. User creates an account and authenticates.
2. The system establishes the user's owner/farmer membership and

   permissions.
3. Owner adds a shed or selects an existing shed.
4. Owner may add farmers and assign sheds to them.
5. User creates a flock/batch or selects an existing one.
6. User enters hatch/DOB information, current count, breed/type if

   known, and onboarding date.
7. User selects tracking mode:
   - **Batch/flock tracking:** For unbanded birds; vaccine events and
     counts are tracked for the group.
   - **Individual tracking:** For birds with band IDs; each bird gets
   its own profile.
   - **Mixed tracking:** A flock can have banded birds plus an
   unbanded remainder, provided counts are reconciled and birds are
   not double-counted.
8. The app previews calculated vaccine schedules based on age and

   active rules.
9. User reviews exceptions and confirms onboarding.
10. The dashboard shows upcoming, due, overdue, and completed status.

### 6.2 Onboard at any age

- Onboarding must accept birds/flocks at any age, not only day-old
chicks.
- Capture the actual hatch/DOB date when known. If only age is known,
allow age value plus the date it was reported and derive an
estimated DOB.
- Mark whether DOB is exact, estimated, or unknown.
- If DOB is unknown, require a user-confirmed age estimate or mark
age-dependent schedules as **Needs age confirmation**. Do not
silently assume day one.
- Generate eligible schedule instances based on age and the schedule
rules.
- If a due date is already in the past, show it as overdue or
requiring review according to the rule. Never mark it complete just
because the bird was onboarded late.
- Let the user record a previous vaccine administration only when they
have evidence or explicitly mark it as an unverified historical
entry. Keep verified and unverified records distinguishable.
- Explain to the user which doses are already due, which are upcoming,
and which require review.

### 6.3 Individual onboarding

Required/optional fields: - Shed and flock/batch. - Band ID (required
for individual tracking and unique within the defined system scope). -
DOB/hatch date or estimated age. - Breed/type (optional where
unknown). - Father/sire and mother/dam (optional; support unknown
parents). - Onboarding date. - Optional notes and photo. - Prior vaccine
history, with administration date and verification status.

Validation: - Prevent duplicate active band IDs within the defined
uniqueness scope. - Allow a band ID to be corrected with an audit
trail. - Do not require parent information. - Confirm that the bird
belongs to the selected flock and shed.

### 6.4 Bulk onboarding

Support: - Entering a count for an unbanded flock. - Adding multiple
individual birds with band IDs. - Importing a CSV template for
individual birds. - Creating a flock and adding banded birds plus an
unbanded remainder. - Previewing imported rows, validating
duplicates/missing fields, and displaying row-level errors before
commit. - Confirming the total count and destination shed before
saving. - Showing a success/failure summary and allowing invalid rows to
be corrected and retried without duplicating successful rows.

Bulk onboarding must be transactional or idempotent where possible. A
retry must not create duplicate birds or flocks.

## 7. Bird, flock, and shed management

### 7.1 Shed overview

Each shed card/detail should show: - Shed name/code and current
manager. - Active flock/batch count. - Total active bird count. - Banded
individual count and unbanded count. - Vaccine compliance summary. -
Number of upcoming, due today, overdue, and completed schedule items. -
Last vaccine activity. - Any unresolved count or age-data issues.

### 7.2 Bird profile

For banded birds, show: - Band ID and identity details. - Current shed
and flock. - DOB/estimated age and age confidence. - Vaccine schedule
and event history. - Current status by vaccine. - Lifecycle and movement
history. - Father/mother details if provided. - Notes and relevant audit
history.

### 7.3 Flock/batch profile

For unbanded birds, show: - Batch ID, shed, DOB/hatch date or estimated
age. - Initial, current, banded, unbanded, sold, dead, and transferred
counts as applicable. - Schedule status and administration history. -
Number of birds covered by each group-level vaccine event. - Count
reconciliation and history.

### 7.4 Shed and bird lifecycle

- Support moving a flock or bird between sheds with a date and audit
record.
- Support sale, death/mortality, transfer out, and flock closure with
effective date and reason where appropriate.
- Update active counts without deleting historical records.
- Stop future reminders after the effective inactive date.
- If a bird is banded later, support converting it from the unbanded
flock count to an individual record without double-counting.
Preserve the original flock and vaccine history and ask whether
group-level events apply to that individual based on the recorded
coverage.
- Record the user and timestamp for every count adjustment.
- Prevent current counts from becoming negative and flag count
mismatches.

## 8. Vaccine administration flows

### 8.1 Individual completion

1. Open a banded bird or its due vaccine item.
2. Select the vaccine/scheduled dose.
3. Enter actual administration date/time (default to now, editable for

   historical records).
4. Enter administered status and required details.
5. Optionally enter batch/lot number, expiry, dose, route, notes, and

   evidence.
6. Confirm.
7. Recalculate the vaccine instance status and next due date.
8. Update the bird, flock, shed, owner dashboard, and relevant alerts.
9. Record who performed the action and when it was recorded.

### 8.2 Bulk shed/flock completion

1. Select a shed and the target flock/batch, or select a set of

   eligible birds.
2. Choose the vaccine and scheduled dose.
3. Review the eligible target count and excluded birds.
4. Enter the actual administration date/time and common administration

   details.
5. Confirm the number actually treated; allow partial coverage rather

   than forcing all birds to be marked complete.
6. Save per-target outcomes (completed, not given, skipped, or

   failed/needs review as applicable).
7. Show a clear summary: completed count, partial/not-treated count,

   errors, and remaining due count.
8. Ensure the same action cannot accidentally create duplicate

   administration records on retry.
9. Keep the bulk operation linked to the actor, target set, shed/flock,

   and event time.

A group-level event must not imply every bird was treated unless the
user confirms the actual coverage count. For mixed flocks, allow
selecting only the banded birds or the unbanded group as appropriate.

### 8.3 Corrections and reversals

- Do not silently edit or erase completed administration history.
- Allow an authorized correction with reason, previous value, new
value, actor, and timestamp.
- If an event was entered in error, mark it void/reversed while
preserving the audit record.
- Recalculate status after correction and notify relevant users if the
change creates an overdue item.

## 9. Status definitions

Status must be calculated per scheduled dose and then summarized at
bird, flock, shed, and farm level.

- **Upcoming:** Due date is in the future and outside the reminder/due
window.
- **Due today:** Due date is today and the dose is not recorded as
completed.
- **Due soon:** Due date falls within the configured reminder lead
time.
- **Overdue:** Due date plus configured grace period has passed
without a valid completion.
- **Completed on time:** Valid administration date is on or before the
due date (according to configured rule).
- **Completed late:** Valid administration occurred after the due
date; preserve that it was late.
- **Completed --- timing unknown:** Historical administration is
recorded but its timing cannot be confidently evaluated.
- **Skipped:** An authorized user records that the dose was
intentionally not given, with a reason where required.
- **Not applicable:** The rule does not apply to this bird/flock.
- **Needs review:** Missing/uncertain age, conflicting history,
schedule change, or data-quality issue prevents a reliable status.
- **Inactive:** The bird/flock is sold, dead, transferred out, or
closed; historical records remain available, but active reminders
stop.

A late completion must not rewrite history to show that the dose was
completed on time. A vaccine marked skipped must not be counted as
completed.

### Aggregate compliance

- Display numerator and denominator clearly (for example, eligible
doses completed on time / eligible doses due).
- Exclude not-applicable and inactive records from the active
denominator.
- Report late completions separately from on-time completions.
- Do not treat missing data as completed.
- Provide drill-down from farm → shed → flock → bird → vaccine event.

## 10. Alerts and notifications

### 10.1 Alert types

- Upcoming vaccine/deworming reminder.
- Due today.
- Overdue dose.
- Newly created overdue item after onboarding or schedule change.
- Partial bulk administration / birds still untreated.
- Unknown DOB/age or schedule needs review.
- Duplicate band ID or count mismatch requiring attention.
- Vaccine schedule changed by owner.
- Shed/farmer assignment changed.
- Optional operational alerts for mortality/count events, if enabled.

### 10.2 Notification rules

- Configurable reminder lead time and repeat frequency.
- Notify only users authorized to access the affected shed/flock/bird.
- Owners can receive a farm-wide digest and drill into affected sheds.
- Farmers receive alerts only for their assigned sheds.
- Avoid duplicate notifications for the same schedule instance and
reminder window.
- Mark alerts as read/acknowledged and retain notification history.
- In-app alerts are the baseline; push notifications can be added
where supported.
- If push delivery fails, the due/overdue status must still appear in
the app.
- Recompute or cancel future alerts after valid completion, schedule
changes, or lifecycle deactivation.
- Store timestamps consistently and display them in the user's local
timezone.

## 11. Dashboards and reports

### 11.1 Owner dashboard

Show: - Total active sheds, farmers, flocks, and birds. - Owner-managed
versus farmer-managed sheds. - Overall on-time compliance. - Due today,
due soon, overdue, and needs-review totals. - Shed compliance
ranking/filtering. - Recent vaccine activity. - Alerts grouped by
severity and shed. - Filters by farmer, shed, flock, date range,
vaccine, and status.

### 11.2 Farmer dashboard

Show the same useful operational indicators but only for the farmer's
assigned sheds.

### 11.3 Reports

- Vaccine compliance by owner, farmer, shed, flock, and bird.
- Overdue schedule report.
- Administration history report.
- On-time versus late completion report.
- Coverage count report for bulk events.
- Active/inactive bird and flock counts.
- Lifecycle/movement report.
- Vaccine catalogue and schedule change audit.
- Export to CSV/PDF may be delivered in a later phase, but the data
model should support it.

## 12. Recommended screen flow

### Owner flow

```text
Sign in
  → Owner Dashboard
    → Farmers
      → Add/Edit Farmer
      → Assign Sheds
    → Sheds
      → Create/Edit Shed
      → Assign Manager
      → Shed Detail
        → Flocks/Batches
          → Create Flock / Onboard Birds
          → Bulk Onboard / Import
          → Individual Bird Detail (banded only)
    → Vaccine Settings
      → Add/Edit Schedule
      → Preview Impact
      → Confirm Effective Date
    → Alerts
      → Alert Detail
      → Resolve / Navigate to Due Item
    → Reports
```

### Farmer flow

```text
Sign in
  → My Dashboard
    → My Sheds
      → Shed Detail
        → Flocks/Batches
          → Onboard Birds / Update Counts
          → Due Vaccines
          → Individual Bird (if banded)
          → Bulk Vaccination
          → Record Mortality / Sale / Transfer (if permitted)
    → My Alerts
    → My Reports (assigned sheds only)
```

### Vaccination action flow

```text
Dashboard / Alert
  → Select shed
  → Select flock, bird, or eligible group
  → Select due vaccine
  → Review due date and target count
  → Record administration details
  → Confirm
  → Save event + audit log
  → Recalculate status and next due date
  → Update dashboard and alerts
```

## 13. Data integrity, privacy, and reliability

- Every tenant-owned record must have a trustworthy owner scope and
appropriate relationships.
- Enforce foreign keys and database constraints for ownership,
shed/flock membership, and event references.
- Use database transactions for bulk onboarding and bulk vaccine
completion.
- Use idempotency keys or equivalent protections for retried bulk
actions.
- Use soft deletion/archive for entities referenced by historical
records.
- Store all timestamps consistently (UTC in storage is recommended)
and display in local time.
- Keep audit records for vaccine configuration, administration
corrections, role/assignment changes, lifecycle events, and bulk
operations.
- Validate imports and user input on both client and backend.
- Do not expose other owners' or farmers' data through search,
exports, notifications, logs, or error messages.
- Provide backup/recovery and migration practices before production
launch.
- Handle poor connectivity with clear loading/error states. Offline
write support is optional for MVP; if implemented, it must resolve
duplicate/conflicting writes safely.

## 14. Non-functional requirements

- Android-first UX, suitable for everyday farm use.
- Simple, readable screens with clear status colors and text labels;
status must not rely on color alone.
- Support many sheds, many flocks, and hundreds/thousands of birds
without loading all records at once.
- Paginate and filter lists; avoid unnecessary repeated database
calls.
- Use accessible touch targets and clear confirmation for destructive
or bulk operations.
- Display useful empty states and actionable error messages.
- Protect authentication tokens and sensitive farm data.
- Automated tests must cover schedule calculations, permissions, bulk
actions, status transitions, and historical preservation.

## 15. MVP scope and delivery phases

### MVP --- required

1. Authentication and owner/farmer authorization.
2. Owner, farmer, and shed management.
3. Flock/batch creation and age-aware onboarding.
4. Optional band ID and individual bird profiles.
5. Individual, batch, and mixed tracking rules.
6. Dynamic vaccine/deworming catalogue and schedule rules.
7. Age-based schedule generation for new and existing onboarded flocks.
8. Individual and bulk vaccine recording.
9. Upcoming/due/overdue/completed status calculation.
10. In-app alerts and dashboard summaries.
11. Lifecycle actions that stop reminders while preserving history.
12. Audit trail for configuration and vaccine events.
13. RLS/security tests and schedule unit tests.

### Phase 2 --- recommended

- CSV bulk import with downloadable template.
- Push notifications and owner digest.
- CSV/PDF reports.
- Photos and supporting evidence.
- Enhanced offline support.
- More advanced analytics and trend charts.

## 16. Acceptance criteria

### Permissions

- Given an owner with multiple farmers and sheds, when the owner opens
the dashboard, then all sheds in that owner's scope are visible and
filterable by farmer.
- Given a farmer assigned to one shed, when they browse or query data,
then they cannot access any unassigned shed, flock, bird, vaccine
event, or report---even through direct API/database requests.
- Given two owners with similarly named sheds, then neither owner can
access the other's data.

### Tracking

- Given a flock with unbanded birds, when the user records a vaccine,
then the event is recorded at flock/batch level with the actual
coverage count.
- Given a bird with a band ID, when the user opens the bird, then its
individual vaccine history and calculated statuses are visible.
- Given a flock with both banded and unbanded birds, when a bulk
vaccine is recorded, then the user can select the applicable target
group and counts remain reconciled.

### Onboarding and schedules

- Given a flock onboarded at an age other than day one, when
onboarding is confirmed, then the system calculates schedules from
the recorded/estimated age and flags already-due doses instead of
marking them complete.
- Given unknown age, when age-based schedules cannot be calculated
reliably, then the app displays "Needs age confirmation/review."
- Given an owner adds a schedule rule, when the rule becomes
effective, then eligible flocks are evaluated and affected schedules
are generated according to the configured scope.
- Given an owner edits or archives a vaccine, then historical
administration records remain intact and past statuses are not
silently rewritten.

### Vaccine completion and status

- Given a dose is completed after its due date, then the status
becomes "Completed late," not "Completed on time."
- Given a bulk event treats only some birds, then only the confirmed
covered birds/count are recorded as completed and the remainder stay
due/overdue.
- Given a bird/flock is marked sold, dead, transferred out, or closed
with an effective date, then future reminders stop after that date
and history remains accessible.
- Given an administration event is corrected, then the original and
corrected values, actor, time, and reason remain auditable.

### Alerts and dashboard

- Given a schedule becomes due or overdue, then the appropriate
authorized users see the correct alert and dashboard count.
- Given a vaccine is completed, a schedule is changed, or a flock
becomes inactive, then obsolete reminders are canceled/recomputed
without duplicate alerts.
- Dashboard counts reconcile with the underlying eligible schedule
instances.

## 17. Important edge cases

- Duplicate band ID entered during single or bulk onboarding.
- Missing, estimated, or corrected DOB.
- Flock count differs from the sum of banded and unbanded birds.
- A bird receives a band after being tracked within a flock.
- A bird moves between sheds or farmers.
- A shed is reassigned while reminders are pending.
- A farmer is deactivated while assigned sheds still contain active
birds.
- Vaccine definition is archived while future schedule instances
exist.
- Schedule interval changes after doses have been completed.
- Historical vaccination date is unknown or unverified.
- Partial coverage, skipped dose, failed entry, and duplicate
submission.
- Bird/flock is sold, dies, or transfers after a reminder was queued.
- Two users attempt to update the same flock count or vaccine event.
- No internet connection or notification delivery failure.

## 18. Decisions to confirm before final implementation

These are policy choices that should be configurable or explicitly
approved; they should not be guessed in code:

1. **Owner control over farmer edits:** Can farmers create/edit sheds

   and vaccine records freely, or must some actions require owner
     approval?
2. **Age uncertainty:** If only an age estimate is known, may the user

   generate schedules immediately, or must the owner confirm first?
3. **Historical records:** Which roles can add backdated vaccine

   events, and should evidence/reason be mandatory?
4. **Bulk completion:** Is a single total count enough, or should users

   optionally select individual banded birds within a mixed flock?
5. **Schedule changes:** Should owner edits affect all active flocks,

   only new onboardings, or a selected subset? The recommended default
     is preview + explicit scope + effective date.
6. **Monthly deworming:** Should "monthly" mean every 30 days or the

   same calendar day each month?
7. **Notifications:** Which reminder lead times and repeat cadence

   should be defaults?
8. **Band ID uniqueness:** Is a band ID globally unique across the

   owner's entire farm, or only unique within a flock/shed?
     Recommended: unique within the owner account while active, with an
     auditable correction/reuse policy.
9. **Multiple owners:** Can one farmer account work for more than one

   owner? If yes, memberships must be separate and data isolation must
     remain strict.
10. **Veterinary configuration:** Who approves the initial vaccine

    catalogue and schedules before real farms use them?

## 19. Definition of done

A feature is not complete just because its screen exists. It is done
only when: - UI, database schema, backend operations, and authorization
are connected. - Owner/farmer permissions are enforced and verified with
negative tests. - Schedule/status calculations have automated unit
tests. - Bulk operations are validated, auditable, and safe to retry. -
Historical records are preserved through edits, archive actions, and
lifecycle changes. - Loading, empty, success, validation, and failure
states are implemented. - Relevant unit, integration, and security/RLS
tests pass. - Documentation is updated and any unverified production
configuration is explicitly reported.

------------------------------------------------------------------------

## Summary

The product is a **farm-level vaccine compliance system** with two
complementary tracking modes: **individual tracking for banded birds**
and **batch/flock tracking for unbanded birds**. Its most important
design requirements are strict owner/farmer data isolation, onboarding
at any age, configurable age-based schedules, safe bulk operations,
trustworthy status calculations, actionable alerts, and preservation of
historical records.
