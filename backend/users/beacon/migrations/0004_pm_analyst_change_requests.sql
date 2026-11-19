-- PM Analyst role and change-request workflow (CONFIRMED by the stakeholder, 2026-11-19).
-- The "Team member" role (MEMBER) is replaced by "PM Analyst" (ANALYST).

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'ANALYST', token_epoch = token_epoch + 1 WHERE role = 'MEMBER';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'PMO', 'PM', 'ANALYST', 'EXEC'));

-- Which analysts work on which projects. Who assigns them is an ASSUMPTION: the project's PM
-- (and the PMO). Removing an assignment is soft (removed_at), so history is kept.
CREATE TABLE project_analysts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects (id),
    user_id      uuid NOT NULL REFERENCES users (id),
    assigned_by  uuid REFERENCES users (id),
    assigned_at  timestamptz NOT NULL DEFAULT now(),
    removed_at   timestamptz
);
CREATE UNIQUE INDEX project_analysts_active_uk ON project_analysts (project_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX project_analysts_user_idx ON project_analysts (user_id) WHERE removed_at IS NULL;

-- Proposed changes to milestones/tasks. Nothing is applied until the project's PM approves.
-- base_version = the entity's version when proposed; approval of a stale proposal returns 409.
CREATE TABLE change_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        uuid NOT NULL REFERENCES projects (id),
    proposer_user_id  uuid NOT NULL REFERENCES users (id),
    entity_type       text NOT NULL CHECK (entity_type IN ('MILESTONE', 'TASK')),
    entity_id         uuid NOT NULL,
    base_version      integer NOT NULL,
    changes           jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'object' AND changes <> '{}'::jsonb),
    note              text CHECK (note IS NULL OR length(note) <= 1000),
    status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    decided_by        uuid REFERENCES users (id),
    decided_at        timestamptz,
    reason            text CHECK (reason IS NULL OR length(reason) <= 1000),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT change_requests_reject_reason_ck CHECK (status <> 'REJECTED' OR length(btrim(coalesce(reason, ''))) > 0),
    CONSTRAINT change_requests_decision_ck CHECK ((status = 'PENDING') = (decided_at IS NULL))
);
CREATE INDEX change_requests_project_status_idx ON change_requests (project_id, status);
CREATE INDEX change_requests_proposer_idx ON change_requests (proposer_user_id, created_at DESC);
CREATE INDEX change_requests_entity_idx ON change_requests (entity_id);

-- Notes on plan items (analysts may propose them) and archive cascade support.
ALTER TABLE milestones ADD COLUMN notes text CHECK (notes IS NULL OR length(notes) <= 2000);
ALTER TABLE milestones ADD COLUMN archived_at timestamptz;
ALTER TABLE tasks ADD COLUMN notes text CHECK (notes IS NULL OR length(notes) <= 2000);
ALTER TABLE tasks ADD COLUMN archived_at timestamptz;
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);
