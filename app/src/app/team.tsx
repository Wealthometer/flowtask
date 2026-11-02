import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Share, Text, View } from "react-native";
import { router } from "expo-router";
import {
  createInvite, deleteWorkspace, listInvites, removeMember, renameWorkspace, revokeInvite, setRole, toast, useStore, useWorkspace,
} from "../data/store.ts";
import type { Member, Role } from "../data/types.ts";
import { Avatar, Button, Chunky, Field, Icon, Pill, T } from "../ui/kit.tsx";
import { Page, Sheet, SheetOption, TopBar } from "../ui/parts.tsx";
import { font, radius, space, stroke, swatches, usePalette } from "../ui/theme.ts";

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function confirm(title: string, message: string, action: string, run: () => void) {
  if (Platform.OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: action, style: "destructive", onPress: run }]);
}

export default function Team() {
  const c = usePalette();
  const ws = useWorkspace();
  const me = useStore((s) => s.user);
  const myRole = useStore((s) => s.workspaces.find((w) => w.id === s.currentId)?.role ?? "member");
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [active, setActive] = useState<Awaited<ReturnType<typeof listInvites>>["invites"]>([]);
  const [picked, setPicked] = useState<Member | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const isAdmin = myRole !== "member";

  const loadInvites = useCallback(() => {
    if (ws && isAdmin) void listInvites(ws.id).then((r) => setActive(r.invites)).catch(() => {});
  }, [ws, isAdmin]);
  useEffect(loadInvites, [loadInvites]);

  if (!ws || !me) return <Page><TopBar /></Page>;
  const members = Object.values(ws.members).sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));

  const makeInvite = async () => {
    try {
      const r = await createInvite(ws.id);
      setInvite(r.invite);
      loadInvites();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const share = (code: string) =>
    void Share.share({ message: `Join ${ws.name} on FlowTask! Open the app and enter invite code ${code}, or tap flowtask://join?code=${code}` });

  const act = (fn: () => Promise<unknown>, after?: () => void) =>
    void fn()
      .then(() => after?.())
      .catch((e: Error) => toast(e.message));

  return (
    <Page>
      <TopBar title="Team" />

      <View style={{ gap: space.sm }}>
        <T variant="label">Workspace</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <T variant="title" style={{ flex: 1 }}>{ws.name}</T>
          {isAdmin ? <Button title="Rename" kind="plain" small onPress={() => setRename(ws.name)} /> : null}
        </View>
      </View>

      <Chunky fill={swatches.lemon} innerStyle={{ padding: space.lg, gap: space.md }}>
        <T variant="h2" color="#1B1530">Bring people in</T>
        {invite ? (
          <>
            <T color="#1B1530">Share this code. It works for 7 days, up to 20 people.</T>
            <View style={{ backgroundColor: "#FFFFFF", borderWidth: stroke, borderColor: "#1B1530", borderRadius: radius.md, padding: space.md, alignItems: "center", transform: [{ rotate: "-1deg" }] }}>
              <Text testID="invite-code-value" selectable style={{ fontFamily: font.display, fontSize: 32, letterSpacing: 4, color: "#1B1530" }}>{invite.code}</Text>
            </View>
            <Button title="Share invite" icon="share-variant" color="grape" onPress={() => share(invite.code)} />
          </>
        ) : (
          <>
            <T color="#1B1530">Make an invite code and send it however you like: WhatsApp, email, a sticky note.</T>
            <Button title="Make an invite code" icon="ticket-confirmation" color="grape" onPress={() => void makeInvite()} testID="make-invite" />
          </>
        )}
      </Chunky>

      <View style={{ gap: space.md }}>
        <T variant="h3">{members.length} {members.length === 1 ? "person" : "people"}</T>
        {members.map((m) => (
          <Chunky key={m.id} depth={3} r={radius.md} onPress={isAdmin || m.id === me.id ? () => setPicked(m) : undefined} innerStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
            <Avatar name={m.name} color={m.color} size={40} />
            <View style={{ flex: 1 }}>
              <T variant="bodyBold">{m.name}{m.id === me.id ? " (you)" : ""}</T>
              <T variant="small" numberOfLines={1}>{m.email}</T>
            </View>
            <Pill label={ROLE_LABEL[m.role]} color={m.role === "owner" ? "tangerine" : m.role === "admin" ? "grape" : "sky"} solid={m.role !== "member"} />
          </Chunky>
        ))}
      </View>

      {isAdmin && active.length ? (
        <View style={{ gap: space.sm }}>
          <T variant="h3">Open invites</T>
          {active.map((i) => (
            <View key={i.code} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Icon name="ticket-outline" />
              <View style={{ flex: 1 }}>
                <T variant="bodyBold">{i.code}</T>
                <T variant="small">by {i.created_by_name} · used {i.uses}/{i.max_uses} · until {new Date(i.expires_at).toLocaleDateString()}</T>
              </View>
              <Button title="Revoke" kind="ghost" small onPress={() => act(() => revokeInvite(ws.id, i.code), loadInvites)} />
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Button title="Leave workspace" kind="plain" icon="exit-run" onPress={() => confirm("Leave this workspace?", "Your tasks here will be unassigned. Someone will need to invite you back.", "Leave", () => act(() => removeMember(ws.id, me.id), () => router.replace("/home")))} />
        {myRole === "owner" ? (
          <Button title="Delete workspace" kind="danger" icon="delete-forever" onPress={() => confirm(`Delete ${ws.name}?`, "Every project, task and comment in it is deleted for everyone. This can't be undone.", "Delete", () => act(() => deleteWorkspace(ws.id), () => router.replace("/home")))} />
        ) : null}
      </View>

      <Sheet open={!!picked} onClose={() => setPicked(null)} title={picked?.name ?? ""}>
        {picked ? (
          <>
            {isAdmin
              ? (["member", "admin", "owner"] as Role[])
                  .filter((r) => r !== "owner" || myRole === "owner")
                  .map((r) => (
                    <SheetOption
                      key={r}
                      label={ROLE_LABEL[r]}
                      sub={r === "owner" ? "Everything, including deleting the workspace" : r === "admin" ? "Manage people, invites and any project" : "Work on projects and tasks"}
                      selected={picked.role === r}
                      onPress={() => act(() => setRole(ws.id, picked.id, r), () => setPicked(null))}
                    />
                  ))
              : null}
            {picked.id !== me.id && isAdmin ? (
              <SheetOption label={`Remove ${picked.name.split(" ")[0]}`} sub="Their open tasks become unassigned" onPress={() => confirm(`Remove ${picked.name}?`, "They lose access straight away.", "Remove", () => act(() => removeMember(ws.id, picked.id), () => setPicked(null)))} left={<Icon name="account-remove" color={c.danger} />} />
            ) : null}
            {!isAdmin ? <T variant="muted">Only owners and admins can change roles.</T> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet open={rename !== null} onClose={() => setRename(null)} title="Rename workspace">
        <View style={{ gap: space.lg }}>
          <Field label="Name" value={rename ?? ""} onChangeText={setRename} />
          <Button title="Save" onPress={() => act(() => renameWorkspace(ws.id, rename ?? ""), () => setRename(null))} />
        </View>
      </Sheet>
    </Page>
  );
}
