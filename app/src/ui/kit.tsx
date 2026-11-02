import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { font, lift, radius, space, stroke, swatches, onSwatch, usePalette, type Swatch } from "./theme.ts";

export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const c = usePalette();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? c.text} />;
}

export function tap(kind: "light" | "success" | "warning" = "light") {
  if (Platform.OS === "web") return;
  if (kind === "light") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  else void Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
}

// ── Text ────────────────────────────────────────────────────────────────────

type Variant = "hero" | "title" | "h2" | "h3" | "body" | "bodyBold" | "muted" | "small" | "label" | "number";

const VARIANTS: Record<Variant, TextStyle> = {
  hero: { fontFamily: font.display, fontSize: 40, lineHeight: 42, letterSpacing: -1.2 },
  title: { fontFamily: font.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.8 },
  h2: { fontFamily: font.displayBold, fontSize: 22, lineHeight: 26, letterSpacing: -0.4 },
  h3: { fontFamily: font.displayBold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 22 },
  bodyBold: { fontFamily: font.bodyBold, fontSize: 16, lineHeight: 22 },
  muted: { fontFamily: font.body, fontSize: 15, lineHeight: 21 },
  small: { fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  number: { fontFamily: font.display, fontSize: 18, fontVariant: ["tabular-nums"] },
};

export function T({
  variant = "body",
  color,
  style,
  children,
  numberOfLines,
}: {
  variant?: Variant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  const c = usePalette();
  const fallback = variant === "muted" || variant === "small" || variant === "label" ? c.muted : c.text;
  return (
    <Text style={[VARIANTS[variant], { color: color ?? fallback }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

// ── Chunky surfaces ─────────────────────────────────────────────────────────

/**
 * The signature surface: an ink outline with a hard offset shadow. When pressable it sinks into
 * its shadow on press, like a physical button.
 */
export function Chunky({
  children,
  fill,
  onPress,
  onLongPress,
  depth = lift.md,
  r = radius.lg,
  style,
  innerStyle,
  testID,
  accessibilityLabel,
  disabled,
}: {
  children: ReactNode;
  fill?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  depth?: number;
  r?: number;
  style?: StyleProp<ViewStyle>;
  innerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const c = usePalette();
  const face = (pressed: boolean) => (
    <View
      style={[
        {
          flexGrow: 1,
          backgroundColor: fill ?? c.surface,
          borderColor: c.outline,
          borderWidth: stroke,
          borderRadius: r,
          transform: [{ translateX: pressed ? depth : 0 }, { translateY: pressed ? depth : 0 }],
        },
        innerStyle,
      ]}
    >
      {children}
    </View>
  );
  const shadow = <View pointerEvents="none" style={{ position: "absolute", top: depth, left: depth, right: -depth, bottom: -depth, borderRadius: r, backgroundColor: c.shadow }} />;
  if (!onPress && !onLongPress) {
    return (
      <View style={[{ marginRight: depth, marginBottom: depth }, style]}>
        {shadow}
        {face(false)}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => {
        tap();
        onPress?.();
      }}
      onLongPress={onLongPress}
      style={[{ marginRight: depth, marginBottom: depth }, disabled && { opacity: 0.5 }, style]}
    >
      {({ pressed }) => (
        <>
          {shadow}
          {face(pressed)}
        </>
      )}
    </Pressable>
  );
}

type ButtonKind = "primary" | "plain" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  kind = "primary",
  icon,
  disabled,
  color,
  style,
  testID,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  color?: Swatch;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  small?: boolean;
}) {
  const c = usePalette();
  if (kind === "ghost") {
    return (
      <Pressable testID={testID} onPress={onPress} disabled={disabled} accessibilityRole="button" style={[styles.ghost, style]}>
        {icon ? <Icon name={icon} size={18} color={c.text} /> : null}
        <Text style={[styles.buttonText, { color: c.text, textDecorationLine: "underline" }]}>{title}</Text>
      </Pressable>
    );
  }
  const fill = kind === "primary" ? swatches[color ?? "tangerine"] : kind === "danger" ? swatches.tomato : c.surface;
  const fg = kind === "primary" ? onSwatch[color ?? "tangerine"] : kind === "danger" ? "#FFFFFF" : c.text;
  return (
    <Chunky
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      fill={fill}
      r={radius.md}
      depth={small ? lift.sm : lift.md}
      style={style}
      innerStyle={[styles.button, small && styles.buttonSmall]}
    >
      {icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} /> : null}
      <Text style={[styles.buttonText, small && { fontSize: 15 }, { color: fg }]}>{title}</Text>
    </Chunky>
  );
}

export function Pill({ label, color, icon, solid, onPress, testID }: { label: string; color: Swatch; icon?: IconName; solid?: boolean; onPress?: () => void; testID?: string }) {
  const c = usePalette();
  const body = (
    <View style={[styles.pill, { backgroundColor: solid ? swatches[color] : "transparent", borderColor: c.outline }]}>
      {!solid ? <View style={[styles.dot, { backgroundColor: swatches[color], borderColor: c.outline }]} /> : null}
      {icon ? <Icon name={icon} size={14} color={solid ? onSwatch[color] : c.text} /> : null}
      <Text style={[styles.pillText, { color: solid ? onSwatch[color] : c.text }]}>{label}</Text>
    </View>
  );
  return onPress ? (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    body
  );
}

// ── People ──────────────────────────────────────────────────────────────────

export function Avatar({ name, color, size = 32 }: { name: string; color: Swatch; size?: number }) {
  const c = usePalette();
  const initials = name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <View
      accessibilityLabel={name}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: swatches[color], borderWidth: stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontFamily: font.bodyBold, fontSize: size * 0.38, color: onSwatch[color] }}>{initials}</Text>
    </View>
  );
}

export function AvatarStack({ people, size = 30, max = 4 }: { people: { name: string; color: Swatch }[]; size?: number; max?: number }) {
  const c = usePalette();
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <View style={{ flexDirection: "row" }}>
      {shown.map((p, i) => (
        <View key={p.name + i} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar name={p.name} color={p.color} size={size} />
        </View>
      ))}
      {extra > 0 ? (
        <View style={{ marginLeft: -size * 0.3, width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface, borderWidth: stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: font.bodyBold, fontSize: size * 0.36, color: c.text }}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Progress & checks ───────────────────────────────────────────────────────

export function Progress({ value, color = "mint", height = 12, onDark }: { value: number; color?: Swatch; height?: number; onDark?: boolean }) {
  const c = usePalette();
  const pct = Math.max(0, Math.min(1, value));
  const width = useSharedValue(0);
  useEffect(() => {
    width.set(withTiming(pct, { duration: 600 }));
  }, [pct, width]);
  const bar = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, borderWidth: stroke, borderColor: onDark ? "#1B1530" : c.outline, backgroundColor: onDark ? "rgba(255,255,255,0.55)" : c.raised, overflow: "hidden" }}>
      <Animated.View style={[{ height: "100%", backgroundColor: swatches[color], borderRightWidth: pct > 0 && pct < 1 ? stroke : 0, borderColor: onDark ? "#1B1530" : c.outline }, bar]} />
    </View>
  );
}

const BURST: Swatch[] = ["tangerine", "grape", "mint", "sky", "lemon", "bubblegum", "tomato", "leaf"];

function Particle({ index, size, run }: { index: number; size: number; run: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!run) return;
    t.set(0);
    t.set(withTiming(1, { duration: 650 }));
  }, [run, t]);
  const angle = (index / BURST.length) * Math.PI * 2;
  const style = useAnimatedStyle(() => ({
    opacity: t.value === 0 ? 0 : 1 - t.value,
    transform: [{ translateX: Math.cos(angle) * size * 1.1 * t.value }, { translateY: Math.sin(angle) * size * 1.1 * t.value }, { scale: 1 - t.value * 0.4 }],
  }));
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", left: size / 2 - 4, top: size / 2 - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: swatches[BURST[index]!] }, style]} />;
}

