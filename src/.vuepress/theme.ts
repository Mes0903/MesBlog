import { hopeTheme } from "vuepress-theme-hope";
import sidebar from "./sidebar.js";
import fs from "node:fs";
import path from "node:path";

const callgraph = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "./shiki/callgraph.tmLanguage.json"), "utf-8")
);
callgraph.name ??= "callgraph";
callgraph.scopeName ??= "source.callgraph";

export default hopeTheme({
  hostname: "https://mes0903.github.io",
  contributors: false,

  author: {
    name: "Mes",
    url: "https://mes0903.github.io",
  },

  logo: "/flame.jpg",
  favicon: "/flame.ico",

  repo: "Mes0903/Mes0903.github.io",
  repoDisplay: false,

  docsDir: "src",

  sidebar,

  footer: "The content on this site is all CC-BY-SA, or MIT/GPLv3+ dual license for code.",

  displayFooter: true,

  blog: {
    description: "OS & CG dev",
    medias: {
      Discord: "https://discordapp.com/users/411596393074130944",
      Email: "mes900903@gmail.com",
      Facebook: "https://www.facebook.com/Mes0903/",
      GitHub: "https://github.com/Mes0903",
      Instagram: "https://www.instagram.com/mes_0903/",
      Twitter: "https://x.com/Mes_0903",
      Youtube: "https://www.youtube.com/@mes0903",
    },
  },

  // enable it to preview all changes in time
  // hotReload: true,

  // These features are enabled for demo, only preserve features you need here
  markdown: {
    align: true,
    attrs: false,
    codeTabs: true,
    component: true,
    demo: true,
    figure: true,
    gfm: true,
    imgLazyload: true,
    imgSize: true,
    include: true,
    mark: true,
    plantuml: true,
    spoiler: true,
    stylize: [
      {
        matcher: "Recommended",
        replacer: ({ tag }) => {
          if (tag === "em")
            return {
              tag: "Badge",
              attrs: { type: "tip" },
              content: "Recommended",
            };
        },
      },
    ],
    sub: true,
    sup: true,
    tabs: true,
    tasklist: true,
    vPre: true,

    // uncomment these if you need TeX support
    math: {
    //   // install katex before enabling it
    //   type: "katex",
    //   // or install mathjax-full before enabling it
      type: "mathjax",
    },

    highlighter: {
      type: "shiki",
      highlightLines: true,
      notationWordHighlight: true,
      lineNumbers: true,
      langs: [callgraph],
    },

    // install chart.js before enabling it
    // chartjs: true,

    // install echarts before enabling it
    // echarts: true,

    // install flowchart.ts before enabling it
    // flowchart: true,

    // install mermaid before enabling it
    // mermaid: true,

    // playground: {
    //   presets: ["ts", "vue"],
    // },

    // install @vue/repl before enabling it
    // vuePlayground: true,

    // install sandpack-vue3 before enabling it
    // sandpack: true,

    // install @vuepress/plugin-revealjs and uncomment these if you need slides
    // revealjs: {
    //   plugins: ["highlight", "math", "search", "notes", "zoom"],
    // },
  },

  plugins: {
    blog: {
      excerptLength: 0,
    },
    catalog: false,
    docsearch: {
      appId: "KE4NHPCNHW",
      apiKey: "eeb47bb06c7dbde84c9127afea73ebc5",
      indexName: "mes0903io",
    },

    // Install @waline/client before enabling it
    // Note: This is for testing ONLY!
    // You MUST generate and use your own comment service in production.
    // comment: {
    //   provider: "Waline",
    //   serverURL: "https://waline-comment.vuejs.press",
    // },

    components: {
      components: ["Badge", "VPCard"],
    },

    icon: {
      prefix: "fa6-solid:",
    },

    feed: {
      rss: true,
      atom: true,
      json: true,
    },
    // install @vuepress/plugin-pwa and uncomment these if you want a PWA
    // pwa: {
    //   favicon: "/favicon.ico",
    //   cacheHTML: true,
    //   cacheImage: true,
    //   appendBase: true,
    //   apple: {
    //     icon: "/assets/icon/apple-icon-152.png",
    //     statusBarColor: "black",
    //   },
    //   msTile: {
    //     image: "/assets/icon/ms-icon-144.png",
    //     color: "#ffffff",
    //   },
    //   manifest: {
    //     icons: [
    //       {
    //         src: "/assets/icon/chrome-mask-512.png",
    //         sizes: "512x512",
    //         purpose: "maskable",
    //         type: "image/png",
    //       },
    //       {
    //         src: "/assets/icon/chrome-mask-192.png",
    //         sizes: "192x192",
    //         purpose: "maskable",
    //         type: "image/png",
    //       },
    //       {
    //         src: "/assets/icon/chrome-512.png",
    //         sizes: "512x512",
    //         type: "image/png",
    //       },
    //       {
    //         src: "/assets/icon/chrome-192.png",
    //         sizes: "192x192",
    //         type: "image/png",
    //       },
    //     ],
    //     shortcuts: [
    //       {
    //         name: "Demo",
    //         short_name: "Demo",
    //         url: "/demo/",
    //         icons: [
    //           {
    //             src: "/assets/icon/guide-maskable.png",
    //             sizes: "192x192",
    //             purpose: "maskable",
    //             type: "image/png",
    //           },
    //         ],
    //       },
    //     ],
    //   },
    // },
  },
});
