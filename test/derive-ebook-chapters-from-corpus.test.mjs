import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSetOfChaptersFromCorpus } from "../scripts/derive-ebook-chapters-from-corpus.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "derive-set-of-chapters-from-corpus-test-"));
}

/**
 * Build a small fixture services-section on disk: README, package.json,
 * a glossary term, a leader character, a note, and a data record.
 */
function buildFixtureSection(root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# Fixture Section\n\nA fixture for tests.\n", "utf8");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "@red-cup-engineering/fixture-section", version: "0.1.0", dependencies: {} }, null, 2),
    "utf8",
  );
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "read-fixture.mjs"), "export function readFixture() { return true; }\n", "utf8");
  mkdirSync(join(root, "apps"), { recursive: true });
  writeFileSync(join(root, "apps", "fixture-cli.mjs"), "// fixture app\n", "utf8");
  mkdirSync(join(root, "content", "text", "glossary", "terms"), { recursive: true });
  writeFileSync(join(root, "content", "text", "glossary", "terms", "widget.md"), "---\ntitle: Widget\n---\n\nA widget.\n", "utf8");
  mkdirSync(join(root, "content", "text", "documents", "articles", "notes", "2026", "09", "04"), { recursive: true });
  writeFileSync(
    join(root, "content", "text", "documents", "articles", "notes", "2026", "09", "04", "a-fixture-note.md"),
    "---\ntitle: A Fixture Note\n---\n\nFixture note body.\n",
    "utf8",
  );
  mkdirSync(join(root, "lib", "agency", "characters"), { recursive: true });
  writeFileSync(
    join(root, "lib", "agency", "characters", "leader.json"),
    JSON.stringify({ name: "Fixture Leader", office: "fixture officer" }, null, 2),
    "utf8",
  );
  mkdirSync(join(root, "data", "records"), { recursive: true });
  writeFileSync(join(root, "data", "records", "a-record.json"), JSON.stringify({ ok: true }), "utf8");
}

function buildThinFixtureSection(root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "content-only.md"), "placeholder\n", "utf8");
}

test("deriveSetOfChaptersFromCorpus throws naming the missing field for invalid input", async () => {
  await assert.rejects(
    () => deriveSetOfChaptersFromCorpus({ title: "T", author: "A" }),
    (error) => error instanceof TypeError && /parts/.test(error.message) && /chaptersDir/.test(error.message),
  );
});

test("deriveSetOfChaptersFromCorpus renders every carrier kind from real fixture files, never authoring prose", async () => {
  const sectionRoot = join(makeTempDir(), "fixture-section-services-section");
  const chaptersDir = makeTempDir();
  try {
    buildFixtureSection(sectionRoot);
    const result = await deriveSetOfChaptersFromCorpus({
      parts: [{ title: "Test Part", roots: [sectionRoot] }],
      title: "Fixture Book",
      author: "561 Group",
      chaptersDir,
    });

    assert.equal(result.type, "DerivedChapterSet");
    assert.equal(result.manifest.slug, "fixture-book");
    assert.equal(result.manifest.bookDir, chaptersDir);
    assert.equal(result.chapterFiles.length, 2); // part-title divider + one section chapter

    const sectionChapterPath = join(chaptersDir, result.chapterFiles[1]);
    const text = readFileSync(sectionChapterPath, "utf8");
    assert.match(text, /^---\ntitle: "Fixture Section"\n---\n\n/);
    assert.match(text, /A fixture for tests\./); // README verbatim
    assert.match(text, /name: `@red-cup-engineering\/fixture-section`/);
    assert.match(text, /version: `0\.1\.0`/);
    assert.match(text, /Fixture Leader, fixture officer/);
    assert.match(text, /scripts\/read-fixture\.mjs/);
    assert.match(text, /apps\/fixture-cli\.mjs/);
    assert.match(text, /terms: 1/);
    assert.match(text, /a-fixture-note\.md/);
    assert.match(text, /a-record\.json/);
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
  }
});

test("deriveSetOfChaptersFromCorpus reports absent carriers plainly for a thin section", async () => {
  const sectionRoot = join(makeTempDir(), "thin-section-services-section");
  const chaptersDir = makeTempDir();
  try {
    buildThinFixtureSection(sectionRoot);
    const result = await deriveSetOfChaptersFromCorpus({
      parts: [{ title: "Thin Part", roots: [sectionRoot] }],
      title: "Thin Book",
      author: "561 Group",
      chaptersDir,
    });
    const text = readFileSync(join(chaptersDir, result.chapterFiles[1]), "utf8");
    assert.match(text, /\(no README present\)/);
    assert.match(text, /\(no package\.json present\)/);
    assert.match(text, /\(no character seated\)/);
    assert.match(text, /\(no notes present\)/);
    assert.match(text, /\(no dated records present\)/);
    assert.match(text, /terms: 0/);
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
  }
});

