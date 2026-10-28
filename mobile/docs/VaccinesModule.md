Vaccine Tracker — New Module Product Requirements & Implementation Plan
Planning document · Version 1.0 · 23 October 2026 · No code changes or migrations authorized

The new Vaccine Tracker module will be designed from scratch around the farmer's daily workflow, not around database tables or technical schedule configuration.

Core principle: open the Vaccination dashboard, see which birds need attention, select the birds or group, record the vaccination in as few steps as possible, and retain a reliable history.

The existing mobile vaccination workflow has been removed. Backend vaccination APIs, catalogue data, historical events, and database migrations remain available for assessment. We will reuse only the parts that satisfy the new requirements.
1. Product vision and scope
Goals
- Give owners a consolidated view of vaccination activity across their farms and sheds.
- Give farmers access only to their assigned sheds and permitted operations.
- Automatically calculate vaccination due dates from hatch dates and the selected schedule.
- Support both individually banded birds and unbanded groups.
- Make vaccinating all eligible birds or selected individual birds a straightforward action.
- Keep the vaccine catalogue simple and focused on practical product information.
- Prevent duplicate vaccination records and accurately represent partial group coverage.
Non-goals for the first release
- Rebuilding the entire farm, bird, or flock management application.
- Deleting or replacing historical vaccination records.
- Inventing veterinary recommendations or automatically approving vaccine schedules.
- Adding QR workflows, automated reminders, or photo uploads before the core workflow is stable.
- Building a complex veterinary programme editor when a simple catalogue will suffice.
2. Product requirements

PR-01 — Vaccination dashboard

Show overdue, due today, upcoming, and recently completed vaccinations. Provide filters for farm, shed, vaccine, and status where appropriate.




PR-02 — Automatic scheduling

Calculate due dates using hatch date and the selected schedule's age offsets. Recalculate safely when relevant source data changes, without duplicating tasks or rewriting historical events.




PR-03 — Two bird-tracking modes

Support individual banded birds and unbanded population groups. Display the correct population counts and avoid requiring individual bird records before banding.




PR-04 — Fast vaccination recording

Offer “Vaccinate all eligible” and “Select birds” actions. Show eligibility, confirmation, and recorded counts before and after submission. Prevent double submissions.




PR-05 — Simple vaccine catalogue

Show vaccine name, recommended age, disease targeted, dose or concentration, route, and diluent/reconstitution instructions. Missing values must be explicit, never fabricated.




PR-06 — Reliable history and auditability

Preserve administration dates, vaccine details, population coverage, and correction history. Individual bird history must not falsely imply that every bird in a group was vaccinated individually.



Roles and permissions
Capability	Owner	Farmer
View vaccination dashboard	All authorized farms/sheds	Assigned sheds only
View individual and group eligibility	Within owner scope	Within assigned scope
Record vaccinations	Within owner scope	Subject to assigned-shed and permission checks
Manage vaccine catalogue	Authorized owner/admin	Only if explicitly permitted
View history and reports	Within owner scope	Within assigned scope and permissions

Backend authorization remains authoritative. Hiding a button in the mobile app is not sufficient security.
3. Proposed screen flow
The mobile app should have one clear vaccination entry point: Vaccination. It should not recreate the old collection of disconnected Tasks, Doses, Vaccines, and Catalogues screens.
Vaccination dashboard

Overdue · Due today · Upcoming · Recent

Choose a due vaccination

Vaccine, due date, farm and shed

Select coverage

All eligible birds · Select birds · Unbanded group

Record vaccination

Date · Dose · Route · Brand · Batch · Expiry

Confirmation

Birds recorded · Birds remaining · Next due dates


Screen A — Vaccination dashboard
The dashboard should answer three questions immediately:
1. What needs vaccination?
2. Where are those birds?
3. How do I record it?
Suggested layout:
- A compact summary of overdue, due today, and upcoming vaccinations.
- A prioritized list of due vaccinations.
- Each card displays vaccine name, due age/date, shed, eligible bird count, and coverage type.
- A primary Vaccinate action.
- A secondary Vaccination history action.
- A clear route to Catalogues, without making catalogue administration the main workflow.
Do not show internal database IDs, raw schedule offsets, duplicate programme cards, or long technical explanations.
Screen B — Coverage selection
After selecting a vaccination, the app should determine which eligible birds need it.

