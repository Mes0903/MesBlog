# MesBlog Multilingual OSSNA Article Design

## Goal

Add English and Japanese versions of MesBlog, starting with the
`2026-OSS-NA` essay, while keeping the current Traditional Chinese URLs
stable.

## Current Context

MesBlog uses VuePress 2 with `vuepress-theme-hope`. The VuePress source root
is `src`, and the existing site content is currently laid out as a single
language:

```text
src/
  README.md
  essay/
    2026-OSS-NA/
      README.md
      image/
```

The current config has `lang: "en-US"` even though the root content is
Traditional Chinese. The current sidebar is a single global sidebar, and the
`2026-OSS-NA` entry uses a path that appears to include the repository path
instead of the site route.

VuePress 2 and `vuepress-theme-hope` both support multi-language sites through
locale route prefixes. The root locale can stay at `/`, while other languages
live under prefixed directories such as `/en/` and `/ja/`.

## User Decisions

The approved direction is:

- Keep Traditional Chinese as the root locale at `/`.
- Add English content under `/en/`.
- Add Japanese content under `/ja/`.
- Build localized homepages and essay entry points for English and Japanese.
- Translate the `2026-OSS-NA` article in the first implementation phase.
- Preserve the personal, informal blog voice, but localize English and
  Japanese naturally instead of translating sentence by sentence.

## URL Design

The first translated article should have these public URLs:

```text
/essay/2026-OSS-NA/       Traditional Chinese
/en/essay/2026-OSS-NA/    English
/ja/essay/2026-OSS-NA/    Japanese
```

Existing Traditional Chinese URLs must not move. This avoids breaking inbound
links, search results, and old references.

## Content Structure

Use a light mirrored structure for translated content:

```text
src/
  README.md
  essay/
    2026-OSS-NA/
      README.md
      image/
  en/
    README.md
    essay/
      2026-OSS-NA/
        README.md
  ja/
    README.md
    essay/
      2026-OSS-NA/
        README.md
```

Only translated pages should appear in the English and Japanese sidebars. Do
not create empty translated copies for the whole site.

## Asset Strategy

Do not duplicate the existing images. The English and Japanese article files
should reference the original image directory with relative paths from their
locale-specific page directories.

For example, from `src/en/essay/2026-OSS-NA/README.md`, an image can point
back to:

```markdown
![Talk room](../../../essay/2026-OSS-NA/image/talk-room.png)
```

This keeps the translated articles aligned with the source article and avoids
image drift.

## VuePress Site Config

Replace the single top-level `lang` setup in `src/.vuepress/config.ts` with
VuePress locale config:

```ts
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
}
```

The exact description text may stay shared in the first phase. If the user
later wants localized taglines, that can be handled in a smaller follow-up.

## Theme Config

Move locale-specific theme values into `hopeTheme({ locales: ... })`.

Shared theme settings should remain at the root of `theme.ts`:

- `hostname`
- `contributors`
- `author`
- `logo`
- `favicon`
- `repo`
- `repoDisplay`
- `docsDir`
- markdown features
- plugin settings that are not language-specific

Locale-specific settings should move under each locale:

- `sidebar`
- `blog.description`
- `footer`
- any future navbar labels

The initial sidebars should be:

- Traditional Chinese: current full sidebar, with the `2026-OSS-NA` path fixed.
- English: homepage and `essay/2026-OSS-NA/`.
- Japanese: homepage and `essay/2026-OSS-NA/`.

## Sidebar Organization

Split sidebar config by locale to avoid one large file growing in three languages:

```text
src/.vuepress/sidebars/
  zh.ts
  en.ts
  ja.ts
```

Then import those sidebars in `theme.ts`. The existing `sidebar.ts` can either
become a compatibility export for `zh.ts`, or be replaced by the new split
files during implementation. The implementation should keep the change
mechanical and avoid unrelated sidebar redesign.

## Homepage Design

Keep the current Traditional Chinese homepage unchanged except for locale correctness.

Create minimal English and Japanese homepages using the same blog layout pattern:

```markdown
---
home: true
title: Mes's Blog
layout: Blog
bgImage: /kikuri.jpg
icon: house
heroFullScreen: true
---
```

Localized `heroText` and `tagline` can be added if they read naturally. The
first phase does not need a full localized marketing-style homepage.

## Translation Style

The translated articles should keep the original essay's character:

- Personal travel diary and conference reflection.
- Informal, candid, and occasionally self-deprecating.
- Technical names, project names, and people names should stay accurate.
- English and Japanese should read naturally to their target readers.
- `XD` and similar expressions may be preserved where they feel intentional,
  but overuse should be smoothed out in translation.
- Image alt text should be translated into each target language.

The implementation should not invent new facts or expand the article with new commentary.

## Blog And Feed Behavior

The first phase should make sure English and Japanese pages build and appear in
the corresponding locale navigation. If the global blog/feed plugin groups all
locales together by default, that behavior should be verified during
implementation.

If per-locale blog lists require additional theme/plugin configuration, the
implementation should use the smallest working setup and document any remaining
limitation.

## Validation

After implementation, run:

```bash
pnpm run build:vite
```

Then verify the generated site includes:

- `/essay/2026-OSS-NA/`
- `/en/`
- `/en/essay/2026-OSS-NA/`
- `/ja/`
- `/ja/essay/2026-OSS-NA/`

Also verify:

- language switcher appears and points to the expected locale roots or routes;
- sidebars show only translated pages for English and Japanese;
- all article images render in English and Japanese pages;
- the Traditional Chinese URL remains unchanged;
- no obvious TypeScript config errors are introduced.

## Out Of Scope

This first phase does not include:

- translating the whole site;
- changing deployment hosting;
- replacing the blog theme;
- adding machine translation automation;
- duplicating image assets into each locale;
- rewriting the original Traditional Chinese article beyond small path or
  metadata fixes needed for i18n.
