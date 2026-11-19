"""Idempotent demo seed: ~120 projects, ~150 people and the demo accounts, telling a story.

Deterministic (fixed random seed) with dates relative to ``today`` so the story stays true
whenever it is seeded. Runs once per ``SEED_VERSION`` (recorded in ``seed_runs``); running it
again is a no-op and never wipes data. Invoked only by direct IAM Lambda invocation (ADR-003).

Story (section 11 of the brief):
- "Customer Portal Rebuild": PM reports Green, data says Red (status mismatch)
- "Data Lake Modernisation": spending well ahead of delivery
- "Payments Gateway Upgrade": two late milestones
- "Branch Network Refresh": no status update for 12 days (update overdue)
- Priya Raman allocated 58 h/week (over-allocated, Amber); several people under-allocated
- a few On hold, Closed, Proposed and Cancelled projects; a healthy majority
"""

import json
import logging
import math
import random
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any

from psycopg import Connection

from beacon import audit, auth
from beacon import seed_config as cfg

logger = logging.getLogger(__name__)
_SEED_LOCK_ID = 7_420_002

STORY = {
    "mismatch": "Customer Portal Rebuild",
    "ahead": "Data Lake Modernisation",
    "late": "Payments Gateway Upgrade",
    "overdue": "Branch Network Refresh",
    "steady": "HR Self-Service Portal",
}


def _id() -> str:
    return str(uuid.uuid4())


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def monday(day: date) -> date:
    """The Monday of the ISO week containing ``day``."""
    return day - timedelta(days=day.weekday())


def weekly_spend_rows(rnd: random.Random, project_id: str, start: date, end: date, total: float, recorded_by: str,
                      today: date, missing_weeks: int = 0) -> list[tuple]:
    """One row per completed week (and category) from the project's first week to last week.

    The most recent ``missing_weeks`` weeks are left empty so the Portfolio Manager's work queue
    shows "no spend recorded" items in the demo.
    """
    last_complete = min(monday(today) - timedelta(days=7), monday(end))
    weeks = []
    week = monday(start)
    while week <= last_complete:
        weeks.append(week)
        week += timedelta(days=7)
    if missing_weeks:
        weeks = weeks[:-missing_weeks] if len(weeks) > missing_weeks else []
    if not weeks:
        return []
    weights = [rnd.uniform(0.8, 1.2) for _ in weeks]
    scale = total / sum(weights)
    rows = []
    for week, weight in zip(weeks, weights):
        amount = weight * scale
        split = {"LABOUR": amount}
        if rnd.random() < 0.35:  # some weeks also carry vendor or licence costs
            other = rnd.choice(cfg.SPEND_CATEGORIES[1:])
            split = {"LABOUR": amount * 0.7, other: amount * 0.3}
        for category, value in split.items():
            value = Decimal(str(round(value, 2)))
            if value > 0:
                rows.append((_id(), project_id, week, value, category, cfg.WEEKLY_SPEND_NOTE, recorded_by, recorded_by))
    return rows


