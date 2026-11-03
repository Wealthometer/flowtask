import { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { byPosition, dueLabel, mentionParts, nextPosition, projectStatuses } from "../../data/model.ts";
import { mutate, newId, useStore, useWorkspace } from "../../data/store.ts";
import type { Comment, Member } from "../../data/types.ts";
import { Avatar, Check, Chunky, Empty, Icon, Pill, Progress, T, type IconName } from "../../ui/kit.tsx";
import { back, DueSheet, PersonSheet, PRIORITY, PrioritySheet, RoundButton, Sheet, SheetOption, whenText } from "../../ui/parts.tsx";
import { font, onSwatch, radius, space, stroke, swatches, tint, usePalette } from "../../ui/theme.ts";

function confirm(title: string, message: string, action: string, run: () => void) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: action, style: "destructive", onPress: run }]);
}

export default function TaskDetail() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace();
  const me = useStore((s) => s.user);
  const role = useStore((s) => s.workspaces.find((w) => w.id === s.currentId)?.role);
  const task = ws?.tasks[id ?? ""];
  const [sheet, setSheet] = useState<null | "person" | "due" | "priority" | "menu" | "move">(null);
  const [title, setTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState<Comment | null>(null);

  const members = useMemo(() => (ws ? Object.values(ws.members) : []), [ws]);
  const items = useMemo(() => (ws && task ? Object.values(ws.checklist).filter((x) => x.task_id === task.id).sort(byPosition) : []), [ws, task]);
  const comments = useMemo(() => (ws && task ? Object.values(ws.comments).filter((x) => x.task_id === task.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : []), [ws, task]);

  if (!ws || !me) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (!task) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.lg, paddingHorizontal: space.xl }}>
        <RoundButton icon="arrow-left" label="Back" onPress={back} />
        <Empty emoji="🫥" title="This task is gone" body="Someone deleted it, or it's in a workspace you're not looking at." />
      </View>
    );
  }
  const project = ws.projects[task.project_id];
  const statuses = projectStatuses(ws, task.project_id);
  const who = task.assignee_id ? ws.members[task.assignee_id] : undefined;
  const pr = PRIORITY[task.priority];
  const doneItems = items.filter((x) => x.done).length;
  const creator = ws.members[task.created_by];
  const accent = project?.color ?? "tangerine";

  const update = (args: Omit<Parameters<typeof mutate<"task.update">>[1], "id">) => mutate("task.update", { id: task.id, ...args });
  const saveTitle = () => {
    const v = (title ?? task.title).trim();
    if (v && v !== task.title) update({ title: v });
    setTitle(null);
  };
  const saveNotes = () => {
    if (notes !== null && notes !== task.notes) update({ notes });
    setNotes(null);
  };
  const addItem = () => {
    const v = newItem.trim();
    if (!v) return;
    mutate("checklist.upsert", { id: newId(), taskId: task.id, title: v, done: false, position: nextPosition(items) });
    setNewItem("");
  };
  const addLabel = () => {
    const v = newLabel.trim().slice(0, 24);
    if (v && !task.labels.includes(v) && task.labels.length < 10) update({ labels: [...task.labels, v] });
    setNewLabel("");
  };
  const send = () => {
    const body = comment.trim();
    if (!body) return;
    if (editing) mutate("comment.update", { id: editing.id, body });
    else mutate("comment.create", { id: newId(), taskId: task.id, body });
    setComment("");
    setEditing(null);
  };

  // "@ti" at the end of the box suggests teammates to mention.
  const mentionQuery = /(?:^|\s)@([\w-]*)$/.exec(comment)?.[1];
  const suggestions = mentionQuery !== undefined ? members.filter((m) => m.id !== me.id && m.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 4) : [];
  const insertMention = (m: Member) => setComment((v) => v.replace(/@([\w-]*)$/, `@${m.name.split(" ")[0]} `));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + space.md, paddingHorizontal: space.xl, paddingBottom: 140, gap: space.xl }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
          <RoundButton icon="arrow-left" label="Back" onPress={back} testID="back" />
          {project ? (
            <Pressable onPress={() => router.push(`/project/${project.id}`)} style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: swatches[project.color], borderWidth: stroke, borderColor: c.outline, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Icon name={project.icon as IconName} size={16} color={onSwatch[project.color]} />
              <Text numberOfLines={1} style={{ fontFamily: font.bodyBold, fontSize: 14, color: onSwatch[project.color], flexShrink: 1 }}>{project.name}</Text>
            </Pressable>
          ) : null}
          <RoundButton icon="dots-horizontal" label="Task options" onPress={() => setSheet("menu")} testID="task-menu" />
        </View>

        <TextInput
          testID="task-title"
          accessibilityLabel="Task title"
          value={title ?? task.title}
          onChangeText={setTitle}
          onBlur={saveTitle}
          onSubmitEditing={saveTitle}
          multiline
          blurOnSubmit
          style={{ fontFamily: font.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.8, color: c.text, padding: 0, textDecorationLine: task.completed_at ? "line-through" : "none" }}
        />

        <View style={{ gap: space.sm }}>
          <T variant="label">Status</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {statuses.map((s) => (
              <Pill key={s.id} testID={`status-${s.name}`} label={s.name} color={s.color} solid={s.id === task.status_id} icon={s.category === "done" ? "check-bold" : undefined} onPress={() => update({ statusId: s.id })} />
            ))}
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: space.md }}>
          <Meta label="Assignee" onPress={() => setSheet("person")} testID="pick-assignee">
            {who ? <Avatar name={who.name} color={who.color} size={26} /> : <Icon name="account-question-outline" size={22} />}
            <T variant="bodyBold" numberOfLines={1} style={{ flexShrink: 1 }}>{who ? (who.id === me.id ? "Me" : who.name.split(" ")[0]) : "Nobody"}</T>
          </Meta>
          <Meta label="Due" fill={task.due_on && !task.completed_at && task.due_on <= new Date().toISOString().slice(0, 10) ? tint.tomato : undefined} onPress={() => setSheet("due")} testID="pick-due">
            <Icon name="calendar-blank" size={20} color={task.due_on ? "#1B1530" : undefined} />
            <T variant="bodyBold" numberOfLines={1} color={task.due_on && !task.completed_at && task.due_on <= new Date().toISOString().slice(0, 10) ? "#1B1530" : undefined}>{task.due_on ? dueLabel(task.due_on) : "None"}</T>
          </Meta>
          <Meta label="Priority" fill={tint[pr.color]} onPress={() => setSheet("priority")} testID="pick-priority">
            <Icon name={pr.icon} size={20} color="#1B1530" />
            <T variant="bodyBold" color="#1B1530">{pr.label}</T>
          </Meta>
        </View>

        <View style={{ gap: space.sm }}>
          <T variant="label">Labels</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, alignItems: "center" }}>
            {task.labels.map((l) => (
              <Pill key={l} label={`${l}  ✕`} color="sky" onPress={() => update({ labels: task.labels.filter((x) => x !== l) })} />
            ))}
            <TextInput
              accessibilityLabel="Add a label"
              value={newLabel}
              onChangeText={setNewLabel}
              onSubmitEditing={addLabel}
              onBlur={addLabel}
              placeholder="+ label"
              placeholderTextColor={c.muted}
              style={{ fontFamily: font.bodyBold, fontSize: 13, color: c.text, minWidth: 80, paddingVertical: 6, paddingHorizontal: 10, borderWidth: stroke, borderStyle: "dashed", borderColor: c.muted, borderRadius: radius.pill }}
            />
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <T variant="label">Notes</T>
          <TextInput
            testID="task-notes"
            accessibilityLabel="Notes"
            value={notes ?? task.notes}
            onChangeText={setNotes}
            onBlur={saveNotes}
            multiline
            placeholder="Add details, links, the why…"
            placeholderTextColor={c.muted}
            style={{ fontFamily: font.body, fontSize: 16, lineHeight: 22, color: c.text, minHeight: 90, textAlignVertical: "top", backgroundColor: c.surface, borderWidth: stroke, borderColor: c.outline, borderRadius: radius.md, padding: space.md }}
          />
        </View>

        <Chunky innerStyle={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T variant="h3">Checklist</T>
            {items.length ? <T variant="small" style={{ fontFamily: font.bodyBold }}>{doneItems}/{items.length}</T> : null}
          </View>
          {items.length ? <Progress value={doneItems / items.length} color={accent} /> : null}
          {items.map((item) => (
            <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Check done={item.done} color={accent} size={26} label={item.title} onToggle={() => mutate("checklist.upsert", { id: item.id, taskId: task.id, title: item.title, done: !item.done, position: item.position })} />
              <T style={[{ flex: 1 }, item.done ? { textDecorationLine: "line-through", opacity: 0.5 } : null]}>{item.title}</T>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.title}`} hitSlop={8} onPress={() => mutate("checklist.delete", { id: item.id })}>
                <Icon name="close" size={18} color={c.muted} />
              </Pressable>
            </View>
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Icon name="plus-circle-outline" size={26} color={c.muted} />
            <TextInput testID="checklist-add" accessibilityLabel="Add a checklist item" value={newItem} onChangeText={setNewItem} onSubmitEditing={addItem} blurOnSubmit={false} placeholder="Add an item" placeholderTextColor={c.muted} style={{ flex: 1, minWidth: 0, fontFamily: font.body, fontSize: 16, color: c.text, paddingVertical: 6 }} />
          </View>
        </Chunky>

        <View style={{ gap: space.md }}>
          <T variant="h3">Comments{comments.length ? ` · ${comments.length}` : ""}</T>
          {comments.length === 0 ? <T variant="muted">No comments yet. Type @ to mention a teammate.</T> : null}
          {comments.map((m) => {
            const author = ws.members[m.author_id];
            const mine = m.author_id === me.id;
            const parts = mentionParts(m.body, members.map((x) => x.name));
            return (
              <Pressable
                key={m.id}
                testID={`comment-${m.body}`}
                onLongPress={() => {
                  if (mine) {
                    setEditing(m);
                    setComment(m.body);
                  } else if (role !== "member") {
                    confirm("Delete this comment?", m.body, "Delete", () => mutate("comment.delete", { id: m.id }));
                  }
                }}
                style={{ flexDirection: mine ? "row-reverse" : "row", gap: space.sm, alignItems: "flex-end" }}
              >
                <Avatar name={author?.name ?? "Deleted user"} color={author?.color ?? "sky"} size={30} />
                <View style={{ maxWidth: "78%", backgroundColor: mine ? swatches.lemon : c.surface, borderWidth: stroke, borderColor: c.outline, borderRadius: radius.md, borderBottomRightRadius: mine ? 4 : radius.md, borderBottomLeftRadius: mine ? radius.md : 4, padding: space.md, gap: 4 }}>
                  <T variant="small" color={mine ? "#5A5270" : c.muted} style={{ fontFamily: font.bodyBold }}>
                    {author?.name.split(" ")[0] ?? "Deleted user"} · {whenText(m.created_at)}{m.edited_at ? " · edited" : ""}
                  </T>
                  <Text style={{ fontFamily: font.body, fontSize: 16, lineHeight: 22, color: mine ? "#1B1530" : c.text }}>
                    {parts.map((p, i) => (p.mention ? <Text key={i} style={{ fontFamily: font.bodyBold, color: mine ? "#6D28D9" : swatches.grape }}>{p.text}</Text> : <Text key={i}>{p.text}</Text>))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <T variant="small" style={{ textAlign: "center" }}>
          Added by {creator?.name ?? "someone"} · {whenText(task.created_at)}{task.completed_at ? ` · finished ${whenText(task.completed_at)}` : ""}
        </T>
      </ScrollView>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: insets.bottom + space.md, backgroundColor: c.bg, borderTopWidth: stroke, borderColor: c.outline, gap: space.sm }}>
        {suggestions.length ? (
          <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: space.sm }}>
            {suggestions.map((m) => (
              <Pressable key={m.id} onPress={() => insertMention(m)} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.surface, borderWidth: stroke, borderColor: c.outline, borderRadius: radius.pill, paddingRight: 12, paddingLeft: 4, paddingVertical: 3 }}>
                <Avatar name={m.name} color={m.color} size={24} />
                <T variant="small" style={{ fontFamily: font.bodyBold }} color={c.text}>@{m.name.split(" ")[0]}</T>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {editing ? (
          <Pressable onPress={() => { setEditing(null); setComment(""); }} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Icon name="pencil" size={14} color={c.muted} />
            <T variant="small">Editing your comment · tap to cancel</T>
            <Pressable onPress={() => { mutate("comment.delete", { id: editing.id }); setEditing(null); setComment(""); }} style={{ marginLeft: "auto" }}>
              <T variant="small" color={c.danger} style={{ fontFamily: font.bodyBold }}>Delete it</T>
            </Pressable>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <TextInput
            testID="comment-input"
            accessibilityLabel="Write a comment"
            value={comment}
            onChangeText={setComment}
            placeholder="Write a comment… (@ to mention)"
            placeholderTextColor={c.muted}
            multiline
            numberOfLines={1}
            style={{ flex: 1, minWidth: 0, maxHeight: 120, fontFamily: font.body, fontSize: 16, color: c.text, backgroundColor: c.surface, borderWidth: stroke, borderColor: c.outline, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: 12 }}
          />
          <Chunky onPress={send} accessibilityLabel="Send comment" testID="send-comment" fill={swatches.tangerine} r={24} depth={3} disabled={!comment.trim()} innerStyle={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <Icon name={editing ? "check-bold" : "send"} size={22} color="#1B1530" />
          </Chunky>
        </View>
      </View>

      <PersonSheet open={sheet === "person"} onClose={() => setSheet(null)} members={members} value={task.assignee_id} onPick={(assigneeId) => update({ assigneeId })} />
      <DueSheet open={sheet === "due"} onClose={() => setSheet(null)} value={task.due_on} onPick={(dueOn) => update({ dueOn })} />
      <PrioritySheet open={sheet === "priority"} onClose={() => setSheet(null)} value={task.priority} onPick={(priority) => update({ priority })} />
      <Sheet open={sheet === "menu"} onClose={() => setSheet(null)} title="Task">
        <SheetOption label="Move to another project" onPress={() => setSheet("move")} left={<Icon name="folder-move" size={28} />} />
        <SheetOption
          label="Delete task"
          sub="Removes it for everyone"
          testID="delete-task"
          onPress={() => confirm("Delete this task?", task.title, "Delete", () => { mutate("task.delete", { id: task.id }); setSheet(null); back(); })}
          left={<Icon name="delete" size={28} color={c.danger} />}
        />
      </Sheet>
      <Sheet open={sheet === "move"} onClose={() => setSheet(null)} title="Move to project">
        {Object.values(ws.projects)
          .filter((p) => p.id !== task.project_id && !p.archived_at)
          .map((p) => (
            <SheetOption
              key={p.id}
              label={p.name}
              onPress={() => {
                const first = projectStatuses(ws, p.id).find((s) => s.category === (ws.statuses[task.status_id]?.category ?? "todo")) ?? projectStatuses(ws, p.id)[0];
                if (first) mutate("task.update", { id: task.id, projectId: p.id, statusId: first.id });
                setSheet(null);
              }}
              left={<View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: swatches[p.color], borderWidth: stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}><Icon name={p.icon as IconName} size={16} color={onSwatch[p.color]} /></View>}
            />
          ))}
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function Meta({ label, children, fill, onPress, testID }: { label: string; children: React.ReactNode; fill?: string; onPress: () => void; testID?: string }) {
  const c = usePalette();
  return (
    <Chunky depth={3} r={radius.md} fill={fill} onPress={onPress} testID={testID} accessibilityLabel={label} style={{ flex: 1 }} stretch innerStyle={{ padding: space.md, gap: 6 }}>
      <T variant="label" color={fill ? "#5A5270" : c.muted}>{label}</T>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{children}</View>
    </Chunky>
  );
}
