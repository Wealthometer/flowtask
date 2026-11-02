import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { between, byPosition, nextPosition, progress, projectStatuses, projectTasks } from "../../data/model.ts";
import { mutate, newId, useStore, useWorkspace } from "../../data/store.ts";
import type { Category, Status, Task } from "../../data/types.ts";
import { AvatarStack, Button, Chunky, Empty, Field, Icon, Pill, Progress, Segmented, T, type IconName } from "../../ui/kit.tsx";
import { back, NetPill, PROJECT_ICONS, RoundButton, Sheet, SheetOption, SwatchPicker, TaskCard } from "../../ui/parts.tsx";
import { font, onSwatch, radius, space, stroke, swatches, usePalette, type Swatch } from "../../ui/theme.ts";

function confirmThen(message: string, run: () => void) {
  if (Platform.OS === "web" ? window.confirm(message) : true) run();
}

export default function ProjectBoard() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useWorkspace();
  const me = useStore((s) => s.user?.id);
  const role = useStore((s) => s.workspaces.find((w) => w.id === s.currentId)?.role);
  const [mode, setMode] = useState<"board" | "list">("board");
  const [mine, setMine] = useState(false);
  const [menu, setMenu] = useState(false);
  const [card, setCard] = useState<Task | null>(null);
  const [columns, setColumns] = useState(false);

  const project = ws?.projects[id ?? ""];
  const statuses = useMemo(() => (ws && project ? projectStatuses(ws, project.id) : []), [ws, project]);
  const tasks = useMemo(() => (ws && project ? projectTasks(ws, project.id).filter((t) => !mine || t.assignee_id === me) : []), [ws, project, mine, me]);

  if (!ws) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space.lg, paddingHorizontal: space.xl }}>
        <RoundButton icon="arrow-left" label="Back" onPress={back} />
        <Empty emoji="🫥" title="This project is gone" body="It was deleted, or you no longer have access." />
      </View>
    );
  }
  const p = progress(ws, project.id);
  const fg = onSwatch[project.color];
  const people = [...new Set(projectTasks(ws, project.id).map((t) => t.assignee_id).filter(Boolean))].map((x) => ws.members[x!]).filter((m) => !!m);
  const columnWidth = Math.min(300, width - 70);
  const canDelete = project.created_by === me || role !== "member";

  const moveCard = (t: Task, statusId: string) => {
    const inCol = projectTasks(ws, project.id).filter((x) => x.status_id === statusId && x.id !== t.id);
    mutate("task.update", { id: t.id, statusId, position: nextPosition(inCol) });
  };
  const nudge = (t: Task, dir: -1 | 1) => {
    const col = projectTasks(ws, project.id).filter((x) => x.status_id === t.status_id);
    const i = col.findIndex((x) => x.id === t.id);
    const j = i + dir;
    if (j < 0 || j >= col.length) return;
    const pos = dir < 0 ? between(col[j - 1]?.position, col[j]!.position) : between(col[j]!.position, col[j + 1]?.position);
    mutate("task.update", { id: t.id, position: pos });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ backgroundColor: swatches[project.color], borderBottomWidth: stroke, borderColor: c.outline, paddingTop: insets.top + space.md, paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.lg, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <RoundButton icon="arrow-left" label="Back" onPress={back} fill="#FFFFFF" testID="back" />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <RoundButton icon="plus" label="Add task" onPress={() => router.push({ pathname: "/new-task", params: { projectId: project.id } })} fill="#FFFFFF" />
            <RoundButton icon="dots-horizontal" label="Project settings" onPress={() => setMenu(true)} fill="#FFFFFF" testID="project-menu" />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: "#FFFFFF", borderWidth: stroke, borderColor: "#1B1530", alignItems: "center", justifyContent: "center", transform: [{ rotate: "-6deg" }] }}>
            <Icon name={project.icon as IconName} size={30} color="#1B1530" />
          </View>
          <Text style={{ flex: 1, fontFamily: font.display, fontSize: 30, lineHeight: 32, letterSpacing: -0.8, color: fg }} numberOfLines={2}>{project.name}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          {people.length ? <AvatarStack people={people} size={32} /> : null}
          <View style={{ flex: 1, gap: 4 }}>
            <Progress value={p.total ? p.done / p.total : 0} color="lemon" onDark />
            <Text style={{ fontFamily: font.bodyBold, fontSize: 13, color: fg }}>{p.total ? `${Math.round((p.done / p.total) * 100)}% · ${p.done} of ${p.total} done` : "No tasks yet"}{project.archived_at ? " · archived" : ""}</Text>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.md, gap: space.md }}>
        <NetPill />
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Segmented options={[{ value: "board", label: "Board", icon: "view-column" }, { value: "list", label: "List", icon: "format-list-bulleted" }]} value={mode} onChange={setMode} />
          </View>
          <Pill label="Mine" color="bubblegum" icon="account" solid={mine} onPress={() => setMine((v) => !v)} testID="filter-mine" />
        </View>
      </View>

      {mode === "board" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.lg, paddingBottom: insets.bottom + 40 }} snapToInterval={columnWidth + space.lg} decelerationRate="fast">
          {statuses.map((s) => {
            const col = tasks.filter((t) => t.status_id === s.id);
            return (
              <View key={s.id} style={{ width: columnWidth, gap: space.md }} testID={`column-${s.name}`}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: swatches[s.color], borderWidth: stroke, borderColor: c.outline }} />
                  <T variant="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{s.name}</T>
                  <View style={{ backgroundColor: c.ink, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 }}>
                    <Text style={{ fontFamily: font.bodyBold, fontSize: 12, color: c.bg }}>{col.length}</Text>
                  </View>
                  {s.category === "done" ? <Icon name="flag-checkered" size={16} color={c.muted} /> : null}
                </View>
                <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.md, paddingRight: 4 }} showsVerticalScrollIndicator={false}>
                  {col.map((t) => <TaskCard key={t.id} task={t} ws={ws} onLongPress={() => setCard(t)} />)}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add a task to ${s.name}`}
                    onPress={() => router.push({ pathname: "/new-task", params: { projectId: project.id, statusId: s.id } })}
                    style={{ borderWidth: stroke, borderStyle: "dashed", borderColor: c.muted, borderRadius: radius.md, padding: space.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}
                  >
                    <Icon name="plus" size={18} color={c.muted} />
                    <T variant="small">Add a task</T>
                  </Pressable>
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.md, paddingBottom: insets.bottom + 40 }}>
          {statuses.map((s) => {
            const col = tasks.filter((t) => t.status_id === s.id);
            if (!col.length) return null;
            return (
              <View key={s.id} style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.sm }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: swatches[s.color], borderWidth: stroke, borderColor: c.outline }} />
                  <T variant="label">{s.name} · {col.length}</T>
                </View>
                {col.map((t) => <TaskCard key={t.id} task={t} ws={ws} onLongPress={() => setCard(t)} />)}
              </View>
            );
          })}
          {tasks.length === 0 ? <Empty emoji={mine ? "🙌" : "🌱"} title={mine ? "Nothing assigned to you here" : "No tasks yet"} body="Tap + to add the first one." /> : null}
        </ScrollView>
      )}

      <Sheet open={!!card} onClose={() => setCard(null)} title={card?.title ?? ""}>
        {card ? (
          <>
            <T variant="label">Move to</T>
            {statuses.map((s) => (
              <SheetOption
                key={s.id}
                label={s.name}
                selected={card.status_id === s.id}
                onPress={() => { moveCard(card, s.id); setCard(null); }}
                left={<View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: swatches[s.color], borderWidth: stroke, borderColor: c.outline }} />}
              />
            ))}
            <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
              <Button title="Up" icon="arrow-up" kind="plain" small style={{ flex: 1 }} onPress={() => { nudge(card, -1); setCard(null); }} />
              <Button title="Down" icon="arrow-down" kind="plain" small style={{ flex: 1 }} onPress={() => { nudge(card, 1); setCard(null); }} />
            </View>
            <Button title="Open task" kind="ghost" onPress={() => { setCard(null); router.push(`/task/${card.id}`); }} />
          </>
        ) : null}
      </Sheet>

      <ProjectSettings
        open={menu}
        onClose={() => setMenu(false)}
        projectId={project.id}
        onColumns={() => { setMenu(false); setColumns(true); }}
        canDelete={canDelete}
      />
      <ColumnsSheet open={columns} onClose={() => setColumns(false)} projectId={project.id} />
    </View>
  );
}

function ProjectSettings({ open, onClose, projectId, onColumns, canDelete }: { open: boolean; onClose: () => void; projectId: string; onColumns: () => void; canDelete: boolean }) {
  const ws = useWorkspace();
  const project = ws?.projects[projectId];
  const [name, setName] = useState(project?.name ?? "");
  const c = usePalette();
  if (!project) return null;
  return (
    <Sheet open={open} onClose={onClose} title="Project">
      <View style={{ gap: space.lg }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Field label="Name" value={name} onChangeText={setName} onFocus={() => setName(project.name)} />
          </View>
          <Button title="Save" small onPress={() => name.trim() && mutate("project.update", { id: projectId, name: name.trim() })} style={{ marginBottom: 0 }} />
        </View>
        <SwatchPicker value={project.color} onChange={(color) => mutate("project.update", { id: projectId, color })} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {PROJECT_ICONS.map((i) => (
            <Pressable accessibilityRole="button" key={i} accessibilityLabel={i} onPress={() => mutate("project.update", { id: projectId, icon: i })} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: stroke, borderColor: project.icon === i ? c.outline : "transparent", backgroundColor: project.icon === i ? swatches[project.color] : c.surface }}>
              <Icon name={i} size={22} color={project.icon === i ? onSwatch[project.color] : c.text} />
            </Pressable>
          ))}
        </ScrollView>
        <SheetOption label="Edit columns" sub="Rename, recolour, add or remove workflow steps" onPress={onColumns} left={<Icon name="view-column" size={28} />} testID="edit-columns" />
        <SheetOption
          label={project.archived_at ? "Restore project" : "Archive project"}
          sub={project.archived_at ? "Bring it back to the project list" : "Hide it from Home and the project list. Nothing is deleted."}
          onPress={() => { mutate("project.update", { id: projectId, archived: !project.archived_at }); onClose(); }}
          left={<Icon name={project.archived_at ? "archive-arrow-up" : "archive"} size={28} />}
        />
        {canDelete ? (
          <SheetOption
            label="Delete project"
            sub="Deletes its tasks for everyone"
            onPress={() => confirmThen(`Delete ${project.name} and all its tasks?`, () => { mutate("project.delete", { id: projectId }); onClose(); router.replace("/projects"); })}
            left={<Icon name="delete" size={28} color={c.danger} />}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

const CATEGORY: Record<Category, string> = { todo: "Not started", doing: "In progress", done: "Finished" };
const COLUMN_COLORS: Swatch[] = ["lemon", "sky", "grape", "mint", "tangerine", "bubblegum", "tomato", "leaf"];

function ColumnsSheet({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const c = usePalette();
  const ws = useWorkspace();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<Status | null>(null);
  if (!ws) return null;
  const cols = projectStatuses(ws, projectId);
  const save = (s: Status, patch: Partial<Status>) => {
    const next = { ...s, ...patch };
    mutate("status.upsert", { id: s.id, projectId, name: next.name, color: next.color, category: next.category, position: next.position });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cols.length) return;
    const a = cols[i]!, b = cols[j]!;
    save(a, { position: b.position });
    save(b, { position: a.position });
  };
  const doneCount = cols.filter((s) => s.category === "done").length;
  return (
    <Sheet open={open} onClose={onClose} title="Columns">
      {removing ? (
        <View style={{ gap: space.sm }}>
          <T variant="bodyBold">Move the tasks in “{removing.name}” to:</T>
          {cols.filter((s) => s.id !== removing.id).map((s) => (
            <SheetOption key={s.id} label={s.name} onPress={() => { mutate("status.delete", { id: removing.id, moveTo: s.id }); setRemoving(null); }} />
          ))}
          <Button title="Keep the column" kind="ghost" onPress={() => setRemoving(null)} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          {cols.sort(byPosition).map((s, i) => (
            <Chunky key={s.id} depth={3} r={radius.md} innerStyle={{ padding: space.md, gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Pressable accessibilityRole="button"
                  accessibilityLabel={`Change colour of ${s.name}`}
                  onPress={() => save(s, { color: COLUMN_COLORS[(COLUMN_COLORS.indexOf(s.color) + 1) % COLUMN_COLORS.length]! })}
                  style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: swatches[s.color], borderWidth: stroke, borderColor: c.outline }}
                />
                <View style={{ flex: 1 }}>
                  <Field
                    label={`Column ${i + 1}`}
                    value={draft[s.id] ?? s.name}
                    onChangeText={(v) => setDraft((d) => ({ ...d, [s.id]: v }))}
                    onBlur={() => { const v = (draft[s.id] ?? s.name).trim(); if (v && v !== s.name) save(s, { name: v }); }}
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                {(Object.keys(CATEGORY) as Category[]).map((cat) => (
                  <Pill key={cat} label={CATEGORY[cat]} color={cat === "done" ? "mint" : cat === "doing" ? "sky" : "lemon"} solid={s.category === cat} onPress={() => (s.category === "done" && doneCount === 1 && cat !== "done" ? undefined : save(s, { category: cat }))} />
                ))}
                <View style={{ flex: 1 }} />
                <Pressable accessibilityRole="button" accessibilityLabel="Move left" onPress={() => move(i, -1)} hitSlop={6}><Icon name="arrow-left-bold" size={20} color={c.muted} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Move right" onPress={() => move(i, 1)} hitSlop={6}><Icon name="arrow-right-bold" size={20} color={c.muted} /></Pressable>
                {cols.length > 1 && !(s.category === "done" && doneCount === 1) ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${s.name}`} onPress={() => setRemoving(s)} hitSlop={6}><Icon name="trash-can-outline" size={20} color={c.danger} /></Pressable>
                ) : null}
              </View>
            </Chunky>
          ))}
          <Button
            title="Add a column"
            icon="plus"
            kind="plain"
            onPress={() => {
              const last = cols.filter((s) => s.category !== "done").pop();
              mutate("status.upsert", { id: newId(), projectId, name: "New column", color: "bubblegum", category: "doing", position: between(last?.position, cols.find((s) => s.category === "done")?.position) });
            }}
          />
          <T variant="small">Tasks in a “Finished” column count as done. Every project keeps at least one.</T>
        </View>
      )}
    </Sheet>
  );
}
