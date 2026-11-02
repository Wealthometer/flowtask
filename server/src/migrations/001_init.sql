-- FlowTask schema.
--
-- Sync model: every row a client can see carries `version`, taken from one global sequence on every
-- insert and update. A client asks for "everything in my workspace with version > N" and gets
-- inserts, updates and soft deletes (deleted_at) in one pass. IDs of projects, statuses, tasks,
-- checklist items and comments are UUIDs generated on the phone, so things can be created offline.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE SEQUENCE change_seq;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  color         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  version       bigint NOT NULL DEFAULT nextval('change_seq')
);

CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE push_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version    bigint NOT NULL DEFAULT nextval('change_seq')
);

CREATE TABLE members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  version      bigint NOT NULL DEFAULT nextval('change_seq'),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX members_user ON members(user_id) WHERE deleted_at IS NULL;

CREATE TABLE invites (
  code         text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('admin', 'member')),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  max_uses     int NOT NULL CHECK (max_uses > 0),
  uses         int NOT NULL DEFAULT 0 CHECK (uses <= max_uses),
  revoked_at   timestamptz
);

CREATE TABLE projects (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  color        text NOT NULL,
  icon         text NOT NULL,
  position     double precision NOT NULL DEFAULT 0,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  deleted_at   timestamptz,
  version      bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX projects_sync ON projects(workspace_id, version);

-- The workflow columns of a project ("To do", "Doing", "Done", or whatever the team needs).
CREATE TABLE statuses (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  color       text NOT NULL,
  category    text NOT NULL CHECK (category IN ('todo', 'doing', 'done')),
  position    double precision NOT NULL,
  deleted_at  timestamptz,
  version     bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX statuses_sync ON statuses(workspace_id, version);

CREATE TABLE tasks (
  id           uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status_id    uuid NOT NULL REFERENCES statuses(id),
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  notes        text NOT NULL DEFAULT '' CHECK (length(notes) <= 10000),
  assignee_id  uuid REFERENCES users(id),
  due_on       date,
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  labels       text[] NOT NULL DEFAULT '{}',
  position     double precision NOT NULL DEFAULT 0,
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deleted_at   timestamptz,
  version      bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX tasks_sync ON tasks(workspace_id, version);
CREATE INDEX tasks_assignee ON tasks(assignee_id) WHERE deleted_at IS NULL;

CREATE TABLE checklist_items (
  id           uuid PRIMARY KEY,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  done         boolean NOT NULL DEFAULT false,
  position     double precision NOT NULL,
  deleted_at   timestamptz,
  version      bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX checklist_sync ON checklist_items(workspace_id, version);

CREATE TABLE comments (
  id           uuid PRIMARY KEY,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES users(id),
  body         text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  version      bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX comments_sync ON comments(workspace_id, version);

-- What happened, for the activity feed.
CREATE TABLE activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL,
  project_id   uuid,
  task_id      uuid,
  data         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  version      bigint NOT NULL DEFAULT nextval('change_seq')
);
CREATE INDEX activity_sync ON activity(workspace_id, version);

-- Things a person should look at: assigned to them, comments on their tasks, mentions.
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('assigned', 'comment', 'mention', 'completed')),
  task_id      uuid NOT NULL,
  text         text NOT NULL,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);

-- Push notifications waiting to be sent through Expo's push service.
CREATE TABLE push_outbox (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  attempts    int NOT NULL DEFAULT 0,
  next_at     timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  last_error  text
);
CREATE INDEX push_outbox_due ON push_outbox(next_at) WHERE sent_at IS NULL;

-- Mutations already applied, so a retried push from a phone is never applied twice.
CREATE TABLE applied_mutations (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result     jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Every update takes a fresh version, so pulls pick it up. Writers to a workspace hold an advisory
-- lock for that workspace, so versions within a workspace become visible in order.
CREATE FUNCTION bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := nextval('change_seq');
  RETURN NEW;
END $$;

CREATE TRIGGER users_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER workspaces_version BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER members_version BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER projects_version BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER statuses_version BEFORE UPDATE ON statuses FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER tasks_version BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER checklist_version BEFORE UPDATE ON checklist_items FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER comments_version BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION bump_version();
