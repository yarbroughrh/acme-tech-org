"""Migrations and seed are idempotent and the seed tells the intended story (integration)."""

from datetime import date

from beacon import migrations, seed


def test_migrations_rerun_is_noop(database):
    assert migrations.apply_migrations(database) == []


def test_health_rules_seeded_unconfirmed(database):
    rows = database.execute("SELECT key, value FROM health_rules").fetchall()
    rules = {r["key"]: float(r["value"]) for r in rows}
    assert rules["schedule_amber_lag_pts"] == 10 and rules["schedule_red_lag_pts"] == 25
    assert rules["allocation_severe_hours"] == 60 and "allocation_max_hours" not in rules and len(rules) == 14


def test_seed_rerun_is_skipped_and_never_duplicates(database):
    before = database.execute("SELECT count(*) AS n FROM projects").fetchone()["n"]
    assert seed.run_seed(database)["status"] == "skipped"  # every seed version already applied
    assert database.execute("SELECT count(*) AS n FROM projects").fetchone()["n"] == before
    # seeded projects = those created in the seed v1 transaction (other tests add their own projects)
    seeded = database.execute("SELECT count(*) AS n FROM projects WHERE created_at <= "
                              "(SELECT applied_at FROM seed_runs WHERE version = 'v1')").fetchone()["n"]
    assert seeded == 120


def test_seed_scale(database):
    counts = {t: database.execute(f"SELECT count(*) AS n FROM {t}").fetchone()["n"]  # nosec B608 - fixed table names
              for t in ("people", "departments", "milestones", "tasks", "allocations", "spend_entries", "status_updates")}
    assert counts["people"] == 151 and counts["departments"] == 8  # 150 + Marcus Webb (seed v3)
    assert min(counts.values()) > 0


