import { sidebar } from "vuepress-theme-hope";

export default sidebar([
  "/en/",
  "/en/about/",
  {
    text: "Essays",
    collapsible: true,
    prefix: "/en/essay/",
    children: [
      "2026-OSS-NA/",
    ],
  },
]);
