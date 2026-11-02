import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWorkspace } from "../../data/store.ts";
import { Button, Empty, Icon, T } from "../../ui/kit.tsx";
import { NetPill, ProjectTile } from "../../ui/parts.tsx";
import { space, usePalette } from "../../ui/theme.ts";

export default function Projects() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const ws = useWorkspace();
  const [showArchived, setShowArchived] = useState(false);
  const { live, archived } = useMemo(() => {
    const all = ws ? Object.values(ws.projects).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)) : [];
    return { live: all.filter((p) => !p.archived_at), archived: all.filter((p) => p.archived_at) };
  }, [ws]);
  if (!ws) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  const grid = (list: typeof live) => {
    const rows = [];
    for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
    return rows.map((row, r) => (
      <View key={r} style={{ flexDirection: "row", gap: space.md }}>
        {row.map((p, i) => <ProjectTile key={p.id} project={p} ws={ws} width="auto" tilt={(r + i) % 2 ? 1 : -1} />)}
        {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
      </View>
    ));
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, paddingBottom: 150, gap: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T variant="hero">Projects</T>
        <Button title="New" icon="plus" small onPress={() => router.push("/project/new")} testID="new-project" />
      </View>
      <NetPill />
      {live.length ? grid(live) : <Empty emoji="🗂️" title="No projects yet" body="Make one for anything with more than a couple of steps: a launch, a move, a hiring round." />}
      {archived.length ? (
        <View style={{ gap: space.md, marginTop: space.lg }}>
          <Pressable onPress={() => setShowArchived((v) => !v)} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name={showArchived ? "chevron-down" : "chevron-right"} />
            <T variant="h3">Archived ({archived.length})</T>
          </Pressable>
          {showArchived ? <View style={{ opacity: 0.75, gap: space.md }}>{grid(archived)}</View> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
