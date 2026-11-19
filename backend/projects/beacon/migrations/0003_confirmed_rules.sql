-- Stakeholder confirmations, 2026-11-19 (docs/DECISIONS.md):
--  * Project managers must update at least weekly; no status update in 7 days raises
--    "Update overdue" (CONFIRMED).
--  * Overall health = worst of schedule, budget and milestones (CONFIRMED; implemented in the
--    health engine, not a numeric threshold).
-- The exact numeric health thresholds and the 60-hour limit remain ASSUMPTIONs.
UPDATE health_rules SET confirmed = true, version = version + 1, updated_at = now()
 WHERE key = 'status_update_overdue_days' AND confirmed = false;

-- Spend already recorded by the seed is attributed to the Portfolio Manager, the only role that
-- records actual spend (CONFIRMED). Only rows with no recorder are touched.
UPDATE spend_entries SET created_by = (SELECT id FROM users WHERE role = 'PMO' ORDER BY created_at LIMIT 1)
 WHERE created_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE role = 'PMO');