Vaccinate all eligible birds

Show the number eligible and the number already recorded. One action selects the remaining eligible population, followed by a confirmation step.



Select individual birds

Search and select banded birds. Display each bird's identity and vaccination eligibility, and make selection counts visible.



Unbanded group

Show the eligible group population and let the user record the actual number vaccinated. Support partial coverage without falsely marking the entire group complete.



Critical rule: eligibility is not the same as coverage. Selecting 63 eligible birds does not mean 63 birds were vaccinated. The saved record must reflect what actually happened.
Screen C — Record vaccination
Use a compact form with clear defaults and minimal required interaction.
Field	Proposed behavior
Vaccine	Preselected from the due vaccination; editable only when appropriate
Administration date	Defaults to today; supports an authorized historical date
Number of birds	Pre-filled from selected eligible birds or group; editable where partial coverage is supported
Dose / concentration	Show approved product guidance; distinguish guidance from the amount actually administered
Route	Pre-fill from product guidance if available
Manufacturer / brand	Optional where not known
Batch / lot number	Capture where available
Expiry date	Capture where available
Notes	Optional
Label photo	Deferred until reliable media storage is available

Remove the old question “Why are you recording this vaccination?” from the normal flow.

Before saving, show a concise summary such as: “Record this vaccination for 63 birds in Shed A?” Do not ask users to confirm the same information across multiple screens.
Screen D — Confirmation
After a successful save, display:
- Vaccine name and administration date.
- Number of individual birds recorded.
- Number of unbanded birds covered, if applicable.
- Any eligible birds left unvaccinated.
- The next due vaccination, if known.
- A link to the relevant history.
The save action must be idempotent or protected against duplicate submissions so that repeated taps or network retries do not create duplicate vaccination records.
Screen E — Catalogues
Keep the title Catalogues.

The catalogue is a reference for vaccine product information, not the main vaccination workflow. Each vaccine should show:
1. Vaccine name.
2. Age to administer.
3. Disease targeted.
4. Recommended dose/concentration.
5. Route of administration.
6. Diluent/reconstitution instructions.
Use the existing simplified catalogue layout as a starting point only if it satisfies these requirements. Do not bring back the old programme-management interface. Missing product data must remain clearly marked as unspecified.

4. Scheduling rules
The scheduling engine must produce predictable due dates from hatch dates and approved schedule definitions.

For each schedule rule:
\[
\text{Due date} = \text{Hatch date} + \text{Target age in days}
\]

The exact interpretation of hatch day (Day 0 or Day 1) must be consistent with the existing approved schedule data and verified before implementation.
Eligibility states
State	Meaning
Overdue	Due date has passed and vaccination is still outstanding
Due today	Due date matches today and coverage is outstanding
Upcoming	Due date is in the future
Completed	Required coverage has been recorded
Partially covered	Some, but not all, eligible population is recorded
Needs review	Required source information is missing or conflicting

A bird with no reliable hatch date should not receive a fabricated due date. It should be marked as needing review until the missing information is resolved.

When a flock changes catalogue or hatch data, the system must not silently rewrite historical events. It must also avoid duplicate schedules and preserve any supported flock-specific overrides.
5. Data and API reuse assessment
The aim is to rebuild the mobile experience while retaining reliable backend capabilities where they match the new product requirements.

The following is a preliminary assessment based on the project reports so far, not a fresh repository audit. Exact endpoint contracts and transaction behavior must be inspected before implementation.
Existing capability	Recommendation	Reason
Authentication and owner/farmer permissions	Reuse	Existing access boundaries should remain intact
Farms, sheds, flocks, birds, banding	Reuse	These define vaccination population and scope
Vaccine definitions and schedule rules	Assess and reuse	May support hatch-based due dates
Vaccine catalogue items and assignments	Reuse selectively	Existing catalogue data can supply product details
Flock catalogue overrides	Reuse if compatible	Preserves flock-specific schedule configuration
Scheduled-dose/task APIs	Inspect before reuse	Must correctly support eligibility, partial coverage and duplicate prevention
Vaccination batch-recording API	Inspect before reuse	Must reliably support individual birds and unbanded populations
Vaccination events and correction history	Reuse	Historical records should remain intact
Bird vaccination reports and history endpoints	Reuse selectively	Avoid rebuilding working reporting logic unnecessarily
Media APIs	Defer for MVP	Optional photos must not block the core vaccination workflow

