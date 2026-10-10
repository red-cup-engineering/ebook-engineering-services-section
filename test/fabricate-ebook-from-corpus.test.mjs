import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSetOfChaptersFromCorpus } from "../scripts/derive-ebook-chapters-from-corpus.mjs";
import { fabricateEbookFromCorpus, parseArgs } from "../apps/fabricate-ebook-from-corpus.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "fabricate-ebook-from-corpus-test-"));
}

function buildFixtureSection(root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "# Fixture Section\n\nA fixture book source.\n", "utf8");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@red-cup-engineering/fixture-section", version: "0.1.0", dependencies: {} }), "utf8");
}

test("parseArgs reads --spec and --help", () => {
  assert.deepEqual(parseArgs(["--spec", "spec.json"]), { help: false, specPath: "spec.json" });
  assert.deepEqual(parseArgs(["--help"]), { help: true, specPath: undefined });
});

test("fabricateEbookFromCorpus throws without spec.distDir", async () => {
  await assert.rejects(() => fabricateEbookFromCorpus({ parts: [], title: "T", author: "A", chaptersDir: "/tmp/x" }), /distDir/);
});

test("fabricateEbookFromCorpus derives chapters then produces a real EPUB and PDF", async () => {
  const sectionRoot = join(makeTempDir(), "fixture-section-services-section");
  const chaptersDir = makeTempDir();
  const distDir = makeTempDir();
  try {
    buildFixtureSection(sectionRoot);
    const result = await fabricateEbookFromCorpus({
      parts: [{ title: "Test Part", roots: [sectionRoot] }],
      title: "Fabricated Book",
      author: "561 Group",
      chaptersDir,
      distDir,
    });

    assert.equal(result.chapters.type, "DerivedChapterSet");
    assert.equal(result.chapters.chapterFiles.length, 2);
    assert.equal(result.buildRecord.type, "EbookBuildRecord");
    assert.equal(result.buildRecord.slug, "fabricated-book");
    assert.ok(statSync(result.buildRecord.artifacts.epub.path).size > 0);
    assert.ok(statSync(result.buildRecord.artifacts.pdf.path).size > 0);
  } finally {
    rmSync(sectionRoot, { recursive: true, force: true });
    rmSync(chaptersDir, { recursive: true, force: true });
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("chapter facts come from the selected source without organizational schema or conformance", async () => {
  const root = makeTempDir();
  const sectionRoot = join(root, "ordinary-book-source");
  const chaptersDir = join(root, "chapters");
  try {
    buildFixtureSection(sectionRoot);
    for (const path of ["scripts/run.mjs", "scripts/nested/hidden.mjs", "apps/read.mts", "content/text/glossary/terms/one.md", "content/text/glossary/topics/two.md", "content/text/glossary/concepts/three.md", "services/child/content/text/glossary/terms/child.md", "data/records/item.json"]) {
      const file = join(sectionRoot, path);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "source fact", "utf8");
    }
    const result = await deriveSetOfChaptersFromCorpus({ parts: [{ title: "Source", roots: [sectionRoot] }], title: "Facts", author: "Author", chaptersDir, carriers: ["readme", "package", "code", "glossary", "data"] });
    const chapter = readFileSync(join(chaptersDir, result.chapterFiles[1]), "utf8");
    assert.match(chapter, /# Ordinary Book Source/u);
    assert.match(chapter, /A fixture book source\./u);
    assert.match(chapter, /- scripts: `scripts\/run\.mjs`/u);
    assert.match(chapter, /- apps: `apps\/read\.mts`/u);
    assert.match(chapter, /- terms: 1\n- topics: 1\n- concepts: 1/u);
    assert.match(chapter, /- `item\.json`/u);
    assert.doesNotMatch(chapter, /hidden|child|conformant|custody|laws/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
