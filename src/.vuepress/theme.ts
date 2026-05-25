import { hopeTheme } from "vuepress-theme-hope";
import zhSidebar from "./sidebars/zh.js";
import enSidebar from "./sidebars/en.js";
import jaSidebar from "./sidebars/ja.js";
import fs from "node:fs";
import path from "node:path";

const callgraph = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "./shiki/callgraph.tmLanguage.json"), "utf-8")
);
callgraph.name ??= "callgraph";
callgraph.scopeName ??= "source.callgraph";

const footer =
  "The content on this site is all CC-BY-SA, or MIT/GPLv3+ dual license for code.";

const blogMedias = {
  Discord: "https://discordapp.com/users/411596393074130944",
  Email: "mes900903@gmail.com",
  Facebook: "https://www.facebook.com/Mes0903/",
  GitHub: "https://github.com/Mes0903",
  Instagram: "https://www.instagram.com/mes_0903/",
  Twitter: "https://x.com/Mes_0903",
  Youtube: "https://www.youtube.com/@mes0903",
};

const zhTwThemeLocale = {
  navbarLocales: {
    langName: "繁體中文",
    selectLangAriaLabel: "選擇語言",
  },
  metaLocales: {
    author: "作者",
    date: "寫作日期",
    origin: "原創",
    views: "瀏覽量",
    category: "分類",
    tag: "標籤",
    readingTime: "閱讀時間",
    words: "字數",
    toc: "此頁內容",
    prev: "上一頁",
    next: "下一頁",
    contributors: "貢獻者",
    editLink: "編輯此頁",
    print: "列印",
  },
  blogLocales: {
    article: "文章",
    articleList: "文章列表",
    category: "分類",
    tag: "標籤",
    timeline: "時間軸",
    timelineTitle: "昨日不再",
    all: "全部",
    intro: "個人介紹",
    star: "星標",
    empty: "$text 為空",
  },
  paginationLocales: {
    prev: "上一頁",
    next: "下一頁",
    navigate: "跳轉到",
    action: "前往",
    errorText: "請輸入 1 到 $page 之間的頁碼！",
  },
  outlookLocales: {
    themeColor: "主題色",
    darkmode: "主題模式",
    fullscreen: "全螢幕",
  },
  encryptLocales: {
    iconLabel: "頁面已加密",
    placeholder: "輸入密碼",
    remember: "記住密碼",
    errorHint: "請輸入正確密碼",
  },
  routerLocales: {
    skipToContent: "跳至主要內容",
    notFoundTitle: "頁面不存在",
    notFoundMsg: [
      "這裡什麼也沒有",
      "我們是怎麼來到這裡的？",
      "這是 404",
      "看起來你造訪了一個失效的連結",
    ],
    back: "返回上一頁",
    home: "帶我回家",
  },
};

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

  displayFooter: true,

  locales: {
    "/": {
      lang: "zh-TW",
      sidebar: zhSidebar,
      footer,
      ...zhTwThemeLocale,
      blog: {
        description: "OS & CG dev",
        medias: blogMedias,
      },
    },
    "/en/": {
      lang: "en-US",
      sidebar: enSidebar,
      footer,
      blog: {
        description: "OS & CG dev",
        medias: blogMedias,
      },
    },
    "/ja/": {
      lang: "ja-JP",
      sidebar: jaSidebar,
      footer,
      blog: {
        description: "OS & CG dev",
        medias: blogMedias,
      },
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
