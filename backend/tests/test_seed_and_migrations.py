"""Migrations and seed are idempotent and the seed tells the intended story (integration)."""

from beacon import migrations, seed


def test_migrations_rerun_is_noop(database):
    assert migrations.apply_migrations(database) == []


def test_health_rules_seeded_unconfirmed(database):
    rows = database.execute("SELECT key, value FROM health_rules").fetchall()
    rules = {r["key"]: float(r["value"]) for r in rows}
    assert rules["schedule_amber_lag_pts"] == 10 and rules["schedule_red_lag_pts"] == 25
    assert rules["allocation_max_hours"] == 60 and len(rules) == 14


def test_seed_rerun_is_skipped_and_never_duplicates(database):
    before = database.execute("SELECT count(*) AS n FROM projects").fetchone()["n"]
    assert seed.run_seed(database)["status"] == "skipped"
    assert database.execute("SELECT count(*) AS n FROM projects").fetchone()["n"] == before == 120


def test_seed_scale(database):
    counts = {t: database.execute(f"SELECT count(*) AS n FROM {t}").fetchone()["n"]  # nosec B608 - fixed table names
              for t in ("people", "departments", "milestones", "tasks", "allocations", "spend_entries", "status_updates")}
    assert counts["people"] == 150 and counts["departments"] == 7
    assert min(counts.values()) > 0


def test_story_over_allocated_person(database):
    row = database.execute("SELECT sum(a.hours_per_week) AS h FROM allocations a JOIN people p ON p.id = a.person_id "
                           "WHERE p.full_name = 'Priya Raman'").fetchone()
    assert float(row["h"]) == 58
    max_other = database.execute("SELECT max(t) AS m FROM (SELECT sum(hours_per_week) t FROM allocations a "
                                 "JOIN people p ON p.id = a.person_id WHERE p.full_name <> 'Priya Raman' "
                                 "GROUP BY person_id) s").fetchone()["m"]
    assert float(max_other) <= 40
    under = database.execute("SELECT count(*) AS n FROM (SELECT person_id, sum(hours_per_week) t FROM allocations "
                             "GROUP BY person_id HAVING sum(hours_per_week) < 40) s").fetchone()["n"]
    assert under >= 5


def test_story_overdue_update(database):
    row = database.execute("SELECT max(s.created_at)::date AS last FROM status_updates s JOIN projects p ON p.id = s.project_id "
                           "WHERE p.name = 'Branch Network Refresh'").fetchone()
    assert (database.execute("SELECT current_date AS d").fetchone()["d"] - row["last"]).days == 12


def test_story_two_late_milestones(database):
    row = database.execute("SELECT count(*) AS n FROM milestones m JOIN projects p ON p.id = m.project_id "
                           "WHERE p.name = 'Payments Gateway Upgrade' AND m.due_date < current_date "
                           "AND m.status <> 'COMPLETE'").fetchone()
    assert row["n"] == 2


def test_story_mismatch_reports_green(database):
    row = database.execute("SELECT s.reported_status FROM status_updates s JOIN projects p ON p.id = s.project_id "
                           "WHERE p.name = 'Customer Portal Rebuild' ORDER BY s.created_at DESC LIMIT 1").fetchone()
    assert row["reported_status"] == "GREEN"


def test_demo_member_is_allocated_and_has_tasks(database):
    row = database.execute("SELECT count(*) AS n FROM tasks t JOIN people p ON p.id = t.assignee_person_id "
                           "JOIN users u ON u.id = p.user_id WHERE u.email = 'member@acme.example'").fetchone()
    assert row["n"] >= 1


def test_seed_data_respects_date_rules(database):
    bad_milestones = database.execute("SELECT count(*) AS n FROM milestones m JOIN projects p ON p.id = m.project_id "
                                      "WHERE m.due_date < p.planned_start OR m.due_date > p.planned_end").fetchone()["n"]
    bad_spend = database.execute("SELECT count(*) AS n FROM spend_entries s JOIN projects p ON p.id = s.project_id "
                                 "WHERE s.spent_on > current_date OR s.spent_on < p.planned_start "
                                 "OR s.spent_on > p.planned_end").fetchone()["n"]
    assert bad_milestones == 0 and bad_spend == 0


def test_confirmed_rules_are_flagged(database):
    rows = {r["key"]: r["confirmed"] for r in database.execute("SELECT key, confirmed FROM health_rules").fetchall()}
    assert rows["status_update_overdue_days"] is True  # weekly updates CONFIRMED
    # still ASSUMPTIONs: exact thresholds and the 60-hour limit
    assert rows["schedule_amber_lag_pts"] is False and rows["allocation_max_hours"] is False


def test_seeded_spend_is_recorded_by_the_portfolio_manager(database):
    roles = database.execute("SELECT DISTINCT u.role FROM spend_entries s JOIN users u ON u.id = s.created_by").fetchall()
    assert [r["role"] for r in roles] == ["PMO"]
    assert database.execute("SELECT count(*) AS n FROM spend_entries WHERE created_by IS NULL").fetchone()["n"] == 0
