import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { myFocus, toggleTarget, upcoming } from "../../data/model.ts";
import { mutate, switchWorkspace, useStore, useWorkspace } from "../../data/store.ts";
import type { Task } from "../../data/types.ts";
import { Avatar, Button, Chunky, Empty, Icon, T } from "../../ui/kit.tsx";
import { NetPill, ProjectTile, Sheet, SheetOption, TaskRow } from "../../ui/parts.tsx";
import { font, radius, space, stroke, swatches, usePalette } from "../../ui/theme.ts";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Morning" : h < 18 ? "Hey" : "Evening";
}

export default function Home() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const ws = useWorkspace();
  const user = useStore((s) => s.user);
  const workspaces = useStore((s) => s.workspaces);
  const [switcher, setSwitcher] = useState(false);
  // Keep ticked rows on screen until the person leaves, so the tick has somewhere to land.
  const [justDone, setJustDone] = useState<Set<string>>(new Set());

  const focus = useMemo(() => {
    if (!ws || !user) return [];
    const open = myFocus(ws, user.id);
    const kept = [...justDone].map((id) => ws.tasks[id]).filter((t): t is Task => !!t && !open.includes(t));
    return [...open, ...kept];
  }, [ws, user, justDone]);
  const next = useMemo(() => (ws && user ? upcoming(ws, user.id).slice(0, 5) : []), [ws, user]);
  const projects = useMemo(() => (ws ? Object.values(ws.projects).filter((p) => !p.archived_at).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)) : []), [ws]);

  if (!ws || !user) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const left = focus.filter((t) => !t.completed_at).length;
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const toggle = (t: Task) => {
    const target = toggleTarget(ws, t);
    if (!target) return;
    if (!t.completed_at) setJustDone((s) => new Set(s).add(t.id));
    mutate("task.update", { id: t.id, statusId: target });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: 150 }}>
        <View style={{ paddingHorizontal: space.xl, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
            <Pressable onPress={() => setSwitcher(true)} accessibilityRole="button" accessibilityLabel="Switch workspace" style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
              <T variant="label" numberOfLines={1}>{ws.name || "Workspace"}</T>
              <Icon name="chevron-down" size={18} color={c.muted} />
            </Pressable>
            <Pressable onPress={() => router.navigate("/me")} accessibilityLabel="Your profile">
              <Avatar name={user.name} color={user.color} size={42} />
            </Pressable>
          </View>
          <NetPill />
          <T variant="hero">{greeting()}, {user.name.split(" ")[0]} 👋</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {left ? (
              <>
                <T variant="title" style={{ fontFamily: font.displayMedium }}>You've got</T>
                <View testID="focus-count" style={{ backgroundColor: swatches.lemon, borderWidth: stroke, borderColor: c.outline, borderRadius: 12, paddingHorizontal: 10, transform: [{ rotate: "-2deg" }] }}>
                  <T variant="title" color="#1B1530">{left} {left === 1 ? "task" : "tasks"}</T>
                </View>
                <T variant="title" style={{ fontFamily: font.displayMedium }}>on the go</T>
              </>
            ) : (
              <>
                <T variant="title" style={{ fontFamily: font.displayMedium }}>Nothing urgent.</T>
                <View style={{ backgroundColor: swatches.mint, borderWidth: stroke, borderColor: c.outline, borderRadius: 12, paddingHorizontal: 10, transform: [{ rotate: "2deg" }] }}>
                  <T variant="title" color="#1B1530">Nice.</T>
                </View>
              </>
            )}
          </View>
          <T variant="small">{date}</T>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, marginTop: space.xxl, marginBottom: space.md }}>
          <T variant="h2">Projects</T>
          <Pressable onPress={() => router.navigate("/projects")} accessibilityRole="link">
            <T variant="small" color={c.text} style={{ textDecorationLine: "underline", fontFamily: font.bodyBold }}>See all</T>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.md, paddingVertical: 6 }}>
          {projects.map((p, i) => <ProjectTile key={p.id} project={p} ws={ws} tilt={i % 2 ? 1.2 : -1.2} />)}
          <Chunky onPress={() => router.push("/project/new")} testID="new-project-tile" innerStyle={{ width: 150, minHeight: 168, alignItems: "center", justifyContent: "center", gap: space.sm, borderStyle: "dashed" }}>
            <Icon name="plus-circle" size={36} />
            <T variant="bodyBold">New project</T>
          </Chunky>
        </ScrollView>

        <View style={{ paddingHorizontal: space.xl, marginTop: space.xxl, gap: space.md }}>
          <T variant="h2">Your focus</T>
          {focus.map((t) => <TaskRow key={t.id} task={t} ws={ws} onToggle={() => toggle(t)} />)}
          {focus.length === 0 ? (
            <Chunky fill={swatches.mint} innerStyle={{ padding: space.lg, alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 40 }}>🎉</Text>
              <T variant="h3" color="#1B1530">Nothing due or in progress</T>
              <T variant="small" color="#1B1530">Tasks assigned to you that are due today, late, or being worked on show up here.</T>
            </Chunky>
          ) : null}
        </View>

        {next.length ? (
          <View style={{ paddingHorizontal: space.xl, marginTop: space.xxl, gap: space.md }}>
            <T variant="h2">Coming up</T>
            {next.map((t) => <TaskRow key={t.id} task={t} ws={ws} onToggle={() => toggle(t)} />)}
          </View>
        ) : null}

        {projects.length === 0 ? (
          <Empty emoji="🚀" title="Start your first project" body="Projects hold your tasks on a board, with columns your team can shape." action={<Button title="New project" icon="plus" onPress={() => router.push("/project/new")} />} />
        ) : null}
      </ScrollView>

      <Sheet open={switcher} onClose={() => setSwitcher(false)} title="Workspaces">
        {workspaces.map((w) => (
          <SheetOption
            key={w.id}
            label={w.name}
            sub={`${w.member_count} ${w.member_count === 1 ? "person" : "people"} · ${w.role}`}
            selected={w.id === ws.id}
            onPress={() => {
              setSwitcher(false);
              void switchWorkspace(w.id);
            }}
            left={<View style={{ width: 34, height: 34, borderRadius: radius.sm, backgroundColor: swatches.grape, borderWidth: stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: font.display, color: "#FFFFFF" }}>{w.name.slice(0, 1).toUpperCase()}</Text></View>}
          />
        ))}
        <SheetOption label="Join or start another" onPress={() => { setSwitcher(false); router.push("/join"); }} left={<Icon name="plus-circle-outline" size={34} />} />
      </Sheet>
    </View>
  );
}
