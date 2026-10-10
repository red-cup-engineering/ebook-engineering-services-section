import { test } from "node:test";
import assert from "node:assert/strict";
import { lintManuscript } from "../src/lint-manuscript.mjs";

const refs = "---\nreferences:\n  a2026:\n    type: webpage\n    title: A source\n---\n";

test("a manuscript with one heading per chapter and resolved citations passes", () => {
  const result = lintManuscript([
    { path: "00.md", text: `${refs}# One\n\nThe market was $15 million [@a2026].\n` },
    { path: "01.md", text: "# Two\n\nPlain prose.\n" },
  ], { minWords: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test("an undefined citation and a missing chapter heading are errors", () => {
  const result = lintManuscript([{ path: "00.md", text: "No heading here [@missing].\n" }], { minWords: 1 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map((finding) => finding.rule).sort(), ["one-chapter-heading", "undefined-citation"]);
});

test("an uncited figure, a forecast and an unused reference are warnings", () => {
  const result = lintManuscript([{ path: "00.md", text: `${refs}# One\n\nRevenue was 93% lower. Prices will double.\n` }], { minWords: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings.map((finding) => finding.rule).sort(), ["figure-without-citation", "prophecy", "uncited-reference"]);
});

test("a study-guide chapter needs its objectives, questions and as many answers", () => {
  const front = { path: "00-about.md", text: "# About {.unnumbered}\n\nThis is an independent study companion, not endorsed by the course owner.\n" };
  const good = { path: "01-one.md", text: "# One\n\n## What you will be able to do\n\n- Explain a thing.\n\n## Check yourself\n\n1. First?\n2. Second?\n\n## Answers\n\n1. Yes.\n2. No.\n" };
  assert.equal(lintManuscript([front, good], { minWords: 1, profile: "study-guide" }).ok, true);
  const short = { path: "01-one.md", text: "# One\n\n## What you will be able to do\n\n- Explain.\n\n## Check yourself\n\n1. First?\n2. Second?\n\n## Answers\n\n1. Yes.\n" };
  assert.deepEqual(lintManuscript([front, short], { minWords: 1, profile: "study-guide" }).findings.filter((f) => f.severity === "error").map((f) => f.rule), ["study-guide-answers"]);
  const noNotice = { path: "00-about.md", text: "# About {.unnumbered}\n\nA book.\n" };
  assert.deepEqual(lintManuscript([noNotice, good], { minWords: 1, profile: "study-guide" }).findings.filter((f) => f.severity === "error").map((f) => f.rule), ["independence-notice"]);
});
test("a reference that lists et al. as an author is an error", () => {
  const text = "---\nreferences:\n  x2001:\n    title: X\n    author:\n      - family: Beck\n        given: Kent\n      - literal: et al.\n---\n# One\n\nCited [@x2001].\n";
  assert.deepEqual(lintManuscript([{ path: "00.md", text }], { minWords: 1 }).findings.map((f) => f.rule), ["et-al-author"]);
});
test("a figure-like string inside inline code is not a figure", () => {
  const result = lintManuscript([{ path: "00.md", text: "# One\n\nLock the row with `=B2/$C$1` before copying.\n" }], { minWords: 1 });
  assert.deepEqual(result.findings, []);
});
test("a study guide's worked examples and answers may use invented figures; its teaching prose may not", () => {
  const front = { path: "00-about.md", text: "# About {.unnumbered}\n\nAn independent study companion.\n" };
  const chapter = { path: "01-one.md", text: "# One\n\n## What you will be able to do\n\n- Add.\n\nMost projects run 20% over.\n\n## Worked example\n\nThe budget is $12,000.\n\n## Check yourself\n\n1. What is 5% of $100?\n\n## Answers\n\n1. $5.\n" };
  const figures = lintManuscript([front, chapter], { minWords: 1, profile: "study-guide" }).findings.filter((f) => f.rule === "figure-without-citation");
  assert.deepEqual(figures.map((f) => f.message), ["Most projects run 20% over."]);
});

const bible = {
  type: "StoryBible", version: 1,
  signature: {
    characters: [{ id: "mei", name: "Mei Lin", pov: true }, { id: "sam", name: "Sam Okafor", pov: true }, { id: "ma", name: "Ma", aliases: ["Auntie Rui"] }],
    places: [{ id: "duluth", name: "Duluth" }],
    lexicon: ["Lake Superior"],
  },
  retired: ["Wen"],
  locales: { povAlternates: true },
  arc: ["meeting", "longing", "declaration", "together"],
  knowledge: [{ id: "letter", holder: "sam", learner: "mei", fact: "He wrote the letter." }],
  refusals: [{ id: "wrist-grab", pattern: "grab(?:bed|s)? (?:her|his) wrist", reason: "consent-forward restraint" }],
};
const chapter = (n, fm, prose) => ({ path: `0${n}.md`, text: `---\n${fm}\n---\n# Chapter ${n}\n\n${prose}\n` });

test("a fiction manuscript that keeps its story bible passes, without the nonfiction rules", () => {
  const result = lintManuscript([
    { path: "00-front.md", text: "# Front {.unnumbered}\n\nFor Ma.\n" },
    chapter(1, "pov: mei\nwhen: 2025-11-01\nbeat: meeting", "The ice on Lake Superior will hold, said Mei Lin. It cost $5 and she met Sam Okafor in Duluth."),
    chapter(2, "pov: sam\nwhen: 2025-11-03\nbeat: longing", "He had loved her for years and asked Auntie Rui nothing."),
    chapter(3, "pov: mei\nwhen: 2025-12-24\nbeat: together\nreveals: [letter]", "He told her about the letter, and she said yes."),
  ], { minWords: 1, profile: "fiction", storyBible: bible });
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
});

test("the fiction profile reads signature, coherence, descent, normalization and knowledge", () => {
  const result = lintManuscript([
    chapter(1, "pov: ma\nwhen: 2025-11-05\nbeat: longing", "Wen grabbed her wrist and walked toward Hibbing."),
    chapter(2, "pov: sam\nwhen: 2025-11-01\nbeat: meeting", "They met again."),
    chapter(3, "pov: sam\nwhen: 2025-11-09\nbeat: declaration", "He said it."),
  ], { minWords: 1, profile: "fiction", storyBible: bible });
  assert.deepEqual(result.findings.map((f) => `${f.severity}:${f.rule}`).sort(), [
    "error:arc-order", "error:arc-termination", "error:chronology", "error:knowledge", "error:pov", "error:refusal", "error:retired-name",
    "warning:pov-alternation", "warning:unknown-name",
  ]);
});

test("an in-progress serial warns for its open arc and unrevealed secrets", () => {
  const result = lintManuscript([
    chapter(1, "episode: 1\npov: mei\nwhen: 2025-11-01\nbeat: meeting", "Mei Lin met Sam Okafor in Duluth."),
  ], { minWords: 1, profile: "fiction", storyBible: bible, serialInProgress: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings.filter((finding) => ["arc-termination", "knowledge"].includes(finding.rule)).map((finding) => `${finding.severity}:${finding.rule}`).sort(), [
    "warning:arc-termination", "warning:knowledge",
  ]);
});

test("the fiction profile refuses to run without a story bible", () => {
  assert.deepEqual(lintManuscript([chapter(1, "pov: mei", "Prose.")], { minWords: 1, profile: "fiction" }).findings.filter((f) => f.severity === "error").map((f) => f.rule), ["story-bible"]);
});

test("the fiction profile warns when a foreign lexicon term lacks a pronunciation", () => {
  const marked = structuredClone(bible);
  marked.signature.lexicon.push({ term: "jook", foreign: true }, { term: "lai see", foreign: true });
  marked.pronunciations = [{ term: "jook", ipa: "tsʊk̚" }];
  const result = lintManuscript([
    chapter(1, "pov: mei\nwhen: 2025-11-01\nbeat: meeting", "Mei Lin met Sam Okafor."),
    chapter(2, "pov: sam\nwhen: 2025-11-02\nbeat: together\nreveals: [letter]", "He revealed the letter."),
  ], { minWords: 1, profile: "fiction", storyBible: marked });
  assert.deepEqual(result.findings.filter((f) => f.rule === "foreign-pronunciation").map((f) => f.message), ["lai see is marked foreign in the story-bible lexicon but has no pronunciation"]);
});