/** A fat round checkbox that pops (with a little confetti) when ticked. */
export function Check({ done, color = "mint", onToggle, size = 30, label }: { done: boolean; color?: Swatch; onToggle: () => void; size?: number; label: string }) {
  const c = usePalette();
  const scale = useSharedValue(1);
  const [burst, setBurst] = useState(0);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        scale.set(withSequence(withTiming(0.8, { duration: 80 }), withSpring(1.15, { damping: 6 }), withSpring(1)));
        tap(done ? "light" : "success");
        if (!done) setBurst((b) => b + 1);
        onToggle();
      }}
    >
      {BURST.map((_, i) => <Particle key={i} index={i} size={size} run={burst} />)}
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, borderWidth: stroke + 0.5, borderColor: c.outline, backgroundColor: done ? swatches[color] : c.surface, alignItems: "center", justifyContent: "center" },
          anim,
        ]}
      >
        {done ? <Icon name="check-bold" size={size * 0.6} color={onSwatch[color]} /> : null}
      </Animated.View>
    </Pressable>
  );
}

/** Rounded square holding an icon in a swatch colour. */
export function IconTile({ icon, color, size = 44 }: { icon: IconName; color: Swatch; size?: number }) {
  const c = usePalette();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: swatches[color], borderWidth: stroke, borderColor: c.outline, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={size * 0.52} color={onSwatch[color]} />
    </View>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export function Field({ label, error, hint, style, ...input }: TextInputProps & { label: string; error?: string; hint?: string }) {
  const c = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[VARIANTS.small, { color: c.text, fontFamily: font.bodyBold }]}>{label}</Text>
      <View style={{ borderRadius: radius.md, backgroundColor: c.shadow, paddingRight: focused ? lift.sm : 0, paddingBottom: focused ? lift.sm : 0 }}>
        <TextInput
          placeholderTextColor={c.muted}
          accessibilityLabel={label}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={[
            {
              fontFamily: font.body,
              fontSize: 16,
              color: c.text,
              backgroundColor: c.surface,
              borderWidth: stroke,
              borderColor: error ? c.danger : c.outline,
              borderRadius: radius.md,
              paddingHorizontal: space.lg,
              paddingVertical: 13,
              minHeight: 52,
            },
            style,
          ]}
        />
      </View>
      {error ? <T variant="small" color={c.danger}>{error}</T> : hint ? <T variant="small">{hint}</T> : null}
    </View>
  );
}

