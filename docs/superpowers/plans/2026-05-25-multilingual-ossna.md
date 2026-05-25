# MesBlog Multilingual OSSNA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add English and Japanese MesBlog locales and publish translated
versions of the `2026-OSS-NA` article without moving existing Traditional
Chinese URLs.

**Architecture:** Keep Traditional Chinese at `/`, add locale directories under
`src/en/` and `src/ja/`, and configure VuePress plus `vuepress-theme-hope`
locale maps. Split sidebar config by locale so translated sidebars only expose
translated pages.

**Tech Stack:** VuePress 2, `vuepress-theme-hope`, TypeScript config files,
Markdown content, `pnpm`, Vite build.

---

## Tasks

### Task 1: Baseline Checks

**Files:**

- Read: `src/.vuepress/config.ts`
- Read: `src/.vuepress/theme.ts`
- Read: `src/.vuepress/sidebar.ts`
- Read: `src/essay/2026-OSS-NA/README.md`

- [ ] **Step 1: Confirm the worktree scope**

Run:

```bash
git status --short
```

Expected: either no output, or only this implementation plan file if it has not
been committed. Stop and inspect before editing if unrelated files are dirty.

- [ ] **Step 2: Run the current build before changing behavior**

Run:

```bash
pnpm run build:vite
```

Expected: build succeeds. If it fails, save the exact error in the final
implementation notes and decide whether the failure is pre-existing before
continuing.

- [ ] **Step 3: Capture source article section boundaries**

Run:

```bash
rg '^## ' src/essay/2026-OSS-NA/README.md
```

Expected output:

```text
## 5/16（星期六）
## 5/17（星期日）
## 5/18（星期一）
## 5/19（星期二）
## 5/20（星期三）
## 5/21（星期四）
## 5/22（星期五）
## 5/23（星期六）
## 一些心得與 Future Work
```

- [ ] **Step 4: Capture source article image count**

Run:

```bash
rg '!\[' src/essay/2026-OSS-NA/README.md
```

Expected: 13 image references. The translated articles must keep the same 13
images with localized alt text.

### Task 2: Add Localized Homepages

**Files:**

- Create: `src/en/README.md`
- Create: `src/ja/README.md`

- [ ] **Step 1: Create locale directories**

Run:

```bash
mkdir -p src/en src/ja
```

Expected: directories exist.

- [ ] **Step 2: Add the English homepage**

Create `src/en/README.md` with exactly:

```markdown
---
home: true
title: Mes's Blog
heroText: Mes's Blog
tagline: Being Towards Death
layout: Blog
bgImage: /kikuri.jpg
icon: house
heroFullScreen: true
footer: >-
  The content on this site is all CC-BY-SA, or MIT/GPLv3+ dual license for
  code.
---
```

- [ ] **Step 3: Add the Japanese homepage**

Create `src/ja/README.md` with exactly:

```markdown
---
home: true
title: Mes's Blog
heroText: Mes's Blog
tagline: Being Towards Death
layout: Blog
bgImage: /kikuri.jpg
icon: house
heroFullScreen: true
footer: >-
  The content on this site is all CC-BY-SA, or MIT/GPLv3+ dual license for
  code.
---
```

- [ ] **Step 4: Check homepage frontmatter**

Run:

```bash
pnpm exec markdownlint-cli2 src/en/README.md src/ja/README.md
```

Expected: `0 error(s)`.

- [ ] **Step 5: Commit localized homepages**

Run:

```bash
git add src/en/README.md src/ja/README.md
git commit -m "feat: add localized blog homepages"
```

Expected: commit succeeds.

### Task 3: Add English OSSNA Translation

**Files:**

- Create: `src/en/essay/2026-OSS-NA/README.md`
- Read: `src/essay/2026-OSS-NA/README.md`

- [ ] **Step 1: Create the English article directory**

Run:

```bash
mkdir -p src/en/essay/2026-OSS-NA
```

Expected: directory exists.

- [ ] **Step 2: Create the English article frontmatter and title**

Start `src/en/essay/2026-OSS-NA/README.md` with:

