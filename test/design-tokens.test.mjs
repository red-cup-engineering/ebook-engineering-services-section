import { test } from "node:test";
import assert from "node:assert/strict";
import { bookStylesheet, designTokenStyle } from "../src/ebook-production.mjs";

const TOKENS = {
  color: {
    $type: "color",
    ink: { $value: { colorSpace: "srgb", components: [0.04, 0.04, 0.04], hex: "#0A0A0A" } },
    witness: { $value: { colorSpace: "srgb", components: [0.24, 0.33, 0.53], hex: "#3d5588" } },
  },
  font: {
    family: {
      sans: { $type: "fontFamily", $value: ["Space Grotesk", "Helvetica Neue", "sans-serif"] },
      slab: { $type: "fontFamily", $value: ["Roboto Slab", "Georgia", "serif"] },
      mono: { $type: "fontFamily", $value: ["JetBrains Mono", "monospace"] },
    },
  },
  type: {
    "display-1": { $type: "typography", $value: { fontFamily: "{font.family.sans}", lineHeight: 0.85 } },
    "body-1": { $type: "typography", $value: { fontFamily: "{font.family.slab}", lineHeight: 1.5 } },
    metadata: { $type: "typography", $value: { fontFamily: "{font.family.mono}", lineHeight: 1.4 } },
  },
};

test("designTokenStyle resolves the book roles through DTCG aliases", () => {
  const style = designTokenStyle(TOKENS);
  assert.deepEqual(style.stacks.body, ["Roboto Slab", "Georgia", "serif"]);
  assert.deepEqual(style.stacks.display, ["Space Grotesk", "Helvetica Neue", "sans-serif"]);
  assert.deepEqual(style.stacks.mono, ["JetBrains Mono", "monospace"]);
  assert.equal(style.ink, "0A0A0A");
  assert.equal(style.accent, "3D5588");
  assert.equal(style.bodyLineHeight, 1.5);
});

test("designTokenStyle names the missing token rather than guessing", () => {
  const { metadata: _metadata, ...type } = TOKENS.type;
  assert.throws(() => designTokenStyle({ ...TOKENS, type }), /type\.metadata/u);
});

test("bookStylesheet appends token-derived rules after the base so they win the cascade", () => {
  const css = bookStylesheet("body { font-family: serif; }\n", designTokenStyle(TOKENS));
  assert.ok(css.startsWith("body { font-family: serif; }"));
  assert.match(css, /font-family: "Roboto Slab", "Georgia", serif;/u);
  assert.match(css, /h1, h2, h3, h4 \{ font-family: "Space Grotesk", "Helvetica Neue", sans-serif;/u);
  assert.match(css, /a \{ color: #3D5588; \}/u);
  assert.match(css, /text-indent: 0/u);
});

const NOVEL = {
  ...TOKENS,
  $extensions: { "org.561.group": { book: { paragraphs: "indented", sceneBreak: "⁂", chapterLabel: "number", chapterAlign: "center", chapterWeight: "display", titleGround: "cover", contents: false, runningHeads: "small-caps", rectoHead: "chapter", colophon: "plain", coverAlign: "center" } } },
  color: { ...TOKENS.color, "cover-ground": { $value: { colorSpace: "srgb", hex: "#1f3a5f" } }, "cover-ink": { $value: { colorSpace: "srgb", hex: "#f4efe6" } } },
};

test("a book's theme defaults to the Group's look and reads every setting its tokens declare", () => {
  const plain = designTokenStyle(TOKENS);
  assert.deepEqual({ ...plain.book }, { paragraphs: "spaced", chapterLabel: "chapter", chapterAlign: "left", chapterWeight: "bold", titleGround: "accent", contents: true, runningHeads: "italic", rectoHead: "section", colophon: "build-record", coverAlign: "left", dropCaps: false, sceneBreak: "rule", chapterArt: "none" });
  assert.equal(plain.cover, null);
  const novel = designTokenStyle(NOVEL);
  assert.equal(novel.book.paragraphs, "indented");
  assert.equal(novel.book.sceneBreak, "⁂");
  assert.equal(novel.book.contents, false);
  assert.deepEqual({ ...novel.cover }, { ground: "1F3A5F", ink: "F4EFE6" });
});

test("a book theme names a setting it cannot honor rather than guessing", () => {
  const withBook = (book) => ({ ...TOKENS, $extensions: { "org.561.group": { book } } });
  assert.throws(() => designTokenStyle(withBook({ paragraphs: "double" })), /paragraphs must be one of spaced, indented/u);
  assert.throws(() => designTokenStyle(withBook({ dropCaps: "yes" })), /dropCaps must be one of false, true/u);
  assert.throws(() => designTokenStyle(withBook({ sceneBreak: "" })), /sceneBreak/u);
});

test("bookStylesheet adds the theme's rules after the Group's, and nothing for the default theme", () => {
  const plain = bookStylesheet("body {}", designTokenStyle(TOKENS));
  assert.ok(!plain.includes("book's theme"));
  const novel = bookStylesheet("body {}", designTokenStyle(NOVEL));
  assert.ok(novel.startsWith(plain));
  assert.match(novel, /p \{ text-indent: 1\.2em; margin: 0; \}/u);
  assert.match(novel, /hr::after \{ content: "⁂"; \}/u);
  assert.match(novel, /h1 \{ text-align: center; \}/u);
});
