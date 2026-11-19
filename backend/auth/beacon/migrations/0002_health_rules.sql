-- Business rule thresholds (one configurable place). All values are ASSUMPTIONs pending
-- stakeholder confirmation (docs/DECISIONS.md, Part B). ON CONFLICT keeps any edited value.
INSERT INTO health_rules (key, category, value, unit, description, confirmed) VALUES
  ('schedule_amber_lag_pts',            'SCHEDULE',   10, 'points', 'Amber if progress lags elapsed time by more than this', false),
  ('schedule_red_lag_pts',              'SCHEDULE',   25, 'points', 'Red if progress lags elapsed time by more than this', false),
  ('schedule_late_start_days',          'SCHEDULE',    7, 'days',   'Amber if the project actually started more than this many days after its planned start', false),
  ('budget_amber_overspend_pct',        'BUDGET',     10, 'percent','Amber if actual spend exceeds planned spend to date by more than this', false),
  ('budget_red_overspend_pct',          'BUDGET',     20, 'percent','Red if actual spend exceeds planned spend to date by more than this', false),
  ('budget_ahead_of_delivery_pts',      'BUDGET',     15, 'points', 'Amber if % of budget spent exceeds progress % by more than this', false),
  ('milestone_at_risk_window_days',     'MILESTONES',  7, 'days',   'A milestone due within this many days is at risk if under the completion threshold', false),
  ('milestone_at_risk_min_complete_pct','MILESTONES', 75, 'percent','Completion below which a milestone due soon is at risk', false),
  ('milestone_amber_late_count',        'MILESTONES',  1, 'count',  'Amber if at least this many milestones are late', false),
  ('milestone_red_late_count',          'MILESTONES',  2, 'count',  'Red if at least this many milestones are late', false),
  ('milestone_red_days_late',           'MILESTONES', 14, 'days',   'Red if any milestone is more than this many days late', false),
  ('status_update_overdue_days',        'FLAGS',       7, 'days',   'Flag Update overdue when no status update for more than this many days', false),
  ('allocation_standard_hours',         'ALLOCATION', 40, 'hours',  'Standard weekly capacity; above this a person is over-allocated (Amber)', false),
  ('allocation_max_hours',              'ALLOCATION', 60, 'hours',  'Weekly total above this is rejected', false)
ON CONFLICT (key) DO NOTHING;