class _Builder:
    """Accumulates rows in memory, then bulk-inserts them."""

    def __init__(self, today: date):
        self.today = today
        self.rnd = random.Random(cfg.RANDOM_SEED)
        self.rows: dict[str, list[tuple]] = {k: [] for k in (
            "departments", "users", "people", "projects", "milestones", "tasks",
            "allocations", "spend_entries", "status_updates")}
        self.person_hours: dict[str, float] = {}

    # --- reference data ---------------------------------------------------------------------
    def departments(self) -> list[str]:
        ids = []
        for name in cfg.DEPARTMENTS:
            dep_id = _id()
            ids.append(dep_id)
            self.rows["departments"].append((dep_id, name))
        return ids

    def users_and_people(self, dept_ids: list[str]) -> dict[str, Any]:
        names = [f"{f} {l}" for f in cfg.FIRST_NAMES for l in cfg.LAST_NAMES]
        self.rnd.shuffle(names)
        demo_names = {a["display_name"] for a in cfg.DEMO_ACCOUNTS} | {"Priya Raman"}
        names = [n for n in names if n not in demo_names]
        accounts: dict[str, dict] = {}
        for acct in cfg.DEMO_ACCOUNTS:
            user_id = _id()
            accounts[acct["key"]] = {"id": user_id, **acct}
            # Hashing costs ~4 s per password at 128 MB (ADR-005); only demo accounts get one.
            self.rows["users"].append((user_id, acct["email"], acct["display_name"], acct["role"],
                                       auth.hash_password(acct["password"]), False))
        pm_ids = [accounts["pm"]["id"]]
        people: list[str] = []

        def add_person(full_name: str, user_id: str | None = None, title: str | None = None) -> str:
            person_id = _id()
            email = full_name.lower().replace(" ", ".") + "@acme.example"
            self.rows["people"].append((person_id, full_name, email, title or self.rnd.choice(cfg.JOB_TITLES),
                                        self.rnd.choice(dept_ids), user_id))
            return person_id

        accounts["pm"]["person_id"] = add_person(accounts["pm"]["display_name"], accounts["pm"]["id"], "Project Manager")
        accounts["analyst1"]["person_id"] = add_person(accounts["analyst1"]["display_name"], accounts["analyst1"]["id"], "PM Analyst")
        accounts["analyst2"]["person_id"] = add_person(accounts["analyst2"]["display_name"], accounts["analyst2"]["id"], "PM Analyst")
        people.append(accounts["analyst1"]["person_id"])
        for _ in range(cfg.EXTRA_PM_COUNT):
            full_name = names.pop()
            user_id = _id()
            email = full_name.lower().replace(" ", ".") + "@acme.example"
            # No password: sign-in impossible until an Admin issues a temporary password.
            self.rows["users"].append((user_id, email, full_name, "PM", None, True))
            add_person(full_name, user_id, "Project Manager")
            pm_ids.append(user_id)
        priya = add_person("Priya Raman", None, "Solution Architect")
        while len(self.rows["people"]) < cfg.PEOPLE_COUNT:
            people.append(add_person(names.pop()))
        return {"accounts": accounts, "pm_ids": pm_ids, "people": people, "priya": priya}

    # --- projects -----------------------------------------------------------------------------
    def project_names(self) -> list[str]:
        story = list(STORY.values())
        combos = [f"{p} {n}" for p in cfg.PROJECT_PREFIXES for n in cfg.PROJECT_NOUNS]
        self.rnd.shuffle(combos)
        combos = [c for c in combos if c not in story]
        return story + combos[: cfg.PROJECT_COUNT - len(story)]

    def build(self) -> dict[str, Any]:
        dept_ids = self.departments()
        ctx = self.users_and_people(dept_ids)
        accounts, pm_ids, people = ctx["accounts"], ctx["pm_ids"], ctx["people"]
        names = self.project_names()
        statuses = (["ON_HOLD"] * 6 + ["CLOSED"] * 6 + ["PROPOSED"] * 4 + ["CANCELLED"] * 3)
        demo_pm = accounts["pm"]["id"]
        member_person = accounts["analyst1"]["person_id"]
        pmo_user = accounts["pmo"]["id"]
        for index, name in enumerate(names):
            story_key = next((k for k, v in STORY.items() if v == name), None)
            if story_key:
                lifecycle = "ACTIVE"
                profile = story_key
            else:
                lifecycle = statuses.pop() if index % 6 == 0 and statuses else "ACTIVE"
                roll = self.rnd.random()
                profile = "healthy" if roll < 0.78 else "lagging" if roll < 0.88 else "overspend" if roll < 0.95 else "red"
            if story_key in ("mismatch", "ahead", "overdue", "steady") or (not story_key and index % 23 == 5):
                pm_user = demo_pm
            else:
                pm_user = self.rnd.choice(pm_ids)
            self.project(name, lifecycle, profile, self.rnd.choice(dept_ids), pm_user, people,
                         ctx["priya"], member_person, pmo_user)
        return accounts

    def project(self, name: str, lifecycle: str, profile: str, dept_id: str, pm_user: str,
                people: list[str], priya: str, member_person: str, pmo_user: str) -> None:
        rnd, today = self.rnd, self.today
        duration = rnd.randint(180, 540)
        if lifecycle == "PROPOSED":
            start = today + timedelta(days=rnd.randint(14, 90))
        elif lifecycle == "CLOSED":
            start = today - timedelta(days=duration + rnd.randint(10, 120))
        else:
            start = today - timedelta(days=rnd.randint(40, int(duration * 0.8)))
        if profile in ("mismatch", "ahead", "late", "overdue"):
            duration = 360
            start = today - timedelta(days=200)  # elapsed ≈ 56%
        end = start + timedelta(days=duration)
        actual_start = None if lifecycle == "PROPOSED" else start + timedelta(days=rnd.randint(0, 5))
        budget = Decimal(rnd.randrange(150, 5000) * 1000)
        project_id = _id()
        self.rows["projects"].append((
            project_id, name, f"{name} for ACME Enterprise Technology.", rnd.choice(cfg.SPONSORS), dept_id,
            pm_user, start, end, actual_start, budget, lifecycle,
            rnd.choices(["LOW", "MEDIUM", "HIGH"], [2, 5, 3])[0], pmo_user, start, end, budget))

        elapsed_days = (today - start).days
        elapsed = _clamp(elapsed_days / duration)
        if lifecycle == "CLOSED":
            elapsed = 1.0
        # progress lag (fraction of duration) and spend factor by profile
        lag, spend_factor = {
            "healthy": (rnd.uniform(-0.03, 0.01), rnd.uniform(0.86, 1.04)),
            "steady": (0.0, 0.97),
            "lagging": (rnd.uniform(0.12, 0.2), rnd.uniform(0.9, 1.05)),
            "overspend": (rnd.uniform(0.0, 0.05), rnd.uniform(1.13, 1.18)),
            "red": (rnd.uniform(0.27, 0.35), rnd.uniform(1.0, 1.1)),
            "mismatch": (0.30, 1.02),
            "ahead": (0.20, 1.08),  # progress ~36% vs ~60% of budget spent → spending ahead of delivery
            "late": (0.0, 0.98),
            "overdue": (0.0, 0.95),
        }[profile]
        if lifecycle in ("ON_HOLD", "CANCELLED"):
            lag = rnd.uniform(0.05, 0.2)
        progress_days = elapsed_days - lag * duration if lifecycle != "CLOSED" else duration
        team = self.allocate(project_id, lifecycle, start, end, people, priya, member_person, profile)
        self.milestones(project_id, lifecycle, profile, start, end, duration, progress_days, team)
        self.spend(project_id, lifecycle, start, end, budget,
                   elapsed * spend_factor if lifecycle != "CLOSED" else 0.97, pmo_user,
                   missing_weeks=2 if profile == "overdue" else 1 if profile == "steady" else 0)
        self.status_updates(project_id, lifecycle, profile, actual_start, pm_user)

    def milestones(self, project_id: str, lifecycle: str, profile: str, start: date, end: date,
                   duration: int, progress_days: float, team: list[str]) -> None:
        rnd, today = self.rnd, self.today
        count = max(2, min(rnd.randint(3, 6), duration // 45))
        names = cfg.MILESTONE_NAMES[-count:] if count <= len(cfg.MILESTONE_NAMES) else cfg.MILESTONE_NAMES
        prev_due = 0
        for k in range(1, count + 1):
            due_offset = round(duration * k / count)
            due = start + timedelta(days=due_offset)
            span = max(1, due_offset - prev_due)
            completion = _clamp((progress_days - prev_due) / span)
            prev_due = due_offset
            if profile == "late" and k in (1, 2):  # two milestones past due and unfinished
                due = today - timedelta(days=10 if k == 2 else 20)
                completion = 0.6
            if lifecycle == "PROPOSED":
                completion = 0.0
            self.milestone(project_id, names[k - 1], due, completion, team, start, end)

    def milestone(self, project_id: str, name: str, due: date, completion: float, team: list[str],
                  start: date, end: date) -> None:
        rnd = self.rnd
        milestone_id = _id()
        task_count = rnd.choice([0, 2, 3, 4])
        if task_count:
            done = math.ceil(completion * task_count) if completion < 1 else task_count
            if completion < 1 and done == task_count:
                done -= 1
            pct = None
            ratio = done / task_count
        else:
            pct = round(completion * 100)
            ratio = pct / 100
        status = "COMPLETE" if ratio >= 1 else "IN_PROGRESS" if ratio > 0 else "NOT_STARTED"
        owner = rnd.choice(team) if team else None
        self.rows["milestones"].append((milestone_id, project_id, name, owner, due, status, pct))
        for t in range(task_count):
            task_status = "DONE" if t < done else "IN_PROGRESS" if t == done and ratio > 0 else "TODO"
            task_due = min(max(due - timedelta(days=(task_count - t) * 3), start), end)
            self.rows["tasks"].append((
                _id(), project_id, milestone_id,
                f"{rnd.choice(cfg.TASK_VERBS)} {rnd.choice(cfg.TASK_OBJECTS)}", task_status,
                rnd.choice(team) if team else None, task_due))

    def allocate(self, project_id: str, lifecycle: str, start: date, end: date, people: list[str],
                 priya: str, member_person: str, profile: str) -> list[str]:
        if lifecycle not in ("ACTIVE", "ON_HOLD"):
            return []
        rnd = self.rnd
        team: list[str] = []

        def add(person: str, hours: float) -> None:
            self.rows["allocations"].append((_id(), person, project_id, Decimal(str(hours)), start, end))
            self.person_hours[person] = self.person_hours.get(person, 0) + hours
            team.append(person)

        if profile == "mismatch":
            add(member_person, 30)
        if profile in ("mismatch", "ahead", "late"):  # Priya: 24 + 20 + 14 = 58 h/week
            add(priya, {"mismatch": 24, "ahead": 20, "late": 14}[profile])
        for _ in range(rnd.randint(2, 4)):
            hours = rnd.choice([8, 10, 12, 16, 20])
            candidates = [p for p in people if p != member_person and p not in team
                          and self.person_hours.get(p, 0) + hours <= 40]
            if not candidates:
                break
            add(rnd.choice(candidates[:60] if rnd.random() < 0.7 else candidates), hours)
        return team

    def spend(self, project_id: str, lifecycle: str, start: date, end: date, budget: Decimal,
              fraction_of_budget: float, recorded_by: str, missing_weeks: int = 0) -> None:
        """Weekly spend recorded by the Portfolio Manager (CONFIRMED: weekly, PMO only)."""
        if lifecycle == "PROPOSED" or fraction_of_budget <= 0:
            return
        total = float(budget) * fraction_of_budget
        self.rows["spend_entries"].extend(
            weekly_spend_rows(self.rnd, project_id, start, end, total, recorded_by, self.today, missing_weeks))

    def status_updates(self, project_id: str, lifecycle: str, profile: str, actual_start: date | None,
                       pm_user: str) -> None:
        if lifecycle not in ("ACTIVE", "ON_HOLD") or actual_start is None:
            return
        rnd, today = self.rnd, self.today
        reported = {"healthy": "GREEN", "steady": "GREEN", "lagging": "AMBER", "overspend": "AMBER",
                    "red": "RED", "mismatch": "GREEN", "ahead": "AMBER", "late": "AMBER", "overdue": "GREEN"}[profile]
        latest_days_ago = 12 if profile == "overdue" else rnd.randint(1, 6)
        summaries = {
            "GREEN": "On track. No new risks this week.",
            "AMBER": "Some slippage; recovery plan in progress.",
            "RED": "Significant issues; escalation required.",
        }
        for week in range(8):
            created = today - timedelta(days=latest_days_ago + 7 * week)
            if created < actual_start:
                break
            at = datetime.combine(created, time(hour=rnd.randint(8, 17)), tzinfo=timezone.utc)
            status = reported if week < 3 else "GREEN"
            self.rows["status_updates"].append((_id(), project_id, pm_user, status, summaries[status], at))


_INSERTS = {
    "departments": "INSERT INTO departments (id, name) VALUES (%s, %s)",
    "users": "INSERT INTO users (id, email, display_name, role, password_hash, must_change_password) VALUES (%s, %s, %s, %s, %s, %s)",
    "people": "INSERT INTO people (id, full_name, email, job_title, department_id, user_id) VALUES (%s, %s, %s, %s, %s, %s)",
    "projects": ("INSERT INTO projects (id, name, description, sponsor, department_id, pm_user_id, planned_start, planned_end, "
                 "actual_start, approved_budget, lifecycle_status, priority, created_by, original_planned_start, "
                 "original_planned_end, original_approved_budget) "
                 "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"),
    "milestones": ("INSERT INTO milestones (id, project_id, name, owner_person_id, due_date, status, percent_complete) "
                   "VALUES (%s, %s, %s, %s, %s, %s, %s)"),
    "tasks": ("INSERT INTO tasks (id, project_id, milestone_id, title, status, assignee_person_id, due_date) "
              "VALUES (%s, %s, %s, %s, %s, %s, %s)"),
    "allocations": ("INSERT INTO allocations (id, person_id, project_id, hours_per_week, start_date, end_date) "
                    "VALUES (%s, %s, %s, %s, %s, %s)"),
    "spend_entries": ("INSERT INTO spend_entries (id, project_id, week_starting, amount, category, note, created_by, updated_by) "
                      "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"),
    "status_updates": ("INSERT INTO status_updates (id, project_id, author_user_id, reported_status, summary, created_at) "
                       "VALUES (%s, %s, %s, %s, %s, %s)"),
}


def _seed_v1(conn: Connection, today: date) -> dict[str, int]:
    """Base portfolio: departments, users, people, projects and their plans, spend and updates."""
    builder = _Builder(today)
    builder.build()
    counts = {}
    with conn.cursor() as cur:
        for table, sql in _INSERTS.items():
            rows = builder.rows[table]
            if rows:
                cur.executemany(sql, rows)
            counts[table] = len(rows)
    return counts


def _user_by_email(conn: Connection, email: str) -> dict | None:
    return conn.execute("SELECT id, display_name FROM users WHERE lower(email) = lower(%s)", (email,)).fetchone()


def _seed_v2(conn: Connection, today: date) -> dict[str, int]:
    """PM Analysts (CONFIRMED role): accounts, assignments to the demo PM's projects, demo proposals.

    Works on a fresh database (v1 already created the analysts) and on one seeded before the role
    change (the legacy "member" demo account is upgraded to analyst1).
    """
    accounts = {a["key"]: a for a in cfg.DEMO_ACCOUNTS}
    ids: dict[str, Any] = {}
    for key in ("analyst1", "analyst2"):
        acct = accounts[key]
        user = _user_by_email(conn, acct["email"])
        if user is None and key == "analyst1":
            legacy = _user_by_email(conn, cfg.LEGACY_MEMBER_EMAIL)
            if legacy is not None:
                conn.execute("UPDATE users SET email = %s, display_name = %s, role = 'ANALYST', password_hash = %s, "
                             "must_change_password = false, token_epoch = token_epoch + 1, version = version + 1 "
                             "WHERE id = %s", (acct["email"], acct["display_name"], auth.hash_password(acct["password"]),
                                               legacy["id"]))
                user = legacy
        if user is None:
            user = conn.execute("INSERT INTO users (email, display_name, role, password_hash, must_change_password) "
                                "VALUES (%s, %s, 'ANALYST', %s, false) RETURNING id",
                                (acct["email"], acct["display_name"], auth.hash_password(acct["password"]))).fetchone()
        ids[key] = user["id"]
        if conn.execute("SELECT 1 FROM people WHERE user_id = %s", (user["id"],)).fetchone() is None:
            conn.execute("INSERT INTO people (full_name, email, job_title, department_id, user_id) "
                         "SELECT %s, %s, 'PM Analyst', (SELECT id FROM departments ORDER BY name LIMIT 1), %s",
                         (acct["display_name"], acct["email"], user["id"]))
    pm = _user_by_email(conn, accounts["pm"]["email"])
    projects = {r["name"]: r for r in conn.execute(
        "SELECT id, name, planned_start, planned_end FROM projects WHERE name = ANY(%s)", (list(STORY.values()),)).fetchall()}
    assignments = {"analyst1": ["mismatch", "ahead", "steady"], "analyst2": ["overdue", "steady"]}
    assigned = 0
    for key, stories in assignments.items():
        for story in stories:
            project = projects.get(STORY[story])
            if project is None:
                continue
            assigned += conn.execute(
                "INSERT INTO project_analysts (project_id, user_id, assigned_by) SELECT %s, %s, %s WHERE NOT EXISTS "
                "(SELECT 1 FROM project_analysts WHERE project_id = %s AND user_id = %s AND removed_at IS NULL)",
                (project["id"], ids[key], pm["id"], project["id"], ids[key])).rowcount

    def first_open_task(project: dict) -> dict | None:
        return conn.execute("SELECT id, version, due_date FROM tasks WHERE project_id = %s AND status <> 'DONE' "
                            "AND deleted_at IS NULL ORDER BY due_date NULLS LAST, id LIMIT 1", (project["id"],)).fetchone()

    def first_open_milestone(project: dict) -> dict | None:
        return conn.execute("SELECT id, version, due_date, percent_complete FROM milestones WHERE project_id = %s "
                            "AND status <> 'COMPLETE' AND deleted_at IS NULL ORDER BY due_date, id LIMIT 1",
                            (project["id"],)).fetchone()

    def slip(project: dict, due: date, days: int) -> date:
        moved = due + timedelta(days=days)
        return moved if moved <= project["planned_end"] else due - timedelta(days=days)

    proposals = []
    portal, lake = projects.get(STORY["mismatch"]), projects.get(STORY["ahead"])
    branch, hr = projects.get(STORY["overdue"]), projects.get(STORY["steady"])
    if portal and (task := first_open_task(portal)):
        proposals.append(("analyst1", portal, "TASK", task, {"status": "DONE"}, "Completed and demoed at sprint review."))
    if lake and (ms := first_open_milestone(lake)):
        proposals.append(("analyst1", lake, "MILESTONE", ms, {"due_date": slip(lake, ms["due_date"], 7).isoformat(),
                          "notes": "Vendor delivery slipped; requesting a one-week move."}, "Vendor confirmed the new date."))
    if branch and (task := first_open_task(branch)):
        proposals.append(("analyst2", branch, "TASK", task, {"status": "IN_PROGRESS", "notes": "Site surveys started."}, None))
    if hr and (task := first_open_task(hr)):
        due = task["due_date"] or hr["planned_end"]
        proposals.append(("analyst2", hr, "TASK", task, {"due_date": slip(hr, due, 5).isoformat()}, "Waiting on HR data extract."))
    created = 0
    for key, project, entity_type, entity, changes, note in proposals:
        conn.execute("INSERT INTO change_requests (project_id, proposer_user_id, entity_type, entity_id, base_version, "
                     "changes, note) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)",
                     (project["id"], ids[key], entity_type, entity["id"], entity["version"], json.dumps(changes), note))
        created += 1
    if hr and (ms := first_open_milestone(hr)):  # one rejected proposal so "My proposals" shows a reason
        conn.execute("INSERT INTO change_requests (project_id, proposer_user_id, entity_type, entity_id, base_version, changes, "
                     "note, status, decided_by, decided_at, reason) VALUES (%s, %s, 'MILESTONE', %s, %s, %s::jsonb, %s, "
                     "'REJECTED', %s, now(), %s)",
                     (hr["id"], ids["analyst1"], ms["id"], ms["version"], json.dumps({"percent_complete": 95}),
                      "Nearly done.", pm["id"], "UAT evidence doesn't support 95% yet. Resubmit after the UAT report."))
        created += 1
    return {"analysts_assigned": assigned, "change_requests": created}


def _seed_v3(conn: Connection, today: date) -> dict[str, int]:
    """Weekly spend (CONFIRMED) and the "Your next actions" demo story. Idempotent by lookup.

    - Databases seeded before weekly spend: legacy entries are soft-deleted (kept) and replaced by weekly
      entries with the same total, leaving recent weeks missing on two story projects.
    - Over 60 h/week: Marcus Webb is allocated 64 h across three Active projects (Red warning, CONFIRMED).
    - A locked account, a recent role change and a project that turned Red in the last 7 days.
    """
    rnd = random.Random(cfg.RANDOM_SEED + 3)
    counts = {"spend_converted_projects": 0, "spend_rows": 0}
    pmo = _user_by_email(conn, next(a["email"] for a in cfg.DEMO_ACCOUNTS if a["key"] == "pmo"))
    legacy = conn.execute(
        "SELECT p.id, p.planned_start, p.planned_end, p.lifecycle_status, sum(s.amount) AS total FROM spend_entries s "
        "JOIN projects p ON p.id = s.project_id WHERE s.deleted_at IS NULL GROUP BY p.id "
        "HAVING bool_and(s.note IS DISTINCT FROM %s)", (cfg.WEEKLY_SPEND_NOTE,)).fetchall()
    missing = {STORY["overdue"]: 2, STORY["steady"]: 1}
    names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM projects").fetchall()}
    with conn.cursor() as cur:
        for row in legacy:
            cur.execute("UPDATE spend_entries SET deleted_at = now() WHERE project_id = %s AND deleted_at IS NULL", (row["id"],))
            rows = weekly_spend_rows(rnd, str(row["id"]), row["planned_start"], row["planned_end"], float(row["total"]),
                                     str(pmo["id"]), today, missing.get(names[row["id"]], 0))
            if rows:
                cur.executemany(_INSERTS["spend_entries"], rows)
            counts["spend_converted_projects"] += 1
            counts["spend_rows"] += len(rows)

    # Severely over-allocated person (> 60 h/week)
    marcus = conn.execute("SELECT id FROM people WHERE email = 'marcus.webb@acme.example'").fetchone()
    if marcus is None:
        marcus = conn.execute("INSERT INTO people (full_name, email, job_title, department_id) SELECT 'Marcus Webb', "
                              "'marcus.webb@acme.example', 'Integration Lead', (SELECT id FROM departments ORDER BY name "
                              "LIMIT 1) RETURNING id").fetchone()
        targets = conn.execute("SELECT id, planned_start, planned_end FROM projects WHERE name = ANY(%s) ORDER BY name",
                               ([STORY["mismatch"], STORY["late"], STORY["steady"]],)).fetchall()
        for project, hours in zip(targets, (24, 20, 20)):
            conn.execute("INSERT INTO allocations (person_id, project_id, hours_per_week, start_date, end_date) "
                         "VALUES (%s, %s, %s, %s, %s)", (marcus["id"], project["id"], hours, project["planned_start"],
                                                          project["planned_end"]))
        counts["severe_person"] = 1

    # A locked account and a recent role change for the Admin's queue (demo state; the lockout rule itself is 15 min)
    admin = _user_by_email(conn, next(a["email"] for a in cfg.DEMO_ACCOUNTS if a["key"] == "admin"))
    locked = conn.execute("SELECT id FROM users WHERE role = 'PM' AND password_hash IS NULL AND locked_until IS NULL "
                          "ORDER BY email LIMIT 1").fetchone()
    if locked and not conn.execute("SELECT 1 FROM users WHERE locked_until > now()").fetchone():
        conn.execute("UPDATE users SET locked_until = now() + interval '30 days' WHERE id = %s", (locked["id"],))
        conn.execute("INSERT INTO audit_log (actor_user_id, entity_type, entity_id, action, after) "
                     "VALUES (%s, 'user', %s, 'LOCKED_OUT', %s::jsonb)",
                     (locked["id"], locked["id"], json.dumps({"reason": "5 failed sign-ins (demo data)"})))
        changed = conn.execute("SELECT id FROM users WHERE role = 'PM' AND id <> %s ORDER BY email OFFSET 1 LIMIT 1",
                               (locked["id"],)).fetchone()
        conn.execute("INSERT INTO audit_log (at, actor_user_id, entity_type, entity_id, action, before, after) "
                     "VALUES (now() - interval '2 days', %s, 'user', %s, 'UPDATED', %s::jsonb, %s::jsonb)",
                     (admin["id"], changed["id"], json.dumps({"role": "ANALYST"}), json.dumps({"role": "PM"})))
        counts["admin_story"] = 1

    # Health history: Payments Gateway Upgrade was Amber 5 days ago (so it "turned Red" this week);
    # Customer Portal Rebuild has been Red for longer (Amber 20 days ago).
    for name, days_ago in ((STORY["late"], 5), (STORY["mismatch"], 20)):
        project = conn.execute("SELECT id FROM projects WHERE name = %s", (name,)).fetchone()
        if project and not conn.execute("SELECT 1 FROM health_snapshots WHERE project_id = %s AND overall = 'AMBER' "
                                        "AND taken_at < now() - interval '1 day'", (project["id"],)).fetchone():
            conn.execute("INSERT INTO health_snapshots (project_id, overall, dimensions, reasons, flags, taken_at) "
                         "VALUES (%s, 'AMBER', %s::jsonb, %s::jsonb, '{}', now() - make_interval(days => %s))",
                         (project["id"], json.dumps({"schedule": "AMBER", "budget": "GREEN", "milestones": "AMBER"}),
                          json.dumps(["Milestones: one milestone was late."]), days_ago))
    return counts


_STEPS = {"v1": _seed_v1, "v2": _seed_v2, "v3": _seed_v3}


def run_seed(conn: Connection, today: date | None = None) -> dict[str, Any]:
    """Apply each pending seed version once (recorded in ``seed_runs``). Never deletes anything."""
    today = today or date.today()
    applied: dict[str, Any] = {}
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_SEED_LOCK_ID,))
        done = {r["version"] for r in conn.execute("SELECT version FROM seed_runs").fetchall()}
        for version in cfg.SEED_VERSIONS:
            if version in done:
                continue
            applied[version] = _STEPS[version](conn, today)
            conn.execute("INSERT INTO seed_runs (version) VALUES (%s)", (version,))
            audit.record(conn, None, "system", None, "SEED", after={"version": version, **applied[version]})
    if not applied:
        return {"status": "skipped", "reason": "all seed versions already applied"}
    logger.info("seed applied", extra={"fields": {"applied": list(applied)}})
    return {"status": "applied", "versions": applied}
