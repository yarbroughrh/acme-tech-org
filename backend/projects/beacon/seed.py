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
        accounts["member"]["person_id"] = add_person(accounts["member"]["display_name"], accounts["member"]["id"], "Software Engineer")
        people.append(accounts["member"]["person_id"])
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
        member_person = accounts["member"]["person_id"]
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
            rnd.choices(["LOW", "MEDIUM", "HIGH"], [2, 5, 3])[0], pmo_user))

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
                   elapsed * spend_factor if lifecycle != "CLOSED" else 0.97, pmo_user)
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
              fraction_of_budget: float, recorded_by: str) -> None:
        """Monthly spend entries, recorded by the Portfolio Manager (only PMO records spend, CONFIRMED)."""
        if lifecycle == "PROPOSED" or fraction_of_budget <= 0:
            return
        rnd, today = self.rnd, self.today
        last = min(today, end)
        months = max(1, (last - start).days // 30)
        total = float(budget) * fraction_of_budget
        weights = [rnd.uniform(0.8, 1.2) for _ in range(months)]
        scale = total / sum(weights)
        for m, weight in enumerate(weights):
            spent_on = min(start + timedelta(days=30 * m + 15), last)
            amount = Decimal(str(round(weight * scale, 2)))
            if amount <= 0:
                continue
            category = rnd.choices(["LABOUR", "VENDOR", "SOFTWARE_HARDWARE", "OTHER"], [6, 3, 2, 1])[0]
            self.rows["spend_entries"].append((_id(), project_id, spent_on, amount, category, None, recorded_by))

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
                 "actual_start, approved_budget, lifecycle_status, priority, created_by) "
                 "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"),
    "milestones": ("INSERT INTO milestones (id, project_id, name, owner_person_id, due_date, status, percent_complete) "
                   "VALUES (%s, %s, %s, %s, %s, %s, %s)"),
    "tasks": ("INSERT INTO tasks (id, project_id, milestone_id, title, status, assignee_person_id, due_date) "
              "VALUES (%s, %s, %s, %s, %s, %s, %s)"),
    "allocations": ("INSERT INTO allocations (id, person_id, project_id, hours_per_week, start_date, end_date) "
                    "VALUES (%s, %s, %s, %s, %s, %s)"),
    "spend_entries": ("INSERT INTO spend_entries (id, project_id, spent_on, amount, category, note, created_by) "
                      "VALUES (%s, %s, %s, %s, %s, %s, %s)"),
    "status_updates": ("INSERT INTO status_updates (id, project_id, author_user_id, reported_status, summary, created_at) "
                       "VALUES (%s, %s, %s, %s, %s, %s)"),
}


def run_seed(conn: Connection, today: date | None = None) -> dict[str, Any]:
    """Seed demo data once per SEED_VERSION. Returns a summary; never deletes anything."""
    today = today or date.today()
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (_SEED_LOCK_ID,))
            cur.execute("SELECT 1 FROM seed_runs WHERE version = %s", (cfg.SEED_VERSION,))
            if cur.fetchone():
                return {"status": "skipped", "reason": f"seed {cfg.SEED_VERSION} already applied"}
            builder = _Builder(today)
            builder.build()
            counts = {}
            for table, sql in _INSERTS.items():
                rows = builder.rows[table]
                if rows:
                    cur.executemany(sql, rows)
                counts[table] = len(rows)
            cur.execute("INSERT INTO seed_runs (version) VALUES (%s)", (cfg.SEED_VERSION,))
            audit.record(conn, None, "system", None, "SEED", after={"version": cfg.SEED_VERSION, **counts})
    logger.info("seed applied", extra={"fields": {"counts": counts}})
    return {"status": "applied", "version": cfg.SEED_VERSION, "counts": counts}
