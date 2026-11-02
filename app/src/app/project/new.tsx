import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { nextPosition, type StatusInput } from "../../data/model.ts";
import { mutate, newId, useStore, useWorkspace } from "../../data/store.ts";
import type { Category } from "../../data/types.ts";
import { Button, Chunky, Field, Icon, T, tap, type IconName } from "../../ui/kit.tsx";
import { Page, PROJECT_ICONS, SwatchPicker, TopBar } from "../../ui/parts.tsx";
import { font, onSwatch, radius, space, stroke, swatches, usePalette, type Swatch } from "../../ui/theme.ts";

const TEMPLATES: { key: string; label: string; emoji: string; columns: [string, Swatch, Category][] }[] = [
  { key: "simple", label: "Simple", emoji: "✅", columns: [["To do", "lemon", "todo"], ["Doing", "sky", "doing"], ["Done", "mint", "done"]] },
  { key: "team", label: "Team", emoji: "🤝", columns: [["To do", "lemon", "todo"], ["Doing", "sky", "doing"], ["Review", "grape", "doing"], ["Done", "mint", "done"]] },
  { key: "content", label: "Content", emoji: "✍️", columns: [["Ideas", "bubblegum", "todo"], ["Writing", "sky", "doing"], ["Editing", "grape", "doing"], ["Published", "mint", "done"]] },
  { key: "bugs", label: "Bugs", emoji: "🐛", columns: [["Reported", "tomato", "todo"], ["Fixing", "tangerine", "doing"], ["Testing", "grape", "doing"], ["Fixed", "mint", "done"]] },
];

export default function NewProject() {
  const c = usePalette();
  const ws = useWorkspace();
  const workspaceId = useStore((s) => s.currentId);
  const [name, setName] = useState("");
  const [color, setColor] = useState<Swatch>("grape");
  const [icon, setIcon] = useState<IconName>("rocket-launch");
  const [template, setTemplate] = useState("team");
  const [error, setError] = useState<string | undefined>();

  const create = () => {
    if (!name.trim()) return setError("Give the project a name");
    if (!ws || !workspaceId) return;
    const id = newId();
    const statuses: StatusInput[] = TEMPLATES.find((t) => t.key === template)!.columns.map(([n, col, category], i) => ({ id: newId(), name: n, color: col, category, position: i }));
    mutate("project.create", { id, workspaceId, name: name.trim(), color, icon, position: nextPosition(Object.values(ws.projects)), statuses });
    router.replace(`/project/${id}`);
  };

  return (
    <Page footer={<Button title="Create project" icon="rocket-launch" color={color} onPress={create} testID="create-project" />}>
      <TopBar title="New project" />

      {/* Live preview of the tile */}
      <Chunky fill={swatches[color]} style={{ alignSelf: "center", transform: [{ rotate: "-2deg" }] }} innerStyle={{ width: 230, padding: space.lg, gap: space.md }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.88)", borderWidth: stroke, borderColor: "#1B1530", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={28} color="#1B1530" />
        </View>
        <Text style={{ fontFamily: font.display, fontSize: 24, lineHeight: 26, color: onSwatch[color] }} numberOfLines={2}>{name.trim() || "Your project"}</Text>
      </Chunky>

      <Field label="Name" value={name} onChangeText={(v) => { setName(v); setError(undefined); }} placeholder="e.g. Website relaunch" error={error} autoFocus testID="project-name" />

      <View style={{ gap: space.sm }}>
        <T variant="label">Colour</T>
        <SwatchPicker value={color} onChange={setColor} />
      </View>

      <View style={{ gap: space.sm }}>
        <T variant="label">Icon</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {PROJECT_ICONS.map((i) => (
            <Pressable
              key={i}
              accessibilityRole="radio"
              accessibilityLabel={i}
              accessibilityState={{ selected: icon === i }}
              onPress={() => { tap(); setIcon(i); }}
              style={{ width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: stroke, borderColor: icon === i ? c.outline : "transparent", backgroundColor: icon === i ? swatches[color] : c.surface }}
            >
              <Icon name={i} size={24} color={icon === i ? onSwatch[color] : c.text} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <T variant="label">Workflow</T>
        {TEMPLATES.map((t) => {
          const on = template === t.key;
          return (
            <Chunky key={t.key} onPress={() => setTemplate(t.key)} depth={on ? 4 : 2} r={radius.md} fill={on ? swatches.lemon : undefined} testID={`template-${t.key}`} innerStyle={{ padding: space.md, gap: space.sm }}>
              <T variant="bodyBold" color={on ? "#1B1530" : undefined}>{t.emoji}  {t.label}</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {t.columns.map(([n, col]) => (
                  <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: swatches[col], borderWidth: 1.5, borderColor: "#1B1530" }} />
                    <T variant="small" color={on ? "#1B1530" : undefined}>{n}</T>
                  </View>
                ))}
              </View>
            </Chunky>
          );
        })}
        <T variant="small">You can rename, recolour, add and remove columns later.</T>
      </View>
    </Page>
  );
}
