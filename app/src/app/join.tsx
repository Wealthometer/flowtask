import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { acceptInvite, createWorkspace, previewInvite } from "../data/store.ts";
import { Button, Chunky, Field, T } from "../ui/kit.tsx";
import { Page, TopBar } from "../ui/parts.tsx";
import { space, swatches } from "../ui/theme.ts";

/** Join another workspace by code (also opened by flowtask://join?code=…), or start a new one. */
export default function Join() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState((params.code ?? "").toUpperCase());
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewInvite>> | null>(null);
  const [error, setError] = useState<{ field: string; text: string } | null>(null);

  useEffect(() => {
    if (params.code) void previewInvite(params.code).then(setPreview).catch((e: Error) => setError({ field: "code", text: e.message }));
  }, [params.code]);

  const run = (field: string, fn: () => Promise<unknown>) => {
    setError(null);
    void fn().catch((e: Error) => setError({ field, text: e.message }));
  };

  return (
    <Page>
      <TopBar title="Another workspace" />
      <Chunky fill={swatches.sky} innerStyle={{ padding: space.lg, gap: space.md }}>
        <T variant="h2" color="#1B1530">Join with a code</T>
        <Field label="Invite code" value={code} onChangeText={(v) => { setCode(v.toUpperCase()); setPreview(null); }} autoCapitalize="characters" error={error?.field === "code" ? error.text : undefined} />
        {preview ? (
          <View style={{ gap: space.sm }}>
            <T variant="bodyBold" color="#1B1530">
              {preview.alreadyMember ? `You're already in ${preview.workspace.name}.` : `${preview.invitedBy} invited you to ${preview.workspace.name}.`}
            </T>
            <Button title={preview.alreadyMember ? `Open ${preview.workspace.name}` : `Join ${preview.workspace.name}`} color="grape" onPress={() => run("code", () => acceptInvite(code).then(() => router.replace("/home")))} />
          </View>
        ) : (
          <Button title="Check code" kind="plain" disabled={code.trim().length < 6} onPress={() => run("code", async () => setPreview(await previewInvite(code)))} />
        )}
      </Chunky>
      <Chunky fill={swatches.tangerine} innerStyle={{ padding: space.lg, gap: space.md }}>
        <T variant="h2" color="#1B1530">Start a new one</T>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Side project" error={error?.field === "name" ? error.text : undefined} />
        <Button title="Create workspace" color="lemon" onPress={() => run("name", () => createWorkspace(name).then(() => router.replace("/home")))} />
      </Chunky>
    </Page>
  );
}