```markdown
---
title: Reflections on OSS-NA 2026
date: 2026-05-25
tag: essay
category: essay
---

# Reflections on OSS-NA 2026
```

- [ ] **Step 3: Translate the introduction**

Translate the opening paragraph and the two source links from
`src/essay/2026-OSS-NA/README.md`. Keep both URLs unchanged:

```markdown
- [Open Source Summit North America 2026 recap](https://hackmd.io/@shengwen/ossna2026)
- [OSSNA + ELC 2026 photo album](https://www.flickr.com/photos/linuxfoundation/albums/72177720333089343/)
```

Expected: the English text reads as a personal blog note, not a formal trip
report.

- [ ] **Step 4: Translate each dated section**

Translate each source section into English with these exact heading labels:

```markdown
## May 16 (Saturday)
## May 17 (Sunday)
## May 18 (Monday)
## May 19 (Tuesday)
## May 20 (Wednesday)
## May 21 (Thursday)
## May 22 (Friday)
## May 23 (Saturday)
## Reflections and Future Work
```

Rules for the prose:

- preserve all named people, projects, and organizations;
- keep `OSSNA`, `ELC`, `UMN`, `MOA`, `MIA`, `SAIL`, `SMP`, `KVM`,
  `RISC-V`, `virtio-gpu`, `box64`, `Wine`, `branchfs`, and `Unified HMI`
  unchanged;
- keep the casual first-person voice;
- smooth out repeated `XD` where English would otherwise sound forced;
- do not add facts or remove events.

- [ ] **Step 5: Translate image alt text and fix image paths**

Use these English image references, in the same positions as the source
article:

```markdown
![The talk room](../../../essay/2026-OSS-NA/image/talk-room.png)
![The talk wrapped up successfully](../../../essay/2026-OSS-NA/image/talk-finished.png)
![The lunch venue](../../../essay/2026-OSS-NA/image/lunch-hall.png)
![The professor, Wang Cong, and Mark chatting during the reception](../../../essay/2026-OSS-NA/image/reception-chat.jpg)
![Another reception photo](../../../essay/2026-OSS-NA/image/reception-wide-shot.png)
![The drone show](../../../essay/2026-OSS-NA/image/drone-show.jpg)
![Dinner group photo](../../../essay/2026-OSS-NA/image/dinner-group.png)
![The graduation photo spot](../../../essay/2026-OSS-NA/image/guoshi-graduation-photo.png)
![My rough cosplay of the graduation photo](../../../essay/2026-OSS-NA/image/graduation-photo-cosplay.png)
![Seeing Linus Torvalds in person for the first time](../../../essay/2026-OSS-NA/image/linus-torvalds-keynote.png)
![Huge campus turkeys](../../../essay/2026-OSS-NA/image/campus-turkeys.png)
![Waiting for the transfer at SFO](../../../essay/2026-OSS-NA/image/sfo-transfer.png)
![This cost 20 USD, but at least it was better than another cold sandwich](../../../essay/2026-OSS-NA/image/airport-expensive-meal.png)
```

- [ ] **Step 6: Verify the English article shape**

Run:

```bash
rg '^## ' src/en/essay/2026-OSS-NA/README.md
rg '!\[' src/en/essay/2026-OSS-NA/README.md
rg '\]\(image/' src/en/essay/2026-OSS-NA/README.md
```

Expected:

- first command shows the nine English headings from Step 4;
- second command shows 13 image references;
- third command produces no output.

- [ ] **Step 7: Lint the English Markdown**

Run:

```bash
pnpm exec markdownlint-cli2 src/en/essay/2026-OSS-NA/README.md
```

Expected: `0 error(s)`. Fix only formatting issues, not article meaning.

- [ ] **Step 8: Commit the English translation**

Run:

```bash
git add src/en/essay/2026-OSS-NA/README.md
git commit -m "feat: add english ossna article"
```

Expected: commit succeeds.

### Task 4: Add Japanese OSSNA Translation

**Files:**

