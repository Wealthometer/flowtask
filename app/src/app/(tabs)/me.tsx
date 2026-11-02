import { useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { changePassword, deleteAccount, logOut, toast, updateProfile, useStore, useWorkspace } from "../../data/store.ts";
import type { Swatch } from "../../data/types.ts";
import { Avatar, AvatarStack, Button, Chunky, Field, Icon, T } from "../../ui/kit.tsx";
import { Sheet, SwatchPicker } from "../../ui/parts.tsx";
import { font, onSwatch, radius, space, swatches, usePalette } from "../../ui/theme.ts";

function confirm(title: string, message: string, action: string, run: () => void) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: action, style: "destructive", onPress: run }]);
}

export default function Me() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const user = useStore((s) => s.user);
  const server = useStore((s) => s.server);
  const pending = useStore((s) => s.outbox.filter((m) => !m.sent).length);
  const workspaces = useStore((s) => s.workspaces);
  const ws = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [color, setColor] = useState<Swatch>(user?.color ?? "tangerine");
  const [pw, setPw] = useState<null | { current: string; next: string; error?: string; field?: string }>(null);
  const [del, setDel] = useState<null | { password: string; error?: string }>(null);
  if (!user) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const role = workspaces.find((w) => w.id === ws?.id)?.role;
  const members = ws ? Object.values(ws.members) : [];

  const saveProfile = async () => {
    try {
      await updateProfile({ name, color });
      setEditing(false);
      toast("Profile saved", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, paddingBottom: 150, gap: space.xl }}>
      <T variant="hero">Me</T>

      <Chunky fill={swatches[user.color]} innerStyle={{ padding: space.lg, alignItems: "center", gap: space.sm }}>
        <View style={{ transform: [{ rotate: "-4deg" }] }}>
          <Avatar name={user.name} color="lemon" size={84} />
        </View>
        <Text style={{ fontFamily: font.display, fontSize: 28, color: onSwatch[user.color] }}>{user.name}</Text>
        <Text style={{ fontFamily: font.bodyMedium, fontSize: 15, color: onSwatch[user.color] }}>{user.email}</Text>
        <Button title="Edit profile" kind="plain" small icon="pencil" onPress={() => { setName(user.name); setColor(user.color); setEditing(true); }} testID="edit-profile" />
      </Chunky>

      {ws ? (
        <Chunky onPress={() => router.push("/team")} testID="team" innerStyle={{ padding: space.lg, gap: space.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T variant="label">Workspace</T>
              <T variant="h2">{ws.name}</T>
              <T variant="small">You're {role === "owner" ? "an owner" : role === "admin" ? "an admin" : "a member"} · {members.length} {members.length === 1 ? "person" : "people"}</T>
            </View>
            <Icon name="chevron-right" size={28} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AvatarStack people={members} size={32} max={6} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: swatches.lemon, borderRadius: radius.pill, borderWidth: 2, borderColor: "#1B1530", paddingHorizontal: 12, paddingVertical: 6 }}>
              <Icon name="account-plus" size={16} color="#1B1530" />
              <T variant="small" color="#1B1530" style={{ fontFamily: font.bodyBold }}>Invite</T>
            </View>
          </View>
        </Chunky>
      ) : null}

      <View style={{ gap: space.md }}>
        <T variant="h3">Account</T>
        <Button title="Change password" kind="plain" icon="lock-reset" onPress={() => setPw({ current: "", next: "" })} />
        <Button
          title="Log out"
          kind="plain"
          icon="logout"
          testID="logout"
          onPress={() =>
            pending
              ? confirm("Log out with unsynced changes?", `${pending} change${pending === 1 ? " hasn't" : "s haven't"} reached the server yet and will be lost.`, "Log out", () => void logOut())
              : void logOut()
          }
        />
        <Button title="Delete my account" kind="ghost" icon="delete-outline" onPress={() => setDel({ password: "" })} />
      </View>

      <T variant="small" style={{ textAlign: "center" }}>
        FlowTask {Constants.expoConfig?.version} · {server.replace(/^https?:\/\//, "")}
      </T>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Your profile">
        <View style={{ gap: space.lg }}>
          <View style={{ alignItems: "center" }}>
            <Avatar name={name || user.name} color={color} size={72} />
          </View>
          <Field label="Name" value={name} onChangeText={setName} testID="profile-name" />
          <T variant="small" style={{ fontWeight: "700" }}>Your colour</T>
          <SwatchPicker value={color} onChange={setColor} />
          <Button title="Save" onPress={() => void saveProfile()} testID="save-profile" />
        </View>
      </Sheet>

      <Sheet open={!!pw} onClose={() => setPw(null)} title="Change password">
        {pw ? (
          <View style={{ gap: space.lg }}>
            <Field label="Current password" secureTextEntry value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} error={pw.field === "current" ? pw.error : undefined} />
            <Field label="New password" secureTextEntry value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} hint="At least 8 characters. Your other devices will be signed out." error={pw.field === "next" ? pw.error : undefined} />
            {pw.error && !pw.field ? <T color={c.danger}>{pw.error}</T> : null}
            <Button
              title="Change password"
              onPress={() =>
                void changePassword(pw.current, pw.next)
                  .then(() => {
                    setPw(null);
                    toast("Password changed", "ok");
                  })
                  .catch((e: { message: string; field?: string }) => setPw({ ...pw, error: e.message, field: e.field }))
              }
            />
          </View>
        ) : null}
      </Sheet>

      <Sheet open={!!del} onClose={() => setDel(null)} title="Delete account">
        {del ? (
          <View style={{ gap: space.lg }}>
            <T>This removes you from every workspace and deletes workspaces where you're the only person. Tasks and comments you left in shared workspaces stay, credited to "Deleted user". This can't be undone.</T>
            <Field label="Type your password to confirm" secureTextEntry value={del.password} onChangeText={(v) => setDel({ password: v })} error={del.error} />
            <Button title="Delete my account" kind="danger" onPress={() => void deleteAccount(del.password).catch((e: Error) => setDel({ ...del, error: e.message }))} />
          </View>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
