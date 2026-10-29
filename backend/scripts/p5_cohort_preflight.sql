-- P5 read-only duplicate cohort preflight.
-- Run before alembic upgrade to 0007_p5_cohort_idempotency.
-- Do NOT auto-merge / close / reassign; escalate if any rows return.

-- Exact conflicts
SELECT owner_account_id, shed_id, hatch_date,
       COUNT(*) AS n, ARRAY_AGG(id ORDER BY created_at) AS flock_ids
FROM flocks
WHERE status = 'active'
  AND dob_confidence = 'exact'
  AND hatch_date IS NOT NULL
GROUP BY owner_account_id, shed_id, hatch_date
HAVING COUNT(*) > 1;

-- Estimated conflicts
SELECT owner_account_id, shed_id, estimated_age_days, age_reported_on,
       COUNT(*) AS n, ARRAY_AGG(id ORDER BY created_at) AS flock_ids
FROM flocks
WHERE status = 'active'
  AND dob_confidence = 'estimated'
  AND estimated_age_days IS NOT NULL
  AND age_reported_on IS NOT NULL
GROUP BY owner_account_id, shed_id, estimated_age_days, age_reported_on
HAVING COUNT(*) > 1;

-- Informational: estimated rows incomplete for unique index
SELECT id, owner_account_id, shed_id, estimated_age_days, age_reported_on
FROM flocks
WHERE status = 'active'
  AND dob_confidence = 'estimated'
  AND (estimated_age_days IS NULL OR age_reported_on IS NULL);
