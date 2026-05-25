import { sidebar } from "vuepress-theme-hope";

export default sidebar([
  "/ja/",
  {
    text: "雑記",
    collapsible: true,
    prefix: "/ja/essay/",
    children: [
      "2026-OSS-NA/",
    ],
  },
]);
