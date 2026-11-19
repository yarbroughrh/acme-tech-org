-- Beacon core schema. The database enforces FKs, NOT NULL and CHECK constraints in addition to
-- API validation. Enumerations are stored as upper-case codes. Nothing is hard-deleted:
-- soft-delete / archive columns are used instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE app_secret (
    name        text PRIMARY KEY,
    value       text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seed_runs (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 2 AND 80),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    display_name          text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
    role                  text NOT NULL CHECK (role IN ('ADMIN', 'PMO', 'PM', 'MEMBER', 'EXEC')),
    password_hash         text,  -- NULL = no password set yet; sign-in impossible until an Admin reset
    must_change_password  boolean NOT NULL DEFAULT true,
    is_active             boolean NOT NULL DEFAULT true,
    failed_attempts       integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until          timestamptz,
    token_epoch           integer NOT NULL DEFAULT 0,  -- bump to revoke all sessions
    last_login_at         timestamptz,
    version               integer NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    updated_by            uuid REFERENCES users (id)
);
CREATE UNIQUE INDEX users_email_uk ON users (lower(email));
CREATE INDEX users_role_idx ON users (role);
CREATE INDEX users_name_trgm ON users USING gin (lower(display_name) gin_trgm_ops);

CREATE TABLE people (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name      text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
    email          text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    job_title      text,
    department_id  uuid NOT NULL REFERENCES departments (id),
    user_id        uuid UNIQUE REFERENCES users (id),
    is_active      boolean NOT NULL DEFAULT true,
    version        integer NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX people_email_uk ON people (lower(email));
CREATE INDEX people_department_idx ON people (department_id);
CREATE INDEX people_name_trgm ON people USING gin (lower(full_name) gin_trgm_ops);

CREATE TABLE projects (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 3 AND 120),
    description       text CHECK (description IS NULL OR length(description) <= 4000),
    sponsor           text CHECK (sponsor IS NULL OR length(sponsor) <= 120),
    department_id     uuid NOT NULL REFERENCES departments (id),
    pm_user_id        uuid NOT NULL REFERENCES users (id),
    planned_start     date NOT NULL,
    planned_end       date NOT NULL,
    actual_start      date,
    approved_budget   numeric(14, 2) NOT NULL CHECK (approved_budget > 0),
    lifecycle_status  text NOT NULL CHECK (lifecycle_status IN ('PROPOSED', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'CANCELLED')),
    priority          text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
    archived_at       timestamptz,
    health_overall    text CHECK (health_overall IN ('GREEN', 'AMBER', 'RED')),
    health_detail     jsonb,
    health_flags      text[] NOT NULL DEFAULT '{}',
    health_as_of      date,
    version           integer NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid REFERENCES users (id),
    updated_by        uuid REFERENCES users (id),
    CONSTRAINT projects_dates_ck CHECK (planned_end > planned_start)
);
CREATE UNIQUE INDEX projects_name_uk ON projects (lower(name));
CREATE INDEX projects_name_trgm ON projects USING gin (lower(name) gin_trgm_ops);
CREATE INDEX projects_department_idx ON projects (department_id);
CREATE INDEX projects_pm_idx ON projects (pm_user_id);
CREATE INDEX projects_lifecycle_idx ON projects (lifecycle_status);
CREATE INDEX projects_priority_idx ON projects (priority);
CREATE INDEX projects_health_idx ON projects (health_overall);
CREATE INDEX projects_planned_end_idx ON projects (planned_end);
CREATE INDEX projects_archived_idx ON projects (archived_at);

CREATE TABLE milestones (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL REFERENCES projects (id),
    name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
    description       text,
    owner_person_id   uuid REFERENCES people (id),
    due_date          date NOT NULL,
    status            text NOT NULL CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE')),
    percent_complete  integer CHECK (percent_complete BETWEEN 0 AND 100),
    deleted_at        timestamptz,
    version           integer NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    updated_by        uuid REFERENCES users (id)
);
CREATE INDEX milestones_project_idx ON milestones (project_id);
CREATE INDEX milestones_due_idx ON milestones (due_date);
CREATE INDEX milestones_owner_idx ON milestones (owner_person_id);