export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string; icon?: IconName }[]; value: V; onChange: (v: V) => void }) {
  const c = usePalette();
  return (
    <View style={[styles.segment, { borderColor: c.outline, backgroundColor: c.surface }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            style={[styles.segmentItem, on && { backgroundColor: c.ink }]}
          >
            {o.icon ? <Icon name={o.icon} size={16} color={on ? c.bg : c.text} /> : null}
            <Text style={{ fontFamily: font.bodyBold, fontSize: 14, color: on ? c.bg : c.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({ emoji, title, body, action }: { emoji: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.xl }}>
      <Text style={{ fontSize: 56 }}>{emoji}</Text>
      <T variant="h2" style={{ textAlign: "center" }}>{title}</T>
      {body ? <T variant="muted" style={{ textAlign: "center", maxWidth: 320 }}>{body}</T> : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 54, paddingHorizontal: space.xl },
  buttonSmall: { minHeight: 42, paddingHorizontal: space.lg },
  buttonText: { fontFamily: font.bodyBold, fontSize: 17 },
  ghost: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: space.md },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: stroke, alignSelf: "flex-start" },
  pillText: { fontFamily: font.bodyBold, fontSize: 13 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  segment: { flexDirection: "row", borderWidth: stroke, borderRadius: radius.pill, padding: 3, gap: 3 },
  segmentItem: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: 8, borderRadius: radius.pill },
});
