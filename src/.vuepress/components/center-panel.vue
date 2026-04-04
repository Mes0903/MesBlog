<script setup lang="ts">
const props = defineProps<{
  title?: string;
  width?: string;
  plain?: boolean;
  natural?: boolean;
}>();

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeAttr = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const isSafeHref = (value: string): boolean =>
  /^(https?:\/\/|mailto:|\/|\.\/|\.\.\/|#)/.test(value);

const renderTitle = (value: string): string => {
  const tokenPattern = /(`[^`\n]+`|\[[^\]\n]+\]\([^)]+\))/g;
  let html = "";
  let lastIndex = 0;

  for (const tokenMatch of value.matchAll(tokenPattern)) {
    const [segment] = tokenMatch;
    const index = tokenMatch.index ?? 0;

    html += escapeHtml(value.slice(lastIndex, index));

    if (segment.startsWith("`") && segment.endsWith("`")) {
      html += `<code>${escapeHtml(segment.slice(1, -1))}</code>`;
      lastIndex = index + segment.length;
      continue;
    }

    const linkMatch = segment.match(/^\[([^\]\n]+)\]\(([^)]+)\)$/);
    if (!linkMatch) {
      html += escapeHtml(segment);
      lastIndex = index + segment.length;
      continue;
    }

    const [, label, href] = linkMatch;
    if (!isSafeHref(href)) {
      html += escapeHtml(segment);
      lastIndex = index + segment.length;
      continue;
    }

    html += `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`;
    lastIndex = index + segment.length;
  }

  html += escapeHtml(value.slice(lastIndex));
  return html;
};
</script>

<template>
  <section
    class="center-panel"
    :class="{
      'center-panel--plain': props.plain,
      'center-panel--natural': props.natural,
    }"
    :style="props.width ? { '--center-panel-width': props.width } : undefined"
  >
    <p
      v-if="props.title"
      class="center-panel__title"
      v-html="renderTitle(props.title)"
    />
    <div class="center-panel__body">
      <slot />
    </div>
  </section>
</template>
