import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { addDays, dueLabel, dueState, localDate } from "../data/model.ts";
import { toast as showToast, useStore } from "../data/store.ts";
import type { Member, Priority, Project, Task, WorkspaceData } from "../data/types.ts";
import { Avatar, Check, Chunky, Icon, Pill, Progress, T, tap, type IconName } from "./kit.tsx";
import { font, lift, onSwatch, radius, space, stroke, swatches, usePalette, type Swatch } from "./theme.ts";

export const PRIORITY: Record<Priority, { label: string; color: Swatch; icon: IconName }> = {
  urgent: { label: "Urgent", color: "tomato", icon: "fire" },
  high: { label: "High", color: "tangerine", icon: "arrow-up-bold" },
  medium: { label: "Medium", color: "lemon", icon: "equal" },
  low: { label: "Low", color: "mint", icon: "arrow-down-bold" },
};

export const PROJECT_ICONS: IconName[] = [
  "rocket-launch", "palette", "cellphone", "party-popper", "bullhorn", "code-braces", "home-heart", "briefcase", "book-open-variant", "camera",
  "cart", "chart-line", "coffee", "dumbbell", "earth", "flask", "gamepad-variant", "heart", "lightbulb-on", "music",
  "pencil-ruler", "school", "star", "store", "truck", "airplane", "leaf", "food-apple", "paw", "trophy",
];

// ── Screen chrome ───────────────────────────────────────────────────────────

export function RoundButton({ icon, label, onPress, fill, testID }: { icon: IconName; label: string; onPress: () => void; fill?: string; testID?: string }) {
  return (
    <Chunky onPress={onPress} accessibilityLabel={label} testID={testID} r={22} depth={3} fill={fill} innerStyle={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={22} color={fill ? "#1B1530" : undefined} />
    </Chunky>
  );
}

export function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/home");
}

export function TopBar({ title, right, onBack = back }: { title?: string; right?: ReactNode; onBack?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 50 }}>
      <RoundButton icon="arrow-left" label="Back" onPress={onBack} testID="back" />
      <T variant="h2" style={{ flex: 1 }} numberOfLines={1}>{title ?? ""}</T>
      {right}
    </View>
  );
}

/** Scrollable page with the cream background and safe-area padding. */
export function Page({ children, footer, padTop = true, testID }: { children: ReactNode; footer?: ReactNode; padTop?: boolean; testID?: string }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} testID={testID}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: padTop ? insets.top + space.md : 0, paddingHorizontal: space.xl, paddingBottom: (footer ? 110 : insets.bottom + 40), gap: space.xl }}>
        {children}
      </ScrollView>
      {footer ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: insets.bottom + space.md, backgroundColor: c.bg, borderTopWidth: stroke, borderColor: c.outline }}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

// ── Sheets ──────────────────────────────────────────────────────────────────