test("deriveSetOfChaptersFromCorpus honors an explicit carriers subset", async () => {
  const sectionRoot = join(makeTempDir(), "fixture-section-services-section");
  const chaptersDir = makeTempDir();
  try {
    buildFixtureSection(sectionRoot);
    const result = await deriveSetOfChaptersFromCorpus({
      parts: [{ title: "Test Part", roots: [sectionRoot] }],
      carriers: ["readme"],
      title: "Narrow Book",
      author: "561 Group",
      chaptersDir,
    });
    const text = readFileSync(join(chaptersDir, result.chapterFiles[1]), "utf8");
    assert.match(text, /## README/);
    assert.doesNotMatch(text, /## Package/);
    assert.doesNotMatch(text, /## Glossary/);
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
  }
});

test("deriveSetOfChaptersFromCorpus falls back to a character's disposition's first sentence when no office/role field is recorded", async () => {
  const sectionRoot = join(makeTempDir(), "no-office-section-services-section");
  const chaptersDir = makeTempDir();
  try {
    mkdirSync(join(sectionRoot, "lib", "agency", "characters"), { recursive: true });
    writeFileSync(
      join(sectionRoot, "lib", "agency", "characters", "leader.json"),
      JSON.stringify({ name: "No Office Leader", disposition: "Keeps the ledger honest. Never rounds early." }),
      "utf8",
    );
    const result = await deriveSetOfChaptersFromCorpus({
      parts: [{ title: "Test Part", roots: [sectionRoot] }],
      carriers: ["characters"],
      title: "No Office Book",
      author: "561 Group",
      chaptersDir,
    });
    const text = readFileSync(join(chaptersDir, result.chapterFiles[1]), "utf8");
    assert.match(text, /No Office Leader, Keeps the ledger honest\./);
    assert.doesNotMatch(text, /Never rounds early/); // only the first sentence is used
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
  }
});

test("deriveSetOfChaptersFromCorpus embeds front-matter and appendix notes verbatim, in given order", async () => {
  const sectionRoot = join(makeTempDir(), "fixture-section-services-section");
  const chaptersDir = makeTempDir();
  const notesDir = makeTempDir();
  try {
    buildFixtureSection(sectionRoot);
    const frontMatterNotePath = join(notesDir, "front-matter-note.md");
    const appendixNotePathA = join(notesDir, "appendix-a.md");
    const appendixNotePathB = join(notesDir, "appendix-b.md");
    writeFileSync(frontMatterNotePath, "# Front Matter Note\n\nFront matter body.\n", "utf8");
    writeFileSync(appendixNotePathA, "# Appendix A\n\nAppendix A body.\n", "utf8");
    writeFileSync(appendixNotePathB, "# Appendix B\n\nAppendix B body.\n", "utf8");

    const result = await deriveSetOfChaptersFromCorpus({
      parts: [{ title: "Test Part", roots: [sectionRoot] }],
      title: "Book With Notes",
      author: "561 Group",
      chaptersDir,
      frontMatterNotePaths: [frontMatterNotePath],
      appendixNotePaths: [appendixNotePathA, appendixNotePathB],
    });

    assert.equal(result.chapterFiles.length, 4); // front matter + part title + section + appendix
    assert.match(result.chapterFiles[0], /front-matter/);
    assert.match(result.chapterFiles[result.chapterFiles.length - 1], /appendix/);

    const frontMatterText = readFileSync(join(chaptersDir, result.chapterFiles[0]), "utf8");
    assert.match(frontMatterText, /Front matter body\./);

    const appendixText = readFileSync(join(chaptersDir, result.chapterFiles[result.chapterFiles.length - 1]), "utf8");
    const indexA = appendixText.indexOf("Appendix A body.");
    const indexB = appendixText.indexOf("Appendix B body.");
    assert.ok(indexA >= 0 && indexB >= 0 && indexA < indexB, "appendix notes appear in given order");
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
    rmSync(notesDir, { recursive: true, force: true });
  }
});

test("deriveSetOfChaptersFromCorpus preserves a verbatim note's own YAML frontmatter line breaks, never reflowing them into one line", async () => {
  const sectionRoot = join(makeTempDir(), "fixture-section-services-section");
  const chaptersDir = makeTempDir();
  const notesDir = makeTempDir();
  try {
    buildFixtureSection(sectionRoot);
    const noteWithFrontmatterPath = join(notesDir, "note-with-frontmatter.md");
    writeFileSync(
      noteWithFrontmatterPath,
      "---\ntitle: A Note\ndescription: has its own frontmatter\ndate: 2026-09-04\nkeywords:\n  - one\n  - two\n---\n\n# A Note\n\nBody text.\n",
      "utf8",
    );
    const result = await deriveSetOfChaptersFromCorpus({
      parts: [{ title: "Test Part", roots: [sectionRoot] }],
      title: "Book With Nested Frontmatter",
      author: "561 Group",
      chaptersDir,
      frontMatterNotePaths: [noteWithFrontmatterPath],
    });
    const frontMatterText = readFileSync(join(chaptersDir, result.chapterFiles[0]), "utf8");
    assert.match(frontMatterText, /\ndescription: has its own frontmatter\n/);
    assert.match(frontMatterText, /\ndate: 2026-09-04\n/);
    assert.doesNotMatch(frontMatterText, /description: has its own frontmatter date:/); // never joined onto one line
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
    rmSync(notesDir, { recursive: true, force: true });
  }
});

test("deriveSetOfChaptersFromCorpus's manifest carries style through untouched", async () => {
  const sectionRoot = join(makeTempDir(), "fixture-section-services-section");
  const chaptersDir = makeTempDir();
  try {
    buildFixtureSection(sectionRoot);
    const style = { brand: "Causeway Services", division: "Tide Table Financial" };
    const result = await deriveSetOfChaptersFromCorpus({
      parts: [{ title: "Test Part", roots: [sectionRoot] }],
      title: "Styled Book",
      subtitle: "A Subtitle",
      author: "561 Group",
      chaptersDir,
      style,
    });
    assert.deepEqual(result.manifest.style, style);
    assert.equal(result.manifest.subtitle, "A Subtitle");
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
  }
});
