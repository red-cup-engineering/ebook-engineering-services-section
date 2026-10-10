import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readManifest } from "../apps/ebook-production-cli.mjs";

test("an authored edition resolves its source and output beside the manifest, independently of cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "ebook-manifest-"));
  try {
    const file = join(root, "edition.json");
    writeFileSync(file, JSON.stringify({ slug: "example", bookDir: "chapters", distDir: "../../output", css: "/explicit/book.css" }));
    const edition = readManifest(file);
    assert.equal(edition.bookDir, join(root, "chapters"));
    assert.equal(edition.distDir, join(root, "../../output"));
    assert.equal(edition.css, "/explicit/book.css");
    assert.equal(edition.slug, "example");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