/** A bottom sheet with a chunky top edge. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" style={{ flex: 1, backgroundColor: "rgba(27,21,48,0.45)" }} onPress={onClose} accessibilityLabel="Close" />
      <View style={{ backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: stroke, borderBottomWidth: 0, borderColor: c.outline, paddingTop: space.md, paddingBottom: insets.bottom + space.lg, maxHeight: "85%" }}>
        <View style={{ alignSelf: "center", width: 48, height: 5, borderRadius: 3, backgroundColor: c.muted, opacity: 0.5, marginBottom: space.md }} />
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.xl, marginBottom: space.md }}>
          <T variant="h2" style={{ flex: 1 }}>{title}</T>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
            <Icon name="close" size={26} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.md, gap: space.sm }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function SheetOption({ label, sub, selected, onPress, left, testID }: { label: string; sub?: string; selected?: boolean; onPress: () => void; left?: ReactNode; testID?: string }) {
  const c = usePalette();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: stroke,
        borderColor: selected ? c.outline : "transparent", backgroundColor: selected ? swatches.lemon : pressed ? c.raised : "transparent",
      })}
    >
      {left}
      <View style={{ flex: 1 }}>
        <T variant="bodyBold" color={selected ? "#1B1530" : undefined}>{label}</T>
        {sub ? <T variant="small" color={selected ? "#5A5270" : undefined}>{sub}</T> : null}
      </View>
      {selected ? <Icon name="check-bold" color="#1B1530" /> : null}
    </Pressable>
  );
}

export function PersonSheet({ open, onClose, members, value, onPick }: { open: boolean; onClose: () => void; members: Member[]; value: string | null; onPick: (id: string | null) => void }) {
  const me = useStore((s) => s.user?.id);
  const sorted = [...members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));
  return (
    <Sheet open={open} onClose={onClose} title="Assign to">
      <SheetOption label="Nobody" selected={value === null} onPress={() => { onPick(null); onClose(); }} left={<Icon name="account-off-outline" size={30} />} />
      {sorted.map((m) => (
        <SheetOption key={m.id} testID={`assign-${m.name}`} label={m.id === me ? `${m.name} (you)` : m.name} sub={m.email} selected={value === m.id} onPress={() => { onPick(m.id); onClose(); }} left={<Avatar name={m.name} color={m.color} size={34} />} />
      ))}
    </Sheet>
  );
}

export function PrioritySheet({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: Priority; onPick: (p: Priority) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Priority">
      {(Object.keys(PRIORITY) as Priority[]).map((p) => (
        <SheetOption key={p} label={PRIORITY[p].label} selected={value === p} onPress={() => { onPick(p); onClose(); }} left={<PriorityBadge priority={p} size={30} />} />
      ))}
    </Sheet>
  );
}

/** Quick choices plus a month grid. */
export function DueSheet({ open, onClose, value, onPick }: { open: boolean; onClose: () => void; value: string | null; onPick: (d: string | null) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Due date">
      {open ? <DueCalendar value={value} onPick={(d) => { onPick(d); onClose(); }} /> : null}
    </Sheet>
  );
}

