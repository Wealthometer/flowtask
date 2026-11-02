import { router } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useStore } from "../../data/store.ts";
import { TabBar } from "../../ui/TabBar.tsx";
import { usePalette } from "../../ui/theme.ts";

export default function TabsLayout() {
  const c = usePalette();
  const unread = useStore((s) => s.unread);
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}
      tabBar={(props) => (
        <TabBar
          active={props.state.routes[props.state.index]?.name ?? "home"}
          onSelect={(k) => {
            const route = props.state.routes.find((r) => r.name === k);
            if (route) props.navigateToTab(route.key);
          }}
          onAdd={() => router.push("/new-task")}
          badge={unread}
        />
      )}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="projects" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}
