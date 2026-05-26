import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  locales: {
    "/": {
      lang: "zh-TW",
      title: "Mes's Blog",
      description: "Being Towards Death",
    },
    "/en/": {
      lang: "en-US",
      title: "Mes's Blog",
      description: "Being Towards Death",
    },
  },

  theme,

  // Enable it with pwa
  // shouldPrefetch: false,
});