function DueCalendar({ value, onPick }: { value: string | null; onPick: (d: string | null) => void }) {
  const c = usePalette();
  const today = localDate(new Date());
  const [month, setMonth] = useState(() => (value ?? today).slice(0, 7));
  const dow = new Date().getDay();
  const quick: [string, string | null][] = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["This weekend", addDays(today, dow === 6 ? 0 : dow === 0 ? 0 : 6 - dow)],
    ["Next week", addDays(today, ((8 - dow) % 7) || 7)],
    ["No date", null],
  ];
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const first = new Date(y, mo - 1, 1);
  const days = new Date(y, mo, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => localDate(new Date(y, mo - 1, i + 1)))];
  const shift = (n: number) => setMonth(localDate(new Date(y, mo - 1 + n, 1)).slice(0, 7));
  const pick = onPick;
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md }}>
        {quick.map(([label, d]) => (
          <Pill key={label} label={label} color={d === null ? "tomato" : "sky"} solid={value === d} onPress={() => pick(d)} testID={`due-${label}`} />
        ))}
      </View>
      <Chunky innerStyle={{ padding: space.md, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Pressable onPress={() => shift(-1)} accessibilityLabel="Previous month" hitSlop={10}><Icon name="chevron-left" size={28} /></Pressable>
          <T variant="h3" style={{ flex: 1, textAlign: "center" }}>{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</T>
          <Pressable onPress={() => shift(1)} accessibilityLabel="Next month" hitSlop={10}><Icon name="chevron-right" size={28} /></Pressable>
        </View>
        <View style={{ flexDirection: "row" }}>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <T key={i} variant="label" style={{ flex: 1, textAlign: "center" }}>{d}</T>
          ))}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {cells.map((d, i) => {
            const on = d !== null && d === value;
            const isToday = d === today;
            return (
              <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                {d ? (
                  <Pressable accessibilityRole="button"
                    accessibilityLabel={d}
                    onPress={() => pick(d)}
                    style={{ flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? swatches.tangerine : "transparent", borderWidth: isToday || on ? stroke : 0, borderColor: c.outline }}
                  >
                    <Text style={{ fontFamily: on || isToday ? font.bodyBold : font.body, fontSize: 15, color: on ? "#1B1530" : c.text, opacity: d < today && !on ? 0.4 : 1 }}>{Number(d.slice(8))}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </Chunky>
    </>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

export function PriorityBadge({ priority, size = 22 }: { priority: Priority; size?: number }) {
  const c = usePalette();
  const p = PRIORITY[priority];
  return (
    <View accessibilityLabel={`${p.label} priority`} style={{ width: size, height: size, backgroundColor: swatches[p.color], borderRadius: size * 0.32, borderWidth: 1.5, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}>
      <Icon name={p.icon} size={size * 0.62} color={onSwatch[p.color]} />
    </View>
  );
}

export function DueChip({ task }: { task: Pick<Task, "due_on" | "completed_at"> }) {
  const c = usePalette();
  if (!task.due_on) return null;
  const st = dueState(task);
  const color = st === "overdue" ? swatches.tomato : st === "today" ? (c.dark ? swatches.tangerine : "#D9480F") : c.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      <Icon name={st === "overdue" ? "alarm" : "calendar-blank"} size={15} color={color} />
      <T variant="small" color={color} style={{ fontFamily: st === "overdue" || st === "today" ? font.bodyBold : font.bodyMedium }}>{dueLabel(task.due_on)}</T>
    </View>
  );
}

/** The card on boards and lists. */
export function TaskCard({ task, ws, onLongPress, showProject }: { task: Task; ws: WorkspaceData; onLongPress?: () => void; showProject?: boolean }) {
  const c = usePalette();
  const who = task.assignee_id ? ws.members[task.assignee_id] : undefined;
  const items = Object.values(ws.checklist).filter((x) => x.task_id === task.id);
  const comments = Object.values(ws.comments).filter((x) => x.task_id === task.id).length;
  const project = ws.projects[task.project_id];
  return (
    <Chunky testID={`task-${task.title}`} onPress={() => router.push(`/task/${task.id}`)} onLongPress={onLongPress} depth={3} r={radius.md} innerStyle={{ padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <PriorityBadge priority={task.priority} />
        {showProject && project ? <Pill label={project.name} color={project.color} /> : null}
        {task.labels.map((l) => <Pill key={l} label={l} color="sky" />)}
      </View>
      <T variant="bodyBold" style={task.completed_at ? { textDecorationLine: "line-through", opacity: 0.5 } : undefined}>{task.title}</T>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        {who ? <Avatar name={who.name} color={who.color} size={26} /> : null}
        <DueChip task={task} />
        <View style={{ flex: 1 }} />
        {items.length ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Icon name="checkbox-marked-circle-outline" size={15} color={c.muted} />
            <T variant="small">{items.filter((i) => i.done).length}/{items.length}</T>
          </View>
        ) : null}
        {comments ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Icon name="comment-outline" size={15} color={c.muted} />
            <T variant="small">{comments}</T>
          </View>
        ) : null}
      </View>
    </Chunky>
  );
}

/** A row with a big checkbox, used on Home. */
export function TaskRow({ task, ws, onToggle }: { task: Task; ws: WorkspaceData; onToggle: () => void }) {
  const c = usePalette();
  const p = ws.projects[task.project_id];
  const done = !!task.completed_at;
  return (
    <Chunky testID={`row-${task.title}`} onPress={() => router.push(`/task/${task.id}`)} depth={3} r={radius.md} innerStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, paddingRight: space.lg }}>
      <Check done={done} color={p?.color ?? "mint"} label={`Done: ${task.title}`} onToggle={onToggle} />
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="bodyBold" style={done ? { textDecorationLine: "line-through", opacity: 0.45 } : undefined} numberOfLines={2}>{task.title}</T>
        {p ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: swatches[p.color], borderWidth: 1.5, borderColor: c.outline }} />
            <T variant="small" numberOfLines={1}>{p.name}</T>
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <DueChip task={task} />
        <PriorityBadge priority={task.priority} />
      </View>
    </Chunky>
  );
}

export function ProjectTile({ project, ws, tilt = 0, width = 190 }: { project: Project; ws: WorkspaceData; tilt?: number; width?: number | "auto" }) {
  const tasks = Object.values(ws.tasks).filter((t) => t.project_id === project.id);
  const done = tasks.filter((t) => t.completed_at).length;
  const people = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))].map((id) => ws.members[id!]).filter(Boolean) as Member[];
  const fg = onSwatch[project.color];
  return (
    <Chunky
      testID={`project-${project.name}`}
      fill={swatches[project.color]}
      onPress={() => router.push(`/project/${project.id}`)}
      style={[{ transform: [{ rotate: `${tilt}deg` }] }, width === "auto" ? { flex: 1 } : null]}
      innerStyle={{ width: width === "auto" ? undefined : width, padding: space.lg, gap: space.md, minHeight: 168 }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.88)", borderWidth: stroke, borderColor: "#1B1530", alignItems: "center", justifyContent: "center" }}>
          <Icon name={project.icon as IconName} size={24} color="#1B1530" />
        </View>
        <AvatarRow people={people} />
      </View>
      <Text style={{ fontFamily: font.display, fontSize: 20, lineHeight: 23, color: fg }} numberOfLines={2}>{project.name}</Text>
      <View style={{ gap: 6, marginTop: "auto" }}>
        <Progress value={tasks.length ? done / tasks.length : 0} color="lemon" onDark />
        <Text style={{ fontFamily: font.bodyBold, fontSize: 13, color: fg }}>{tasks.length ? `${done} of ${tasks.length} done` : "No tasks yet"}</Text>
      </View>
    </Chunky>
  );
}

