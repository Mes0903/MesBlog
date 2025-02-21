import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  lang: "en-US",
  title: "Mes's Blog",
  description: "Being Towards Death",

  theme,

  // Enable it with pwa
  // shouldPrefetch: false,
});
