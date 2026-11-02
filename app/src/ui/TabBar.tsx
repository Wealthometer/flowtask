import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, tap, type IconName } from "./kit.tsx";
import { lift, stroke, swatches, usePalette } from "./theme.ts";

export type TabKey = "home" | "projects" | "inbox" | "me";

const TABS: { key: TabKey; icon: IconName; label: string }[] = [
  { key: "home", icon: "home-variant", label: "Home" },
  { key: "projects", icon: "view-grid", label: "Projects" },
  { key: "inbox", icon: "bell", label: "Inbox" },
  { key: "me", icon: "account-circle", label: "Me" },
];

/** A floating ink pill with a big tangerine "+" in the middle. */
export function TabBar({ active, onSelect, onAdd, badge }: { active: string; onSelect: (k: TabKey) => void; onAdd: () => void; badge?: number }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const bar = c.dark ? "#F6EBDD" : "#1B1530";
  const off = c.dark ? "#1B1530" : "#FFF6EA";
  const item = (t: (typeof TABS)[number]) => {
    const on = t.key === active;
    return (
      <Pressable
        key={t.key}
        accessibilityRole="tab"
        accessibilityLabel={t.label}
        testID={`tab-${t.key}`}
        accessibilityState={{ selected: on }}
        onPress={() => {
          tap();
          onSelect(t.key);
        }}
        style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: on ? swatches.lemon : "transparent" }}
      >
        <Icon name={t.icon} size={26} color={on ? "#1B1530" : off} />
        {t.key === "inbox" && badge ? (
          <View style={{ position: "absolute", top: 8, right: 8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: swatches.tomato, borderWidth: 2, borderColor: bar }} />
        ) : null}
      </Pressable>
    );
  };
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 14, alignItems: "center" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 7, borderRadius: 40, backgroundColor: bar }}>
        {TABS.slice(0, 2).map(item)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New task"
          testID="new-task"
          onPress={() => {
            tap();
            onAdd();
          }}
          style={({ pressed }) => ({
            width: 62,
            height: 62,
            marginHorizontal: 4,
            borderRadius: 31,
            backgroundColor: swatches.tangerine,
            borderWidth: stroke + 1,
            borderColor: off,
            alignItems: "center",
            justifyContent: "center",
            transform: [{ translateY: pressed ? 0 : -lift.sm }, { scale: pressed ? 0.94 : 1 }],
          })}
        >
          <Icon name="plus-thick" size={32} color="#1B1530" />
        </Pressable>
        {TABS.slice(2).map(item)}
      </View>
    </View>
  );
}