def test_story_over_allocated_person(database):
    row = database.execute("SELECT sum(a.hours_per_week) AS h FROM allocations a JOIN people p ON p.id = a.person_id "
                           "WHERE p.full_name = 'Priya Raman'").fetchone()
    assert float(row["h"]) == 58
    max_other = database.execute("SELECT max(t) AS m FROM (SELECT sum(hours_per_week) t FROM allocations a "
                                 "JOIN people p ON p.id = a.person_id WHERE p.full_name NOT IN ('Priya Raman', 'Marcus Webb') "
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


def test_demo_analyst_is_allocated_and_has_tasks(database):
    row = database.execute("SELECT count(*) AS n FROM tasks t JOIN people p ON p.id = t.assignee_person_id "
                           "JOIN users u ON u.id = p.user_id WHERE u.email = 'analyst1@acme.example'").fetchone()
    assert row["n"] >= 1


def test_seed_data_respects_date_rules(database):
    bad_milestones = database.execute("SELECT count(*) AS n FROM milestones m JOIN projects p ON p.id = m.project_id "
                                      "WHERE m.due_date < p.planned_start OR m.due_date > p.planned_end").fetchone()["n"]
    bad_spend = database.execute("SELECT count(*) AS n FROM spend_entries s JOIN projects p ON p.id = s.project_id "
                                 "WHERE s.deleted_at IS NULL AND (s.week_starting > current_date "
                                 "OR s.week_starting < date_trunc('week', p.planned_start)::date OR s.week_starting > p.planned_end "
                                 "OR extract(isodow FROM s.week_starting) <> 1)").fetchone()["n"]
    assert bad_milestones == 0 and bad_spend == 0


def test_confirmed_rules_are_flagged(database):
    rows = {r["key"]: r["confirmed"] for r in database.execute("SELECT key, confirmed FROM health_rules").fetchall()}
    assert rows["status_update_overdue_days"] is True  # weekly updates CONFIRMED
    # thresholds CONFIRMED on 2026-11-19; late start and spend-ahead-of-delivery remain ASSUMPTIONs
    assert all(rows[k] for k in ("schedule_amber_lag_pts", "schedule_red_lag_pts", "budget_amber_overspend_pct",
                                 "budget_red_overspend_pct", "milestone_at_risk_window_days", "milestone_red_days_late",
                                 "allocation_standard_hours", "allocation_severe_hours"))
    assert rows["schedule_late_start_days"] is False and rows["budget_ahead_of_delivery_pts"] is False


def test_seeded_spend_is_recorded_by_the_portfolio_manager(database):
    roles = database.execute("SELECT DISTINCT u.role FROM spend_entries s JOIN users u ON u.id = s.created_by").fetchall()
    assert [r["role"] for r in roles] == ["PMO"]
    assert database.execute("SELECT count(*) AS n FROM spend_entries WHERE created_by IS NULL").fetchone()["n"] == 0


def test_seed_v2_analysts_and_proposals(database):
    analysts = database.execute("SELECT email FROM users WHERE role = 'ANALYST' ORDER BY email").fetchall()
    assert [a["email"] for a in analysts] == ["analyst1@acme.example", "analyst2@acme.example"]
    counts = {r["status"]: r["n"] for r in database.execute(
        "SELECT status, count(*) AS n FROM change_requests GROUP BY status").fetchall()}
    assert counts.get("PENDING", 0) >= 3 and counts.get("REJECTED", 0) >= 1
    assert database.execute("SELECT count(*) AS n FROM users WHERE role = 'MEMBER'").fetchone()["n"] == 0


def test_seed_v2_upgrades_a_legacy_member_account(database):
    """A database seeded before the role change (v1 had member@) is upgraded in place by v2."""
    seed_module = seed
    with database.transaction():
        database.execute("SAVEPOINT legacy")
        database.execute("DELETE FROM seed_runs WHERE version = 'v2'")
        database.execute("UPDATE users SET email = 'member@acme.example' WHERE email = 'analyst1@acme.example'")
        database.execute("DELETE FROM change_requests")
        database.execute("DELETE FROM project_analysts")
        result = seed_module._seed_v2(database, date.today())  # pylint: disable=protected-access
        upgraded = database.execute("SELECT role FROM users WHERE email = 'analyst1@acme.example'").fetchone()
        legacy_left = database.execute("SELECT 1 FROM users WHERE email = 'member@acme.example'").fetchone()
        database.execute("ROLLBACK TO SAVEPOINT legacy")
    assert upgraded["role"] == "ANALYST" and legacy_left is None
    assert result["analysts_assigned"] == 5 and result["change_requests"] >= 4


def test_story_severely_over_allocated_person(database):
    row = database.execute("SELECT sum(a.hours_per_week) AS h FROM allocations a JOIN people p ON p.id = a.person_id "
                           "WHERE p.full_name = 'Marcus Webb'").fetchone()
    assert float(row["h"]) == 64


def test_seed_spend_is_weekly_one_per_category_with_missing_weeks(database):
    dupes = database.execute("SELECT count(*) AS n FROM (SELECT 1 FROM spend_entries WHERE deleted_at IS NULL "
                             "GROUP BY project_id, week_starting, category HAVING count(*) > 1) d").fetchone()["n"]
    assert dupes == 0
    last_week = database.execute("SELECT (date_trunc('week', current_date) - interval '7 days')::date AS w").fetchone()["w"]
    for name, missing in (("Branch Network Refresh", 2), ("HR Self-Service Portal", 1)):
        latest = database.execute("SELECT max(week_starting) AS w FROM spend_entries s JOIN projects p ON p.id = s.project_id "
                                  "WHERE p.name = %s AND s.deleted_at IS NULL", (name,)).fetchone()["w"]
        assert (last_week - latest).days == 7 * missing


def test_story_admin_items(database):
    assert database.execute("SELECT count(*) AS n FROM users WHERE locked_until > now()").fetchone()["n"] >= 1
    assert database.execute("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'user' AND action = 'UPDATED' "
                            "AND after ? 'role' AND at > now() - interval '7 days'").fetchone()["n"] >= 1


def test_seed_v3_converts_legacy_spend_to_weekly_keeping_total(database):
    """The cloud database was seeded with older spend rows; v3 soft-deletes them and writes weekly rows."""
    pid = database.execute("SELECT id FROM projects WHERE name = 'Data Lake Modernisation'").fetchone()["id"]
    with database.transaction():
        database.execute("SAVEPOINT legacy_spend")
        database.execute("UPDATE spend_entries SET note = NULL WHERE project_id = %s", (pid,))  # look like legacy rows
        before = database.execute("SELECT sum(amount) AS t, count(*) AS n FROM spend_entries WHERE project_id = %s "
                                  "AND deleted_at IS NULL", (pid,)).fetchone()
        result = seed._seed_v3(database, date.today())  # pylint: disable=protected-access
        after = database.execute("SELECT sum(amount) AS t, bool_and(note = 'Weekly actuals') AS weekly, "
                                 "bool_and(extract(isodow FROM week_starting) = 1) AS mondays FROM spend_entries "
                                 "WHERE project_id = %s AND deleted_at IS NULL", (pid,)).fetchone()
        kept = database.execute("SELECT count(*) AS n FROM spend_entries WHERE project_id = %s AND deleted_at IS NOT NULL "
                                "AND note IS NULL", (pid,)).fetchone()["n"]
        database.execute("ROLLBACK TO SAVEPOINT legacy_spend")
    assert result["spend_converted_projects"] == 1
    assert abs(float(after["t"]) - float(before["t"])) < 1 and after["weekly"] and after["mondays"]
    assert kept == before["n"]  # legacy rows soft-deleted, not removed
