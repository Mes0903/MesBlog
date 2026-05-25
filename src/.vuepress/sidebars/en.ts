import { sidebar } from "vuepress-theme-hope";

export default sidebar([
  "/en/",
  {
    text: "Essays",
    collapsible: true,
    prefix: "/en/essay/",
    children: [
      "2026-OSS-NA/",
    ],
  },
]);