Important questions the audit must answer
Before committing to the design, the coding agent must verify:
- Can one vaccination operation cover individual bird IDs and an unbanded population without ambiguity?
- Does the backend track the number actually vaccinated separately from the number eligible?
- How does it prevent duplicate vaccination events when the client retries a request?
- How are due dates recalculated after hatch-date or catalogue changes?
- Can the current APIs report partial coverage accurately?
- Can the backend distinguish an individual event from a population-level event in history and reports?
- Are farmer permissions enforced for every read and write operation?
If an existing endpoint cannot support the requirements, document the gap and propose the smallest compatible change. Do not work around missing backend guarantees by hiding the problem in the mobile UI.
Data boundaries
The new module should preserve these distinctions:
- Product guidance: what the vaccine manufacturer's approved instructions say.
- Schedule rule: at what age the vaccine is intended to be administered.
- Eligibility: which birds or population are due.
- Vaccination event: what was actually administered, when, and to which birds or population.
- Coverage: how much of the eligible population was actually vaccinated.
These are related, but they must not be treated as interchangeable data.

6. Phased implementation plan
0

Requirements and backend audit
First
Inspect the repository, current API contracts, schema, scheduling engine, batch recording, permissions, and history. Confirm the screen flow and document gaps.

Deliverable: requirements, endpoint mapping, risk register, acceptance criteria. No code changes.



1

Dashboard foundation

Build the Vaccination entry point, status summaries, due-vaccination list, farm/shed scoping, loading/error/empty states, and navigation.

Deliverable: functional dashboard using verified backend data.



2

Automatic schedule and eligibility

Connect hatch dates, schedule rules, due dates, banded birds and unbanded populations. Validate missing dates, inactive birds, flock overrides, and partial coverage.

Deliverable: reliable list of who is due and why.



3

Vaccination recording

Implement group and individual selection, concise confirmation, actual coverage counts, event persistence, retry protection, and success/error handling.

Deliverable: end-to-end vaccination recording without duplicate events.



4

Simple Catalogues

Connect vaccine product information, administration ages, disease labels, dose guidance, routes, and diluent instructions. Decide on an authorized data-entry path for missing information.

Deliverable: a usable, accurate vaccine reference catalogue.



5

History, reports and hardening

Verify individual versus population history, partial coverage, owner/farmer isolation, concurrent submissions, schedule recalculation, and regression behavior.

Deliverable: tested pilot candidate with a documented set of known limitations.



Testing strategy
Every phase should include unit tests, API tests and focused mobile checks. The final end-to-end pass must cover:
- Owner and farmer access.
- Banded and unbanded populations.
- All-eligible and selected-bird recording.
- Partial coverage and zero-eligible populations.
- Automatic due dates and missing hatch dates.
- Flock overrides and default inheritance.
- Duplicate taps, timeouts and safe retries.
- Historical records and correction behavior.
- Catalogue data availability.
- Existing farm, shed, bird and flock regression tests.
Do not label the module pilot-ready until the critical end-to-end paths pass on the emulator against the intended QA backend.
7. Definition of done
The new module will be considered ready for a pilot only when:
- The owner can see vaccination needs across authorized sheds.
- The farmer sees only assigned sheds and authorized actions.
- Due dates are derived consistently from hatch dates and selected schedules.
- Banded birds and unbanded populations can both be vaccinated.
- Actual coverage is recorded accurately, including partial groups.
- Repeated submissions cannot create duplicate records.
- The Catalogues screen shows all six requested product fields without inventing missing values.
- Historical records remain accessible and correct.
- All critical tests pass, and known blockers are documented.