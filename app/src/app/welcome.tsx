import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { ApiError, OfflineError } from "../data/api.ts";
import { logIn, setServer, signUp, useStore } from "../data/store.ts";
import { Button, Field, Icon, Segmented, T, type IconName } from "../ui/kit.tsx";
import { font, onSwatch, radius, space, stroke, swatches, usePalette, type Swatch } from "../ui/theme.ts";

const SHAPES: { icon: IconName; color: Swatch; x: number; y: number; r: number; size: number; delay: number }[] = [
  { icon: "check-bold", color: "mint", x: 6, y: 0, r: -12, size: 74, delay: 0 },
  { icon: "rocket-launch", color: "tangerine", x: 58, y: 8, r: 10, size: 92, delay: 300 },
  { icon: "chat", color: "grape", x: 30, y: 46, r: -6, size: 64, delay: 600 },
  { icon: "star-four-points", color: "lemon", x: 78, y: 58, r: 14, size: 58, delay: 900 },
  { icon: "account-group", color: "sky", x: 0, y: 62, r: 8, size: 60, delay: 1200 },
];

function FloatingShape({ s }: { s: (typeof SHAPES)[number] }) {
  const c = usePalette();
  const y = useSharedValue(0);
  useEffect(() => {
    y.set(withDelay(s.delay, withRepeat(withSequence(withTiming(-10, { duration: 1600, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.quad) })), -1)));
  }, [s.delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { rotate: `${s.r}deg` }] }));
  return (
    <Animated.View style={[{ position: "absolute", left: `${s.x}%`, top: `${s.y}%` }, style]}>
      <View style={{ position: "absolute", top: 5, left: 5, width: s.size, height: s.size, borderRadius: s.size * 0.3, backgroundColor: c.shadow }} />
      <View style={{ width: s.size, height: s.size, borderRadius: s.size * 0.3, backgroundColor: swatches[s.color], borderWidth: stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}>
        <Icon name={s.icon} size={s.size * 0.48} color={onSwatch[s.color]} />
      </View>
    </Animated.View>
  );
}

export default function Welcome() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const server = useStore((s) => s.server);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editServer, setEditServer] = useState(false);
  const [serverDraft, setServerDraft] = useState(server);

  const submit = async () => {
    setErrors({});
    if (mode === "signup" && !name.trim()) return setErrors({ name: "What should your team call you?" });
    setBusy(true);
    try {
      if (mode === "signup") await signUp({ name, email, password });
      else await logIn({ email, password });
    } catch (e) {
      if (e instanceof ApiError) setErrors({ [e.field ?? "form"]: e.message });
      else if (e instanceof OfflineError) setErrors({ form: `Can't reach the FlowTask server at ${server}. Check your connection.` });
      else setErrors({ form: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveServer = async () => {
    try {
      await setServer(serverDraft);
      setEditServer(false);
      setErrors({});
    } catch (e) {
      setErrors({ server: e instanceof ApiError ? e.message : "Couldn't reach a FlowTask server there" });
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior="padding">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl, paddingHorizontal: space.xl, gap: space.xl }}>
        <View style={{ height: 230 }}>
          {SHAPES.map((s) => <FloatingShape key={s.icon} s={s} />)}
        </View>
        <View style={{ gap: space.sm }}>
          <Text style={{ fontFamily: font.display, fontSize: 46, lineHeight: 46, letterSpacing: -1.6, color: c.text }}>Get your team{"\n"}in flow.</Text>
          <T variant="muted">Projects, boards and to-dos for you and your crew. Works offline, syncs the second you're back.</T>
        </View>

        <Segmented options={[{ value: "signup", label: "I'm new here" }, { value: "login", label: "I have an account" }]} value={mode} onChange={(m) => { setMode(m); setErrors({}); }} />

        <View style={{ gap: space.lg }}>
          {mode === "signup" ? <Field label="Your name" value={name} onChangeText={setName} placeholder="Ada Obi" autoComplete="name" error={errors.name} testID="name" /> : null}
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errors.email} testID="email" />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={mode === "signup" ? "At least 8 characters" : ""}
            secureTextEntry
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            error={errors.password}
            onSubmitEditing={() => void submit()}
            testID="password"
          />
          {errors.form ? (
            <View style={{ backgroundColor: swatches.tomato, borderWidth: stroke, borderColor: c.outline, borderRadius: radius.md, padding: space.md }}>
              <T variant="bodyBold" color="#FFFFFF">{errors.form}</T>
            </View>
          ) : null}
          <Button title={busy ? "One sec…" : mode === "signup" ? "Create my account" : "Log in"} icon={mode === "signup" ? "arrow-right-bold" : "login"} onPress={() => void submit()} disabled={busy} testID="submit" />
        </View>

        <View style={{ gap: space.sm, alignItems: "center" }}>
          {editServer ? (
            <View style={{ gap: space.sm, alignSelf: "stretch" }}>
              <Field label="Server address" value={serverDraft} onChangeText={setServerDraft} autoCapitalize="none" keyboardType="url" error={errors.server} />
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button title="Use this server" small onPress={() => void saveServer()} style={{ flex: 1 }} />
                <Button title="Cancel" kind="plain" small onPress={() => setEditServer(false)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <Pressable onPress={() => { setServerDraft(server); setEditServer(true); }} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="server" size={16} color={c.muted} />
              <T variant="small">Server: {server.replace(/^https?:\/\//, "")} · change</T>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
