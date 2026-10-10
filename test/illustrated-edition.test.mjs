import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { produceEbook } from "../scripts/produce-ebook.mjs";
import { describeEbookEditionSource } from "../src/fabricate-ebook-edition.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const run = async (file, args) => (await promisify(execFile)(file, args, { encoding: "utf8", maxBuffer: 10_000_000 })).stdout;

function tokens() {
  const font = (family) => ({ $type: "fontFamily", $value: family });
  return {
    color: { $type: "color", ink: { $value: { colorSpace: "srgb", hex: "#111111" } }, witness: { $value: { colorSpace: "srgb", hex: "#6B2737" } }, paper: { $value: { colorSpace: "srgb", hex: "#FFFFFF" } } },
    font: { family: { body: font(["DejaVu Serif", "serif"]), display: font(["DejaVu Sans", "sans-serif"]), mono: font(["FreeMono", "monospace"]) } },
    type: {
      "body-1": { $type: "typography", $value: { fontFamily: "{font.family.body}", lineHeight: 1.4 } },
      "display-1": { $type: "typography", $value: { fontFamily: "{font.family.display}", fontWeight: 500, lineHeight: 1 } },
      metadata: { $type: "typography", $value: { fontFamily: "{font.family.mono}", lineHeight: 1.2 } },
    },
    $extensions: { "org.561.group": { book: { chapterArt: "chapter", dropCaps: true } } },
  };
}

test("a declared PNG and TikZ chapter art are carried into EPUB and PDF with alt text and drop-cap CSS", async () => {
  const directory = mkdtempSync(join(tmpdir(), "illustrated-edition-"));
  try {
    const bookDir = join(directory, "book");
    const distDir = join(directory, "dist");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(bookDir, { recursive: true }));
    writeFileSync(join(bookDir, "illustration.png"), PNG);
    writeFileSync(join(bookDir, "chapter-art.tikz"), "\\draw[witness,line width=2pt] (0,0) circle (1);\\draw[ink] (-1,0)--(1,0);\n");
    writeFileSync(join(bookDir, "tokens.json"), JSON.stringify(tokens()));
    writeFileSync(join(bookDir, "01-opening.md"), "---\nart: chapter-art.tikz\n---\n\n# The Illustrated Opening\n\nWinter text survives the illustrated edition.\n\n![A red square used as a declared illustration](illustration.png)\n");
    const manifest = {
      slug: "illustrated-fixture", title: "Illustrated Fixture", author: "Test Author", date: "2026-09-27", bookDir, distDir,
      tokens: join(bookDir, "tokens.json"),
      assets: [
        { path: join(bookDir, "illustration.png"), alt: "A red square used as a declared illustration", role: "illustration" },
        { path: join(bookDir, "chapter-art.tikz"), alt: "A circular chapter ornament crossed by a line", role: "chapter-art" },
      ],
    };
    const described = describeEbookEditionSource(manifest);
    assert.equal(described.type, "EbookEditionSourceDescription");
    const record = await produceEbook(manifest);
    const listing = await run("unzip", ["-l", record.artifacts.epub.path]);
    assert.match(listing, /media\//u);
    const epubText = await run("unzip", ["-p", record.artifacts.epub.path]);
    assert.match(epubText, /A red square used as a declared illustration/u);
    assert.match(epubText, /A circular chapter ornament crossed by a line/u);
    assert.match(epubText, /drop-cap/u);
    assert.match(epubText, /chapter-art/u);
    const images = await run("pdfimages", ["-list", record.artifacts.pdf.path]);
    assert.match(images, /\bimage\b/u);
    const text = await run("pdftotext", [record.artifacts.pdf.path, "-"]);
    assert.match(text, /W\s*inter text survives the illustrated edition/u);
    assert.equal(record.assets.length, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("changing a declared asset changes the edition input digest", () => {
  const directory = mkdtempSync(join(tmpdir(), "asset-digest-"));
  try {
    writeFileSync(join(directory, "01.md"), "# Chapter\n\n![Alt](image.png)\n");
    writeFileSync(join(directory, "image.png"), PNG);
    const source = { slug: "asset", title: "Asset", author: "Author", bookDir: directory, distDir: join(directory, "dist"), assets: [{ path: join(directory, "image.png"), alt: "Alt", role: "illustration" }] };
    const before = describeEbookEditionSource(source).editionInputDigest;
    writeFileSync(join(directory, "image.png"), Buffer.concat([PNG, Buffer.from("changed")]));
    assert.notEqual(describeEbookEditionSource(source).editionInputDigest, before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
