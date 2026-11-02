import { useEffect } from "react";
import { Platform, View } from "react-native";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from "@expo-google-fonts/bricolage-grotesque";
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { boot, switchWorkspace, useStore } from "../data/store.ts";
import { configureNotifications } from "../lib/push.ts";
import { ToastHost } from "../ui/parts.tsx";
import { usePalette } from "../ui/theme.ts";

configureNotifications();

const PUBLIC = new Set(["welcome"]);

export default function RootLayout() {
  const c = usePalette();
  const [fonts] = useFonts({ BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });
  const ready = useStore((s) => s.ready);
  const signedIn = useStore((s) => !!s.token);
  const hasWorkspace = useStore((s) => s.workspaces.length > 0);
  const known = useStore((s) => s.workspacesKnown);
  const segments = useSegments();

  useEffect(() => {
    void boot();
  }, []);

  // Send people to the right place: sign in first, then make or join a workspace.
  useEffect(() => {
    if (!ready || !fonts) return;
    if (signedIn && !known) return; // still finding out which workspaces this person has
    const first = segments[0] ?? "";
    if (!signedIn && !PUBLIC.has(first)) router.replace("/welcome");
    else if (signedIn && !hasWorkspace && first !== "onboarding" && first !== "join") router.replace("/onboarding");
    else if (signedIn && hasWorkspace && (PUBLIC.has(first) || first === "onboarding" || first === "")) router.replace("/home");
  }, [ready, fonts, signedIn, hasWorkspace, known, segments]);

  // Tapping a push opens the task it's about.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as { workspaceId?: string; taskId?: string };
      if (data.workspaceId && data.taskId) {
        void switchWorkspace(data.workspaceId).then(() => router.push(`/task/${data.taskId}`));
      }
    });
    return () => sub.remove();
  }, []);

  const base = c.dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, text: c.text, border: c.outline, primary: c.accent } };
  if (!fonts || !ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <StatusBar style={c.dark ? "light" : "dark"} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="new-task" options={{ presentation: "modal" }} />
          <Stack.Screen name="project/new" options={{ presentation: "modal" }} />
        </Stack>
        <ToastHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
