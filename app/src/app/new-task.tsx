import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { dueLabel, nextPosition, projectStatuses, projectTasks } from "../data/model.ts";
import { mutate, newId, toast, useStore, useWorkspace } from "../data/store.ts";
import type { Priority } from "../data/types.ts";
import { Avatar, Button, Empty, Field, Icon, Pill, T } from "../ui/kit.tsx";
import { back, DueSheet, Page, PersonSheet, PRIORITY, TopBar } from "../ui/parts.tsx";
import { space, stroke, usePalette } from "../ui/theme.ts";

/** Quick capture from the big "+": title first, everything else optional. */
export default function NewTask() {
  const params = useLocalSearchParams<{ projectId?: string; statusId?: string }>();
  const ws = useWorkspace();
  const me = useStore((s) => s.user);
  const projects = ws ? Object.values(ws.projects).filter((p) => !p.archived_at).sort((a, b) => a.position - b.position) : [];
  const [projectId, setProjectId] = useState(params.projectId ?? projects[0]?.id ?? "");
  const statuses = ws && projectId ? projectStatuses(ws, projectId) : [];
  const [statusId, setStatusId] = useState(params.statusId ?? "");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string | null>(me?.id ?? null);
  const [due, setDue] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("medium");
  const [sheet, setSheet] = useState<null | "person" | "due">(null);
  const [error, setError] = useState<string | undefined>();

  if (!ws || !me) return null;
  if (!projects.length) {
    return (
      <Page>
        <TopBar title="New task" />
        <Empty emoji="🗂️" title="Make a project first" body="Tasks live in projects." action={<Button title="New project" icon="plus" onPress={() => router.replace("/project/new")} />} />
      </Page>
    );
  }
  const column = statuses.find((s) => s.id === statusId) ?? statuses.find((s) => s.category === "todo") ?? statuses[0];
  const who = assignee ? ws.members[assignee] : undefined;

  const create = (another: boolean) => {
    if (!title.trim()) return setError("What needs doing?");
    if (!column) return;
    const inCol = projectTasks(ws, projectId).filter((t) => t.status_id === column.id);
    mutate("task.create", { id: newId(), projectId, statusId: column.id, title: title.trim(), assigneeId: assignee, dueOn: due, priority, position: nextPosition(inCol) });
    if (another) {
      setTitle("");
      toast("Added. Keep going!", "ok");
    } else back();
  };

  return (
    <Page footer={
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button title="Add another" kind="plain" onPress={() => create(true)} style={{ flex: 1 }} testID="add-another" />
        <Button title="Add task" icon="check-bold" onPress={() => create(false)} style={{ flex: 1.3 }} testID="add-task" />
      </View>
    }>
      <TopBar title="New task" />
      <Field label="What needs doing?" value={title} onChangeText={(v) => { setTitle(v); setError(undefined); }} placeholder="e.g. Call the printer about proofs" autoFocus error={error} onSubmitEditing={() => create(false)} testID="new-task-title" />

      <View style={{ gap: space.sm }}>
        <T variant="label">Project</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {projects.map((p) => (
            <Pill key={p.id} label={p.name} color={p.color} solid={p.id === projectId} onPress={() => { setProjectId(p.id); setStatusId(""); }} testID={`pick-project-${p.name}`} />
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: space.sm }}>
        <T variant="label">Column</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {statuses.map((s) => <Pill key={s.id} label={s.name} color={s.color} solid={s.id === column?.id} onPress={() => setStatusId(s.id)} />)}
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: space.md }}>
        <Pick label="Assignee" onPress={() => setSheet("person")} testID="new-assignee">
          {who ? <Avatar name={who.name} color={who.color} size={24} /> : <Icon name="account-question-outline" size={22} />}
          <T variant="bodyBold" numberOfLines={1}>{who ? (who.id === me.id ? "Me" : who.name.split(" ")[0]) : "Nobody"}</T>
        </Pick>
        <Pick label="Due" onPress={() => setSheet("due")} testID="new-due">
          <Icon name="calendar-blank" size={20} />
          <T variant="bodyBold">{due ? dueLabel(due) : "No date"}</T>
        </Pick>
      </View>

      <View style={{ gap: space.sm }}>
        <T variant="label">Priority</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {(Object.keys(PRIORITY) as Priority[]).map((p) => <Pill key={p} label={PRIORITY[p].label} color={PRIORITY[p].color} icon={PRIORITY[p].icon} solid={priority === p} onPress={() => setPriority(p)} />)}
        </View>
      </View>

      <PersonSheet open={sheet === "person"} onClose={() => setSheet(null)} members={Object.values(ws.members)} value={assignee} onPick={setAssignee} />
      <DueSheet open={sheet === "due"} onClose={() => setSheet(null)} value={due} onPick={setDue} />
    </Page>
  );
}

function Pick({ label, children, onPress, testID }: { label: string; children: React.ReactNode; onPress: () => void; testID: string }) {
  const c = usePalette();
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <T variant="label">{label}</T>
      <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: stroke, borderColor: c.outline, borderRadius: 14, backgroundColor: c.surface, paddingHorizontal: space.md, paddingVertical: 12 }}>
        {children}
      </Pressable>
    </View>
  );
}
