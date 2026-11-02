import { useColorScheme } from "react-native";

/**
 * FlowTask's look: a warm cream page, ink outlines with hard offset shadows, and a saturated colour
 * for every project. Chunky, friendly, a little loud.
 */
export const swatches = {
  tangerine: "#FF7A1A",
  grape: "#8B5CF6",
  mint: "#22C9A0",
  sky: "#38B6F8",
  lemon: "#FFCF33",
  bubblegum: "#FF5DA2",
  tomato: "#FF4D4D",
  leaf: "#7BC74D",
} as const;

export type Swatch = keyof typeof swatches;
export const SWATCH_NAMES = Object.keys(swatches) as Swatch[];

/** Text colour that reads on top of each swatch. */
export const onSwatch: Record<Swatch, string> = {
  tangerine: "#1B1530",
  grape: "#FFFFFF",
  mint: "#1B1530",
  sky: "#1B1530",
  lemon: "#1B1530",
  bubblegum: "#1B1530",
  tomato: "#FFFFFF",
  leaf: "#1B1530",
};

/** A pale tint of each swatch, for backgrounds behind content in that colour. */
export const tint: Record<Swatch, string> = {
  tangerine: "#FFE3CC",
  grape: "#E9E0FF",
  mint: "#CFF6EA",
  sky: "#D4EFFE",
  lemon: "#FFF2C2",
  bubblegum: "#FFD9EA",
  tomato: "#FFD6D6",
  leaf: "#E1F4D4",
};

export type Palette = {
  dark: boolean;
  bg: string;
  surface: string;
  raised: string;
  ink: string;
  text: string;
  muted: string;
  outline: string;
  shadow: string;
  accent: string;
  onAccent: string;
  danger: string;
};

const light: Palette = {
  dark: false,
  bg: "#FFF6EA",
  surface: "#FFFFFF",
  raised: "#FFFDF8",
  ink: "#1B1530",
  text: "#1B1530",
  muted: "#6E6684",
  outline: "#1B1530",
  shadow: "#1B1530",
  accent: swatches.tangerine,
  onAccent: "#1B1530",
  danger: "#E5383B",
};

const dark: Palette = {
  dark: true,
  bg: "#16102A",
  surface: "#231A3F",
  raised: "#2C2250",
  ink: "#F6EBDD",
  text: "#F6EBDD",
  muted: "#B4A9CF",
  outline: "#F6EBDD",
  shadow: "#7C5CFF",
  accent: swatches.tangerine,
  onAccent: "#1B1530",
  danger: "#FF6B6B",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const font = {
  display: "BricolageGrotesque_800ExtraBold",
  displayBold: "BricolageGrotesque_700Bold",
  displayMedium: "BricolageGrotesque_600SemiBold",
  body: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodyBold: "DMSans_700Bold",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 };
export const stroke = 2;
/** The hard offset shadow under chunky elements. */
export const lift = { sm: 3, md: 4, lg: 6 };
