import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, readManifest } from "../apps/ebook-production-cli.mjs";

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

// Exercise the actual executable bytes outside the dependency workspace. Help
// and manifest parsing must not import the effectful rendering graph.
test("standalone CLI help works directly, by relative path, and through an installed-bin symlink", () => {
  const root = mkdtempSync(join(tmpdir(), "ebook-cli # "));
  try {
    const app = join(root, "apps", "ebook-production-cli.mjs");
    mkdirSync(dirname(app), { recursive: true });
    copyFileSync(fileURLToPath(new URL("../apps/ebook-production-cli.mjs", import.meta.url)), app);
    const bin = join(root, "ebook-production-cli");
    symlinkSync(app, bin);
    for (const entry of [app, "apps/ebook-production-cli.mjs", bin]) {
      for (const flag of ["--help", "-h"]) {
        const result = spawnSync(process.execPath, [entry, flag], { cwd: root, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /^usage: ebook-production-cli /);
        assert.equal(result.stderr, "");
      }
    }
    const missing = spawnSync(process.execPath, [bin], { cwd: root, encoding: "utf8" });
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stdout, /^usage: ebook-production-cli /);
    // Importing helper functions must not execute the entrypoint.
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(pathToFileURL(app).href)};`], { cwd: root, encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout, "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("resource and output overrides compose an immutable manuscript with external resources and writable output", () => {
  const root = mkdtempSync(join(tmpdir(), "ebook-composition-"));
  try {
    const file = join(root, "ebook.json");
    const authored = { slug: "existing-book", bookDir: ".", distDir: "data/state/editions", tokens: "../../old-monorepo/tokens.json", cover: "typographic" };
    writeFileSync(file, JSON.stringify(authored));
    const flags = parseArgs(["--manifest", file, "--tokens", "resources/house.tokens.json", "--dist", "output/existing-book"]);
    const manifest = readManifest(flags.manifestPath, flags);
    assert.equal(manifest.bookDir, root);
    assert.equal(manifest.tokens, resolve("resources/house.tokens.json"));
    assert.equal(manifest.distDir, resolve("output/existing-book"));
    assert.equal(manifest.cover, "typographic");
    assert.equal(readManifest(file).tokens, resolve(root, authored.tokens));
    assert.equal(readManifest(file).distDir, resolve(root, authored.distDir));
    assert.throws(() => parseArgs(["--tokens"]), /--tokens requires a path/);
    assert.throws(() => parseArgs(["--dist", "--manifest", file]), /--dist requires a path/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
