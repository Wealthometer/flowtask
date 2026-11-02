import { View } from "react-native";
import { usePalette } from "../ui/theme.ts";

/** The root layout redirects from here once it knows whether someone is signed in. */
export default function Index() {
  const c = usePalette();
  return <View style={{ flex: 1, backgroundColor: c.bg }} />;
}
