-- Stakeholder confirmations and lead decisions, 2026-11-19 (docs/DECISIONS.md).

-- 1. Health thresholds CONFIRMED as specified. Late-start days and the spend-ahead-of-delivery rule
--    were not in the confirmed list and stay ASSUMPTIONs.
UPDATE health_rules SET confirmed = true, version = version + 1, updated_at = now()
 WHERE key IN ('schedule_amber_lag_pts', 'schedule_red_lag_pts', 'budget_amber_overspend_pct',
               'budget_red_overspend_pct', 'milestone_at_risk_window_days', 'milestone_at_risk_min_complete_pct',
               'milestone_amber_late_count', 'milestone_red_late_count', 'milestone_red_days_late',
               'allocation_standard_hours');

-- 2. Allocation: no hard block. Over 60 h/week is saved with a Red "Severely over-allocated" warning (CONFIRMED).
UPDATE health_rules SET key = 'allocation_severe_hours', confirmed = true, version = version + 1, updated_at = now(),
       description = 'Weekly total above this is saved with a Red "Severely over-allocated" warning and appears in Needs attention'
 WHERE key = 'allocation_max_hours';
UPDATE health_rules SET description = 'Weekly total above this shows an Amber "Over-allocated" warning'
 WHERE key = 'allocation_standard_hours';
ALTER TABLE allocations DROP CONSTRAINT allocations_hours_per_week_check;
ALTER TABLE allocations ALTER COLUMN hours_per_week TYPE numeric(5, 1);
ALTER TABLE allocations ADD CONSTRAINT allocations_hours_per_week_check
    CHECK (hours_per_week >= 0.5 AND hours_per_week <= 168);  -- data validation only (hours in a week)

-- 3. Rebaselining (ASSUMPTION, lead decision): PMO only, with a reason; originals kept; every change audited.
ALTER TABLE projects ADD COLUMN original_planned_start date;
ALTER TABLE projects ADD COLUMN original_planned_end date;
ALTER TABLE projects ADD COLUMN original_approved_budget numeric(14, 2);
UPDATE projects SET original_planned_start = planned_start, original_planned_end = planned_end,
                    original_approved_budget = approved_budget;
CREATE TABLE project_rebaselines (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects (id),
    changed_by  uuid NOT NULL REFERENCES users (id),
    changed_at  timestamptz NOT NULL DEFAULT now(),
    reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    before      jsonb NOT NULL,
    after       jsonb NOT NULL
);
CREATE INDEX project_rebaselines_project_idx ON project_rebaselines (project_id, changed_at DESC);

-- 4. Weekly spend (CONFIRMED): one entry per project, week (Monday) and category; categories renamed.
ALTER TABLE spend_entries DROP CONSTRAINT spend_entries_category_check;
UPDATE spend_entries SET category = CASE category WHEN 'VENDOR' THEN 'CONTRACTORS_VENDORS'
                                                  WHEN 'SOFTWARE_HARDWARE' THEN 'SOFTWARE_LICENCES' ELSE category END;
ALTER TABLE spend_entries ADD CONSTRAINT spend_entries_category_check
    CHECK (category IN ('LABOUR', 'CONTRACTORS_VENDORS', 'SOFTWARE_LICENCES', 'HARDWARE_INFRA', 'OTHER'));
ALTER TABLE spend_entries RENAME COLUMN spent_on TO week_starting;
UPDATE spend_entries SET week_starting = date_trunc('week', week_starting)::date;  -- ISO weeks start on Monday
-- Merge any rows that now share project + week + category (keep one live row with the summed amount).
WITH dupes AS (
    SELECT project_id, week_starting, category, min(id::text)::uuid AS keep_id, sum(amount) AS total
      FROM spend_entries WHERE deleted_at IS NULL GROUP BY 1, 2, 3 HAVING count(*) > 1)
UPDATE spend_entries s SET amount = d.total FROM dupes d WHERE s.id = d.keep_id;
UPDATE spend_entries s SET deleted_at = now() FROM (
    SELECT project_id, week_starting, category, min(id::text)::uuid AS keep_id
      FROM spend_entries WHERE deleted_at IS NULL GROUP BY 1, 2, 3 HAVING count(*) > 1) d
 WHERE s.project_id = d.project_id AND s.week_starting = d.week_starting AND s.category = d.category
   AND s.id <> d.keep_id AND s.deleted_at IS NULL;
ALTER TABLE spend_entries ADD CONSTRAINT spend_entries_monday_ck CHECK (extract(isodow FROM week_starting) = 1);
CREATE UNIQUE INDEX spend_entries_week_uk ON spend_entries (project_id, week_starting, category) WHERE deleted_at IS NULL;
ALTER TABLE spend_entries ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE spend_entries ADD COLUMN updated_by uuid REFERENCES users (id);
DROP INDEX IF EXISTS spend_project_idx;
CREATE INDEX spend_project_week_idx ON spend_entries (project_id, week_starting);

-- 5. Departments (lead decision): the business departments, kept in a table so they can be edited later.
--    Existing departments are renamed in place (ids and references kept); fresh databases are seeded directly.
UPDATE departments SET name = CASE name
    WHEN 'Digital Channels' THEN 'Sales'
    WHEN 'Data & Analytics' THEN 'Finance'
    WHEN 'Infrastructure & Cloud' THEN 'Operations'
    WHEN 'Cyber Security' THEN 'Legal and Compliance'
    WHEN 'Enterprise Applications' THEN 'Customer Service'
    WHEN 'Workplace Technology' THEN 'Human Resources'
    WHEN 'Risk & Compliance Technology' THEN 'Marketing'
    ELSE name END;
INSERT INTO departments (name) SELECT 'Supply Chain' WHERE EXISTS (SELECT 1 FROM departments)
ON CONFLICT (name) DO NOTHING;

-- 6. Work queue: "New since your last sign-in" needs the previous sign-in time.
ALTER TABLE users ADD COLUMN previous_login_at timestamptz;

-- 7. Indexes for the work queue's aggregate queries.
CREATE INDEX IF NOT EXISTS milestones_open_due_idx ON milestones (project_id, due_date)
    WHERE deleted_at IS NULL AND archived_at IS NULL AND status <> 'COMPLETE';
CREATE INDEX IF NOT EXISTS change_requests_pending_idx ON change_requests (project_id, created_at) WHERE status = 'PENDING';
