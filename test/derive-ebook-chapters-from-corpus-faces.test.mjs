import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveSetOfChaptersFromCorpus, operation } from "../scripts/derive-ebook-chapters-from-corpus.mjs";

test("derives a two-part-title-and-section book from one fixture section", async () => {
  const root = mkdtempSync(join(tmpdir(), "derive-chapters-face-"));
  const fixture = join(root, "example-fixture-section-services-section");
  const chaptersDir = join(root, "example-chapters");
  mkdirSync(fixture);
  writeFileSync(join(fixture, "README.md"), "# Example fixture\n", "utf8");
  const input = { parts: [{ title: "Example Part", roots: [fixture] }], title: "Example Book", author: "Example Author", chaptersDir };
  const output = { type: "DerivedChapterSet", version: 1, chaptersDir, chapterFiles: ["000-example-part-part-title.md", "001-example-fixture-section.md"], manifest: { slug: "example-book", title: "Example Book", author: "Example Author", bookDir: chaptersDir } };
  try {
    const importedOutput = await deriveSetOfChaptersFromCorpus(input);
    assert.deepEqual(importedOutput, output);
    const declaredOutput = await operation.operation(input);
    assert.deepEqual(declaredOutput, importedOutput);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
