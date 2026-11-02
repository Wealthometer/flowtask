// Rows as the server sends them (snake_case, timestamps as ISO strings).
export type Swatch = "tangerine" | "grape" | "mint" | "sky" | "lemon" | "bubblegum" | "tomato" | "leaf";
export type Role = "owner" | "admin" | "member";
export type Priority = "urgent" | "high" | "medium" | "low";
export type Category = "todo" | "doing" | "done";

export type User = { id: string; email: string; name: string; color: Swatch };

export type WorkspaceSummary = { id: string; name: string; role: Role; member_count: number };

export type Member = { id: string; name: string; email: string; color: Swatch; role: Role; joined_at: string; deleted_at: string | null; version: number };

export type Project = {
  id: string;
  name: string;
  color: Swatch;
  icon: string;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  version: number;
};

export type Status = { id: string; project_id: string; name: string; color: Swatch; category: Category; position: number; deleted_at: string | null; version: number };

export type Task = {
  id: string;
  project_id: string;
  status_id: string;
  title: string;
  notes: string;
  assignee_id: string | null;
  due_on: string | null;
  priority: Priority;
  labels: string[];
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
  version: number;
};

export type ChecklistItem = { id: string; task_id: string; title: string; done: boolean; position: number; deleted_at: string | null; version: number };

export type Comment = { id: string; task_id: string; author_id: string; body: string; created_at: string; edited_at: string | null; deleted_at: string | null; version: number };

export type Activity = { id: string; actor_id: string; kind: string; project_id: string | null; task_id: string | null; data: Record<string, unknown>; created_at: string; version: number };

export type PullResult = {
  cursor: number;
  full: boolean;
  workspace: { id: string; name: string; created_at: string; version: number } | null;
  members: Member[];
  projects: Project[];
  statuses: Status[];
  tasks: Task[];
  checklist: ChecklistItem[];
  comments: Comment[];
  activity: Activity[];
};

/** Everything the phone keeps for one workspace. */
export type WorkspaceData = {
  id: string;
  name: string;
  cursor: number;
  members: Record<string, Member>;
  projects: Record<string, Project>;
  statuses: Record<string, Status>;
  tasks: Record<string, Task>;
  checklist: Record<string, ChecklistItem>;
  comments: Record<string, Comment>;
  activity: Activity[];
};

export type Notification = {
  id: string;
  workspace_id: string;
  kind: "assigned" | "comment" | "mention" | "completed";
  task_id: string;
  text: string;
  read_at: string | null;
  created_at: string;
  actor_id: string;
  actor_name: string;
  actor_color: Swatch;
  project_id: string | null;
  task_deleted: boolean | null;
};