function AvatarRow({ people }: { people: Member[] }) {
  const shown = people.slice(0, 3);
  return (
    <View style={{ flexDirection: "row" }}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i ? -8 : 0 }}>
          <Avatar name={p.name} color={p.color} size={26} />
        </View>
      ))}
    </View>
  );
}

export function SwatchPicker({ value, onChange }: { value: Swatch; onChange: (s: Swatch) => void }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
      {(Object.keys(swatches) as Swatch[]).map((s) => (
        <Pressable
          key={s}
          accessibilityRole="radio"
          accessibilityLabel={s}
          accessibilityState={{ selected: value === s }}
          onPress={() => {
            tap();
            onChange(s);
          }}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: swatches[s], borderWidth: value === s ? 4 : stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center", transform: [{ scale: value === s ? 1.1 : 1 }] }}
        >
          {value === s ? <Icon name="check-bold" size={20} color={onSwatch[s]} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

// ── Global overlays ─────────────────────────────────────────────────────────

/** Short messages (a change the server refused, a saved setting) that float at the top. */
export function ToastHost() {
  const t = useStore((s) => s.toast);
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(0);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => setDismissed(t.id), 3800);
    return () => clearTimeout(timer);
  }, [t]);
  const shown = t && t.id !== dismissed ? t : null;
  if (!shown) return null;
  const fill = shown.tone === "ok" ? swatches.mint : swatches.tomato;
  return (
    <Animated.View key={shown.id} entering={FadeInDown.springify()} exiting={FadeOutUp} pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 8, left: space.lg, right: space.lg, zIndex: 100 }}>
      <Chunky fill={fill} onPress={() => setDismissed(shown.id)} depth={lift.sm} r={radius.md} innerStyle={{ flexDirection: "row", gap: space.sm, alignItems: "center", padding: space.md }}>
        <Icon name={shown.tone === "ok" ? "check-circle" : "alert-circle"} color={shown.tone === "ok" ? "#1B1530" : "#FFFFFF"} />
        <T variant="bodyBold" color={shown.tone === "ok" ? "#1B1530" : "#FFFFFF"} style={{ flex: 1 }}>{shown.text}</T>
      </Chunky>
    </Animated.View>
  );
}

/** A small pill when offline or syncing, so people know their changes are safe. */
export function NetPill() {
  const net = useStore((s) => s.net);
  const pending = useStore((s) => s.outbox.filter((m) => !m.sent).length);
  if (net !== "offline") return null;
  return (
    <View testID="offline" accessibilityRole="text" style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: swatches.lemon, borderWidth: stroke, borderColor: "#1B1530", borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 }}>
      <Icon name="cloud-off-outline" size={16} color="#1B1530" />
      <Text style={{ fontFamily: font.bodyBold, fontSize: 13, color: "#1B1530" }}>Offline{pending ? ` · ${pending} change${pending === 1 ? "" : "s"} waiting` : ""}</Text>
    </View>
  );
}

export function useMembers(ws: WorkspaceData | null): Member[] {
  return useMemo(() => (ws ? Object.values(ws.members).sort((a, b) => a.name.localeCompare(b.name)) : []), [ws]);
}

export function whenText(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86_400) return `${Math.floor(diff / 86_400)}d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export { showToast };
