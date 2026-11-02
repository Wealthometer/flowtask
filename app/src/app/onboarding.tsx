import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { ApiError } from "../data/api.ts";
import { acceptInvite, createWorkspace, logOut, previewInvite, useStore } from "../data/store.ts";
import { Button, Chunky, Field, IconTile, T } from "../ui/kit.tsx";
import { Page } from "../ui/parts.tsx";
import { font, space, swatches, usePalette } from "../ui/theme.ts";

/** First run after signing up: start a workspace, or join one with an invite code. */
export default function Onboarding() {
  const c = usePalette();
  const user = useStore((s) => s.user);
  const [name, setName] = useState(user ? `${user.name.split(" ")[0]}'s team` : "");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewInvite>> | null>(null);

  const run = async (fn: () => Promise<unknown>, field: string) => {
    setErrors({});
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErrors({ [field]: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <View style={{ gap: space.sm, marginTop: space.lg }}>
        <Text style={{ fontSize: 44 }}>👋</Text>
        <Text style={{ fontFamily: font.display, fontSize: 38, lineHeight: 40, letterSpacing: -1.2, color: c.text }}>Welcome, {user?.name.split(" ")[0]}!</Text>
        <T variant="muted">A workspace is where your projects and people live. Start one, or hop into your team's.</T>
      </View>

      <Chunky fill={swatches.tangerine} innerStyle={{ padding: space.lg, gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <IconTile icon="plus-thick" color="lemon" />
          <T variant="h2" color="#1B1530">Start a workspace</T>
        </View>
        <Field label="Name it" value={name} onChangeText={setName} error={errors.create} testID="workspace-name" />
        <Button title="Create workspace" color="lemon" icon="arrow-right-bold" disabled={busy} onPress={() => void run(() => createWorkspace(name).then(() => router.replace("/home")), "create")} testID="create-workspace" />
      </Chunky>

      <Chunky fill={swatches.sky} innerStyle={{ padding: space.lg, gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <IconTile icon="ticket-confirmation" color="grape" />
          <T variant="h2" color="#1B1530">Got an invite code?</T>
        </View>
        <Field
          label="Invite code"
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase());
            setPreview(null);
          }}
          autoCapitalize="characters"
          placeholder="e.g. K7QM2XRP4D"
          error={errors.join}
          testID="invite-code"
        />
        {preview ? (
          <View style={{ gap: space.sm }}>
            <T variant="bodyBold" color="#1B1530">{preview.invitedBy} invited you to {preview.workspace.name} ({preview.workspace.members} {preview.workspace.members === 1 ? "person" : "people"}).</T>
            <Button title={`Join ${preview.workspace.name}`} color="grape" icon="account-plus" disabled={busy} onPress={() => void run(() => acceptInvite(code).then(() => router.replace("/home")), "join")} testID="join" />
          </View>
        ) : (
          <Button title="Check code" kind="plain" disabled={busy || code.trim().length < 6} onPress={() => void run(async () => setPreview(await previewInvite(code)), "join")} testID="check-code" />
        )}
      </Chunky>

      <Button title="Log out" kind="ghost" onPress={() => void logOut().catch((e: ApiError) => setErrors({ join: e.message }))} />
    </Page>
  );
}
