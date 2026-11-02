// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "dist-native/*", ".expo/*", "android/*", "ios/*"],
  },
  {
    rules: {
      "react-hooks/exhaustive-deps": "error",
      // React Native renders text literally; escaping quotes is an HTML concern.
      "react/no-unescaped-entities": "off",
    },
  },
]);