- Create: `src/ja/essay/2026-OSS-NA/README.md`
- Read: `src/essay/2026-OSS-NA/README.md`

- [ ] **Step 1: Create the Japanese article directory**

Run:

```bash
mkdir -p src/ja/essay/2026-OSS-NA
```

Expected: directory exists.

- [ ] **Step 2: Create the Japanese article frontmatter and title**

Start `src/ja/essay/2026-OSS-NA/README.md` with:

```markdown
---
title: 2026 OSS-NA 参加記
date: 2026-05-25
tag: essay
category: essay
---

# 2026 OSS-NA 参加記
```

- [ ] **Step 3: Translate the introduction**

Translate the opening paragraph and the two source links from
`src/essay/2026-OSS-NA/README.md`. Keep both URLs unchanged:

```markdown
- [Open Source Summit North America 2026 会後記録](https://hackmd.io/@shengwen/ossna2026)
- [OSSNA + ELC 2026 写真集](https://www.flickr.com/photos/linuxfoundation/albums/72177720333089343/)
```

Expected: the Japanese text reads as a personal blog essay, with natural casual
Japanese rather than a literal Taiwanese Mandarin sentence order.

- [ ] **Step 4: Translate each dated section**

Translate each source section into Japanese with these exact heading labels:

```markdown
## 5/16（土）
## 5/17（日）
## 5/18（月）
## 5/19（火）
## 5/20（水）
## 5/21（木）
## 5/22（金）
## 5/23（土）
## 感想と Future Work
```

Rules for the prose:

- preserve all named people, projects, and organizations;
- keep `OSSNA`, `ELC`, `UMN`, `MOA`, `MIA`, `SAIL`, `SMP`, `KVM`,
  `RISC-V`, `virtio-gpu`, `box64`, `Wine`, `branchfs`, and `Unified HMI`
  unchanged;
- use natural Japanese blog prose;
- keep some self-deprecating humor, but do not overuse `XD`;
- do not add facts or remove events.

- [ ] **Step 5: Translate image alt text and fix image paths**

Use these Japanese image references, in the same positions as the source
article:

```markdown
![発表会場](../../../essay/2026-OSS-NA/image/talk-room.png)
![発表が無事終了](../../../essay/2026-OSS-NA/image/talk-finished.png)
![昼食会場](../../../essay/2026-OSS-NA/image/lunch-hall.png)
![先生と Wang Cong さんと Mark さんが話している様子](../../../essay/2026-OSS-NA/image/reception-chat.jpg)
![レセプションの別カット](../../../essay/2026-OSS-NA/image/reception-wide-shot.png)
![ドローンショー](../../../essay/2026-OSS-NA/image/drone-show.jpg)
![夕食の集合写真](../../../essay/2026-OSS-NA/image/dinner-group.png)
![卒業写真の場所](../../../essay/2026-OSS-NA/image/guoshi-graduation-photo.png)
![雑な卒業写真 cosplay](../../../essay/2026-OSS-NA/image/graduation-photo-cosplay.png)
![人生で初めて Linus Torvalds 本人を見た](../../../essay/2026-OSS-NA/image/linus-torvalds-keynote.png)
![キャンパスにいた大きな七面鳥](../../../essay/2026-OSS-NA/image/campus-turkeys.png)
![SFO で乗り継ぎ待ち](../../../essay/2026-OSS-NA/image/sfo-transfer.png)
![これで 20 ドルだが、冷たいサンドイッチよりはよかった](../../../essay/2026-OSS-NA/image/airport-expensive-meal.png)
```

- [ ] **Step 6: Verify the Japanese article shape**

Run:

```bash
rg '^## ' src/ja/essay/2026-OSS-NA/README.md
rg '!\[' src/ja/essay/2026-OSS-NA/README.md
rg '\]\(image/' src/ja/essay/2026-OSS-NA/README.md
```

Expected:

- first command shows the nine Japanese headings from Step 4;
- second command shows 13 image references;
- third command produces no output.

- [ ] **Step 7: Lint the Japanese Markdown**

Run:

