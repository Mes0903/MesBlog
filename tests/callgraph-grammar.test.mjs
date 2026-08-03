import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const grammar = JSON.parse(
  await readFile(
    new URL(
      "../src/.vuepress/shiki/callgraph.tmLanguage.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const entryPattern = grammar.patterns.find(
  ({ name }) => name === "meta.callgraph.entry",
);
const entry = new RegExp(entryPattern.match);

test("matches a source location without a project name", () => {
  const match = "[dix/window.c:2631] MapWindow(pWin, client)".match(entry);

  assert.ok(match);
  assert.equal(match[1], "dix/window.c");
  assert.equal(match[2], "2631");
  assert.equal(match[4], "MapWindow");
});

test("matches a project-qualified source location", () => {
  const match = "[Xorg: dix/window.c:2631] MapWindow(pWin, client)".match(
    entry,
  );

  assert.ok(match);
  assert.equal(match[1], "Xorg: dix/window.c");
  assert.equal(match[2], "2631");
  assert.equal(match[4], "MapWindow");
});

test("rejects multiple project qualifiers", () => {
  const match = "[Xorg: server: dix/window.c:2631] MapWindow(...)".match(entry);

  assert.equal(match, null);
});
