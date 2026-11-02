import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadNotifications, markAllRead, switchWorkspace, useStore, useWorkspace } from "../../data/store.ts";
import type { Activity, Notification, WorkspaceData } from "../../data/types.ts";
import { Avatar, Button, Chunky, Empty, Icon, Segmented, T, type IconName } from "../../ui/kit.tsx";
import { whenText } from "../../ui/parts.tsx";
import { radius, space, stroke, swatches, usePalette, type Swatch } from "../../ui/theme.ts";

const KIND: Record<Notification["kind"], { icon: IconName; color: Swatch }> = {
  assigned: { icon: "account-arrow-right", color: "tangerine" },
  comment: { icon: "comment-text", color: "sky" },
  mention: { icon: "at", color: "grape" },
  completed: { icon: "check-bold", color: "mint" },
};

export default function Inbox() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const ws = useWorkspace();
  const notifications = useStore((s) => s.notifications);
  const unread = useStore((s) => s.unread);
  const currentId = useStore((s) => s.currentId);
  const [tab, setTab] = useState<"you" | "team">("you");
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void loadNotifications().catch(() => {});
    }, []),
  );

  const refresh = async () => {
    setRefreshing(true);
    await loadNotifications().catch(() => {});
    setRefreshing(false);
  };

  const open = async (n: Notification) => {
    if (n.task_deleted) return;
    if (n.workspace_id !== currentId) await switchWorkspace(n.workspace_id);
    router.push(`/task/${n.task_id}`);
  };

  const header = (
    <View style={{ gap: space.lg, paddingBottom: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T variant="hero">Inbox</T>
        {tab === "you" && unread ? <Button title="Mark all read" kind="plain" small onPress={() => void markAllRead()} testID="mark-read" /> : null}
      </View>
      <Segmented options={[{ value: "you", label: unread ? `For you · ${unread}` : "For you", icon: "bell" }, { value: "team", label: "Team activity", icon: "lightning-bolt" }]} value={tab} onChange={setTab} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {tab === "you" ? (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, paddingBottom: 150, gap: space.md }}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          ListEmptyComponent={<Empty emoji="📭" title="All quiet" body="When someone assigns you a task, comments on yours, or @mentions you, it lands here." />}
          renderItem={({ item: n }) => {
            const k = KIND[n.kind];
            return (
              <Chunky testID={`note-${n.kind}`} onPress={() => void open(n)} depth={3} r={radius.md} fill={n.read_at ? undefined : c.dark ? c.raised : "#FFFDF3"} innerStyle={{ flexDirection: "row", gap: space.md, padding: space.md, alignItems: "flex-start" }}>
                <View>
                  <Avatar name={n.actor_name} color={n.actor_color} size={40} />
                  <View style={{ position: "absolute", right: -6, bottom: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: swatches[k.color], borderWidth: stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}>
                    <Icon name={k.icon} size={12} color="#1B1530" />
                  </View>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <T variant={n.read_at ? "body" : "bodyBold"}>{n.text}</T>
                  <T variant="small">{whenText(n.created_at)}{n.task_deleted ? " · task deleted" : ""}</T>
                </View>
                {!n.read_at ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: swatches.tomato, borderWidth: 1.5, borderColor: c.outline, marginTop: 4 }} /> : null}
              </Chunky>
            );
          }}
        />
      ) : (
        <FlatList
          data={ws?.activity ?? []}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, paddingBottom: 150, gap: space.sm }}
          ListHeaderComponent={header}
          ListEmptyComponent={<Empty emoji="⚡️" title="Nothing yet" body="Everything your team does in this workspace shows up here." />}
          renderItem={({ item: a }) => (ws ? <ActivityRow a={a} ws={ws} /> : null)}
        />
      )}
    </View>
  );
}

function ActivityRow({ a, ws }: { a: Activity; ws: WorkspaceData }) {
  const actor = ws.members[a.actor_id];
  const title = typeof a.data.title === "string" ? `“${a.data.title}”` : "a task";
  const status = typeof a.data.statusId === "string" ? ws.statuses[a.data.statusId]?.name : undefined;
  const who = typeof a.data.assigneeId === "string" ? ws.members[a.data.assigneeId]?.name.split(" ")[0] : null;
  const project = a.project_id ? ws.projects[a.project_id]?.name : undefined;
  const name = actor?.name.split(" ")[0] ?? "Someone";
  const text: Record<string, string> = {
    "task.created": `${name} added ${title}`,
    "task.completed": `${name} finished ${title}`,
    "task.moved": `${name} moved ${title}${status ? ` to ${status}` : ""}`,
    "task.assigned": who ? `${name} gave ${title} to ${who}` : `${name} unassigned ${title}`,
    "task.deleted": `${name} deleted ${title}`,
    "comment.created": `${name} commented on ${title}`,
    "project.created": `${name} started ${typeof a.data.name === "string" ? a.data.name : "a project"}`,
    "project.archived": `${name} archived ${project ?? "a project"}`,
    "project.restored": `${name} restored ${project ?? "a project"}`,
    "project.deleted": `${name} deleted ${typeof a.data.name === "string" ? a.data.name : "a project"}`,
    "member.joined": `${name} joined the workspace 🎉`,
    "member.left": `${name} left the workspace`,
    "member.removed": `${name} removed someone from the workspace`,
  };
  const canOpen = a.task_id && ws.tasks[a.task_id];
  return (
    <Pressable disabled={!canOpen} onPress={() => router.push(`/task/${a.task_id}`)} style={{ flexDirection: "row", gap: space.md, alignItems: "center", paddingVertical: space.sm }}>
      <Avatar name={actor?.name ?? "?"} color={actor?.color ?? "sky"} size={34} />
      <View style={{ flex: 1 }}>
        <T>{text[a.kind] ?? `${name} made a change`}</T>
        <T variant="small">{whenText(a.created_at)}{project && a.kind.startsWith("task") ? ` · ${project}` : ""}</T>
      </View>
    </Pressable>
  );
}