```bash
pnpm exec markdownlint-cli2 src/ja/essay/2026-OSS-NA/README.md
```

Expected: `0 error(s)`. Fix only formatting issues, not article meaning.

- [ ] **Step 8: Commit the Japanese translation**

Run:

```bash
git add src/ja/essay/2026-OSS-NA/README.md
git commit -m "feat: add japanese ossna article"
```

Expected: commit succeeds.

### Task 5: Split Sidebar Config By Locale

**Files:**

- Create: `src/.vuepress/sidebars/zh.ts`
- Create: `src/.vuepress/sidebars/en.ts`
- Create: `src/.vuepress/sidebars/ja.ts`
- Modify: `src/.vuepress/sidebar.ts`

- [ ] **Step 1: Create the sidebars directory and copy the current sidebar**

Run:

```bash
mkdir -p src/.vuepress/sidebars
cp src/.vuepress/sidebar.ts src/.vuepress/sidebars/zh.ts
```

Expected: `src/.vuepress/sidebars/zh.ts` contains the current full
Traditional Chinese sidebar.

- [ ] **Step 2: Fix the Traditional Chinese OSSNA sidebar path**

In `src/.vuepress/sidebars/zh.ts`, replace:

```ts
"MesBlog/src/essay/2026-OSS-NA"
```

with:

```ts
"2026-OSS-NA/"
```

Expected: the `雜記` group still uses `prefix: "/essay/"`, and the OSSNA
child resolves to `/essay/2026-OSS-NA/`.

- [ ] **Step 3: Add the English sidebar**

Create `src/.vuepress/sidebars/en.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Add the Japanese sidebar**

Create `src/.vuepress/sidebars/ja.ts` with exactly:

```ts
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
```

- [ ] **Step 5: Preserve the old sidebar import path**

Replace `src/.vuepress/sidebar.ts` with exactly:

```ts
export { default } from "./sidebars/zh.js";
```

Expected: any existing import of `./sidebar.js` still receives the Traditional
Chinese sidebar.

- [ ] **Step 6: Verify sidebar files compile**

Run:

```bash
pnpm exec vuepress-vite info
```

Expected: command prints VuePress environment info without TypeScript import
errors.

- [ ] **Step 7: Commit sidebar split**

Run:

```bash
git add src/.vuepress/sidebar.ts src/.vuepress/sidebars
git commit -m "refactor: split sidebars by locale"
```

Expected: commit succeeds.

### Task 6: Configure VuePress And Theme Locales

**Files:**

- Modify: `src/.vuepress/config.ts`
- Modify: `src/.vuepress/theme.ts`

- [ ] **Step 1: Replace the VuePress site language config**

In `src/.vuepress/config.ts`, replace lines 5-16 with this full export:

```ts
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
    "/ja/": {
      lang: "ja-JP",
      title: "Mes's Blog",
      description: "Being Towards Death",
    },
  },

  theme,

  // Enable it with pwa
  // shouldPrefetch: false,
});
```

Expected: root locale is now `zh-TW`, and English/Japanese have prefixed
locale entries.

- [ ] **Step 2: Replace theme sidebar import**

In `src/.vuepress/theme.ts`, replace:

```ts
import sidebar from "./sidebar.js";
```

with:

```ts
import zhSidebar from "./sidebars/zh.js";
import enSidebar from "./sidebars/en.js";
import jaSidebar from "./sidebars/ja.js";
```

- [ ] **Step 3: Add shared footer and media constants**

After the `callgraph.scopeName` line in `src/.vuepress/theme.ts`, add:

```ts
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
```

- [ ] **Step 4: Replace root sidebar/footer/blog theme options**

In `src/.vuepress/theme.ts`, remove the current root `sidebar`, `footer`,
and `blog` blocks. Keep `displayFooter: true`.

Add this locale block where those root values were:

```ts
  locales: {
    "/": {
      sidebar: zhSidebar,
      footer,
      blog: {
        description: "OS & CG dev",
        medias: blogMedias,
      },
    },
    "/en/": {
      sidebar: enSidebar,
      footer,
      blog: {
        description: "OS & CG dev",
        medias: blogMedias,
      },
    },
    "/ja/": {
      sidebar: jaSidebar,
      footer,
      blog: {
        description: "OS & CG dev",
        medias: blogMedias,
      },
    },
  },