CREATE TABLE tasks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          uuid NOT NULL REFERENCES projects (id),
    milestone_id        uuid NOT NULL REFERENCES milestones (id),
    title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    status              text NOT NULL CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')),
    assignee_person_id  uuid REFERENCES people (id),
    due_date            date,
    deleted_at          timestamptz,
    version             integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    updated_by          uuid REFERENCES users (id)
);
CREATE INDEX tasks_project_idx ON tasks (project_id);
CREATE INDEX tasks_milestone_idx ON tasks (milestone_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_person_id);

CREATE TABLE allocations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id       uuid NOT NULL REFERENCES people (id),
    project_id      uuid NOT NULL REFERENCES projects (id),
    hours_per_week  numeric(4, 1) NOT NULL CHECK (hours_per_week >= 0.5 AND hours_per_week <= 60),
    start_date      date NOT NULL,
    end_date        date NOT NULL,
    archived_at     timestamptz,
    version         integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid REFERENCES users (id),
    CONSTRAINT allocations_dates_ck CHECK (end_date >= start_date)
);
CREATE INDEX allocations_person_idx ON allocations (person_id);
CREATE INDEX allocations_project_idx ON allocations (project_id);
CREATE INDEX allocations_dates_idx ON allocations (start_date, end_date);

CREATE TABLE spend_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects (id),
    spent_on    date NOT NULL,
    amount      numeric(14, 2) NOT NULL CHECK (amount > 0),
    category    text NOT NULL CHECK (category IN ('LABOUR', 'VENDOR', 'SOFTWARE_HARDWARE', 'OTHER')),
    note        text CHECK (note IS NULL OR length(note) <= 500),
    deleted_at  timestamptz,
    version     integer NOT NULL DEFAULT 1,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid REFERENCES users (id)
);
CREATE INDEX spend_project_idx ON spend_entries (project_id, spent_on);

CREATE TABLE status_updates (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       uuid NOT NULL REFERENCES projects (id),
    author_user_id   uuid NOT NULL REFERENCES users (id),
    reported_status  text NOT NULL CHECK (reported_status IN ('GREEN', 'AMBER', 'RED')),
    summary          text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 4000),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX status_updates_project_idx ON status_updates (project_id, created_at DESC);

CREATE TABLE health_snapshots (
    id          bigserial PRIMARY KEY,
    project_id  uuid NOT NULL REFERENCES projects (id),
    overall     text CHECK (overall IN ('GREEN', 'AMBER', 'RED')),
    dimensions  jsonb NOT NULL,
    reasons     jsonb NOT NULL,
    flags       text[] NOT NULL DEFAULT '{}',
    taken_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX health_snapshots_project_idx ON health_snapshots (project_id, taken_at DESC);

CREATE TABLE health_rules (
    key          text PRIMARY KEY,
    category     text NOT NULL CHECK (category IN ('SCHEDULE', 'BUDGET', 'MILESTONES', 'FLAGS', 'ALLOCATION')),
    value        numeric NOT NULL CHECK (value >= 0),
    unit         text NOT NULL,
    description  text NOT NULL,
    confirmed    boolean NOT NULL DEFAULT false,
    version      integer NOT NULL DEFAULT 1,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid REFERENCES users (id)
);

CREATE TABLE audit_log (
    id             bigserial PRIMARY KEY,
    at             timestamptz NOT NULL DEFAULT now(),
    actor_user_id  uuid REFERENCES users (id),
    entity_type    text NOT NULL,
    entity_id      uuid,
    project_id     uuid REFERENCES projects (id),
    action         text NOT NULL,
    before         jsonb,
    after          jsonb,
    request_id     text
);
CREATE INDEX audit_at_idx ON audit_log (at DESC);
CREATE INDEX audit_project_idx ON audit_log (project_id, at DESC);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_actor_idx ON audit_log (actor_user_id);

CREATE TABLE idempotency_keys (
    user_id       uuid NOT NULL REFERENCES users (id),
    key           text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
    route         text NOT NULL,
    request_hash  text NOT NULL,
    status_code   integer NOT NULL,
    response      jsonb NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