```

Expected: shared theme behavior stays at the root; locale-specific sidebar,
footer, and blog description live under `locales`.

- [ ] **Step 5: Check TypeScript and VuePress config loading**

Run:

```bash
pnpm exec vuepress-vite info
```

Expected: command completes without TypeScript or config load errors.

- [ ] **Step 6: Commit locale configuration**

Run:

```bash
git add src/.vuepress/config.ts src/.vuepress/theme.ts
git commit -m "feat: configure vuepress locales"
```

Expected: commit succeeds.

### Task 7: Full Build And Route Verification

**Files:**

- Verify: `src/.vuepress/dist`
- Verify: `src/en/essay/2026-OSS-NA/README.md`
- Verify: `src/ja/essay/2026-OSS-NA/README.md`

- [ ] **Step 1: Run the production build**

Run:

```bash
pnpm run build:vite
```

Expected: build succeeds.

- [ ] **Step 2: Verify generated HTML routes**

Run:

```bash
test -f src/.vuepress/dist/index.html
test -f src/.vuepress/dist/essay/2026-OSS-NA/index.html
test -f src/.vuepress/dist/en/index.html
test -f src/.vuepress/dist/en/essay/2026-OSS-NA/index.html
test -f src/.vuepress/dist/ja/index.html
test -f src/.vuepress/dist/ja/essay/2026-OSS-NA/index.html
```

Expected: every `test -f` exits successfully.

- [ ] **Step 3: Verify generated image URLs are not locale-local**

Run:

```bash
rg 'essay/2026-OSS-NA/image/talk-room.png' \
  src/.vuepress/dist/en/essay/2026-OSS-NA/index.html \
  src/.vuepress/dist/ja/essay/2026-OSS-NA/index.html
```

Expected: both generated localized article pages reference the shared source
image path.

- [ ] **Step 4: Check for accidental old broken sidebar route**

Run:

```bash
rg 'MesBlog/src/essay/2026-OSS-NA' src/.vuepress src/.vuepress/dist
```

Expected: no output.

- [ ] **Step 5: Run Markdown lint on changed Markdown files**

Run:

```bash
pnpm exec markdownlint-cli2 \
  src/en/README.md \
  src/ja/README.md \
  src/en/essay/2026-OSS-NA/README.md \
  src/ja/essay/2026-OSS-NA/README.md
```

Expected: `0 error(s)`.

- [ ] **Step 6: Capture final diff summary**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: only intentional generated build output appears dirty if the project
tracks `src/.vuepress/dist`. Recent commits should include the localized
homepage, English translation, Japanese translation, sidebar split, and locale
configuration commits.

### Task 8: Final Review Notes

**Files:**

- Review: `src/en/essay/2026-OSS-NA/README.md`
- Review: `src/ja/essay/2026-OSS-NA/README.md`
- Review: `src/.vuepress/config.ts`
- Review: `src/.vuepress/theme.ts`
- Review: `src/.vuepress/sidebars/*.ts`

- [ ] **Step 1: Review translated article consistency**

Check these points manually:

- English and Japanese articles have the same event order as the source.
- External links match the source.
- All 13 images are present in each translation.
- The informal blog voice is preserved.
- No new technical claims were added.

- [ ] **Step 2: Review i18n behavior**

If a local preview is needed, run:

```bash
pnpm run dev
```

Then open the local URL shown by VuePress and check:

- `/essay/2026-OSS-NA/`
- `/en/essay/2026-OSS-NA/`
- `/ja/essay/2026-OSS-NA/`

Expected: pages render, sidebars are locale-specific, and the language switcher
appears in the navbar.

- [ ] **Step 3: Prepare final summary**

Summarize:

- files created;
- files modified;
- build command and result;
- lint command and result;
- any remaining limitation around blog/feed locale grouping.
