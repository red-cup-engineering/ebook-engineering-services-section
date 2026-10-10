import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { parseManifest, listChapters, collectReferences, resolveStyle, sha256SourceHash } from "../src/ebook-production.mjs";
import { produceEbook } from "../scripts/produce-ebook.mjs";
import { produceSetOfEbooks } from "../scripts/produce-set-of-ebooks.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_BOOK_DIR = resolve(TEST_ROOT, "fixtures/content/books/fixture-book");
const FIXTURE_BOOK_WITH_REFERENCES_DIR = resolve(TEST_ROOT, "fixtures/content/books/fixture-book-with-references");

function makeDistDir() {
  return mkdtempSync(join(tmpdir(), "ebook-production-test-"));
}

test("parseManifest throws on a missing required field", () => {
  assert.throws(
    () => parseManifest({ title: "T", author: "A", bookDir: "/x", distDir: "/y" }),
    /slug/,
  );
});

test("parseManifest throws when given a non-object", () => {
  assert.throws(() => parseManifest(null), /manifest object/);
});

test("parseManifest normalizes and defaults pandocBin", () => {
  const parsed = parseManifest({
    slug: "s",
    title: "T",
    author: "A",
    bookDir: "/x",
    distDir: "/y",
  });
  assert.equal(parsed.pandocBin, "pandoc");
  assert.equal(parsed.slug, "s");
});

test("listChapters returns chapters sorted by filename", () => {
  const chapters = listChapters(FIXTURE_BOOK_DIR);
  assert.equal(chapters.length, 3);
  assert.ok(chapters[0].endsWith("01-opening.md"));
  assert.ok(chapters[1].endsWith("02-middle.md"));
  assert.ok(chapters[2].endsWith("03-closing.md"));
});

test("listChapters throws when a directory has no chapter Markdown", () => {
  const empty = makeDistDir();
  try {
    assert.throws(() => listChapters(empty), /no chapter Markdown/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("produceEbook builds a real EPUB and PDF and a well-shaped build record", async () => {
  const distDir = makeDistDir();
  try {
    const record = await produceEbook({
      slug: "fixture-book",
      title: "Fixture Book",
      subtitle: "A Small Test",
      author: "Test Author",
      bookDir: FIXTURE_BOOK_DIR,
      distDir,
    });

    assert.equal(record.type, "EbookBuildRecord");
    assert.equal(record.slug, "fixture-book");
    assert.equal(record.chapterSet.count, 3);
    assert.ok(isNiUri(record.chapterSet.sha256));
    assert.ok(isNiUri(record.template.sha256));
    assert.ok(isNiUri(record.sourceHash));
    assert.ok(record.pandocVersion.length > 0);
    assert.equal(record.cover, null);
    // books with no references build exactly as before: no reference fields set
    assert.equal(record.referencesCount, 0);
    assert.deepEqual(record.referenceIds, []);

    for (const artifactKey of ["epub", "pdf"]) {
      const artifact = record.artifacts[artifactKey];
      assert.ok(artifact.bytes > 0, `${artifactKey} should have nonzero bytes`);
      assert.ok(isNiUri(artifact.sha256));
    }
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("produceEbook's sourceHash is stable across two independent runs of the same source", async () => {
  const distDir1 = makeDistDir();
  const distDir2 = makeDistDir();
  try {
    const record1 = await produceEbook({
      slug: "fixture-book",
      title: "Fixture Book",
      author: "Test Author",
      bookDir: FIXTURE_BOOK_DIR,
      distDir: distDir1,
    });
    const record2 = await produceEbook({
      slug: "fixture-book",
      title: "Fixture Book",
      author: "Test Author",
      bookDir: FIXTURE_BOOK_DIR,
      distDir: distDir2,
    });
    assert.equal(record1.sourceHash, record2.sourceHash);
    assert.equal(record1.chapterSet.sha256, record2.chapterSet.sha256);
    assert.equal(record1.template.sha256, record2.template.sha256);
  } finally {
    rmSync(distDir1, { recursive: true, force: true });
    rmSync(distDir2, { recursive: true, force: true });
  }
});

test("produceSetOfEbooks splits successes and failures without aborting the batch", async () => {
  const distDir = makeDistDir();
  try {
    const { results, failures } = await produceSetOfEbooks([
      {
        slug: "fixture-book",
        title: "Fixture Book",
        author: "Test Author",
        bookDir: FIXTURE_BOOK_DIR,
        distDir,
      },
      {
        slug: "broken-book",
        title: "Broken Book",
        author: "Test Author",
        bookDir: "/does/not/exist",
        distDir,
      },
    ]);

    assert.equal(results.length, 1);
    assert.equal(results[0].slug, "fixture-book");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].slug, "broken-book");
    assert.ok(failures[0].error.length > 0);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("collectReferences returns an empty list for chapters with no frontmatter", () => {
  const { ids, items } = collectReferences(listChapters(FIXTURE_BOOK_DIR));
  assert.deepEqual(ids, []);
  assert.deepEqual(items, []);
});

test("collectReferences merges frontmatter references across chapters, first-seen order, deduping identical repeats", () => {
  const chapters = listChapters(FIXTURE_BOOK_WITH_REFERENCES_DIR);
  const { ids, items } = collectReferences(chapters);
  assert.deepEqual(ids, ["soriano2022", "thaweethai2023"]);
  assert.equal(items.length, 2);
  const soriano = items.find((item) => item.id === "soriano2022");
  assert.equal(soriano.type, "article-journal");
  assert.equal(soriano.DOI, "10.1016/S1473-3099(21)00703-9");
  const thaweethai = items.find((item) => item.id === "thaweethai2023");
  assert.equal(thaweethai["container-title"], "JAMA");
});

test("collectReferences throws naming the id and both files when a duplicate id's CSL-JSON items differ", () => {
  const dir = makeDistDir();
  try {
    const chapterA = join(dir, "01-a.md");
    const chapterB = join(dir, "02-b.md");
    writeFileSync(
      chapterA,
      "---\nreferences:\n  dupe:\n    id: dupe\n    type: article-journal\n    title: First version\n---\n\n# A\n",
      "utf8",
    );
    writeFileSync(
      chapterB,
      "---\nreferences:\n  dupe:\n    id: dupe\n    type: article-journal\n    title: Second, different version\n---\n\n# B\n",
      "utf8",
    );
    assert.throws(
      () => collectReferences([chapterA, chapterB]),
      (error) => error.message.includes("dupe") && error.message.includes(chapterA) && error.message.includes(chapterB),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectReferences accepts a duplicate id when both chapters' CSL-JSON items are identical", () => {
  const dir = makeDistDir();
  try {
    const chapterA = join(dir, "01-a.md");
    const chapterB = join(dir, "02-b.md");
    const body = "---\nreferences:\n  same:\n    id: same\n    type: article-journal\n    title: Identical version\n---\n\n# Chapter\n";
    writeFileSync(chapterA, body, "utf8");
    writeFileSync(chapterB, body, "utf8");
    const { ids, items } = collectReferences([chapterA, chapterB]);
    assert.deepEqual(ids, ["same"]);
    assert.equal(items.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("produceEbook renders [@id] citations and a References section via a real pandoc citeproc build", async () => {
  const distDir = makeDistDir();
  try {
    const record = await produceEbook({
      slug: "fixture-book-with-references",
      title: "Fixture Book With References",
      author: "Test Author",
      bookDir: FIXTURE_BOOK_WITH_REFERENCES_DIR,
      distDir,
    });

    assert.equal(record.referencesCount, 2);
    assert.deepEqual(record.referenceIds, ["soriano2022", "thaweethai2023"]);

    for (const artifactKey of ["epub", "pdf"]) {
      const artifact = record.artifacts[artifactKey];
      assert.ok(artifact.bytes > 0, `${artifactKey} should have nonzero bytes`);
      assert.ok(isNiUri(artifact.sha256));
    }

    const referencesJsonPath = join(distDir, "fixture-book-with-references-references.json");
    const writtenReferences = JSON.parse(readFileSync(referencesJsonPath, "utf8"));
    assert.equal(writtenReferences.length, 2);
    assert.deepEqual(
      writtenReferences.map((item) => item.id).sort(),
      ["soriano2022", "thaweethai2023"],
    );
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("resolveStyle applies house defaults when no style is given", () => {
  const style = resolveStyle();
  assert.equal(style.brand, "561 Group");
  assert.equal(style.division, null);
  assert.equal(style.fontFamily, "DejaVu Serif");
  assert.equal(style.accent, "6B2737");
  assert.equal(style.colophon, "A 561 Group book");
  assert.equal(style.imprint, style.colophon);
});

test("resolveStyle computes the Three Marks colophon with a division and default parent", () => {
  const style = resolveStyle({ brand: "Causeway Services", division: "Tide Table Financial" });
  assert.equal(style.colophon, "A Causeway Services book · Tide Table Financial · a division of the 561 Group");
});

test("resolveStyle omits the \"a division of\" clause for the 561 Group's own brand", () => {
  const style = resolveStyle({ brand: "the 561 Group", division: "561-group-economic-operations-services-section" });
  assert.equal(style.colophon, "The 561 Group's book · 561-group-economic-operations-services-section");
});

test("resolveStyle keeps an explicit style.colophon override verbatim", () => {
  const style = resolveStyle({ brand: "Causeway Services", division: "Tide Table Financial", colophon: "Custom quiet line" });
  assert.equal(style.colophon, "Custom quiet line");
  assert.equal(style.imprint, "Custom quiet line");
});

test("resolveStyle only overrides the fields a partial style object supplies", () => {
  const style = resolveStyle({ accent: "112233" });
  assert.equal(style.accent, "112233");
  assert.equal(style.fontFamily, "DejaVu Serif");
  assert.equal(style.brand, "561 Group");
});

test("sha256SourceHash changes when the css digest changes, holding chapters and template fixed", () => {
  const chapters = listChapters(FIXTURE_BOOK_DIR);
  const templateHash = "a".repeat(64);
  const withoutCss = sha256SourceHash(chapters, templateHash);
  const withCssA = sha256SourceHash(chapters, templateHash, "b".repeat(64));
  const withCssB = sha256SourceHash(chapters, templateHash, "c".repeat(64));
  assert.notEqual(withoutCss, withCssA);
  assert.notEqual(withCssA, withCssB);
});

test("sha256SourceHash is deterministic for the same chapters, template, and css digests", () => {
  const chapters = listChapters(FIXTURE_BOOK_DIR);
  const first = sha256SourceHash(chapters, "a".repeat(64), "b".repeat(64));
  const second = sha256SourceHash(chapters, "a".repeat(64), "b".repeat(64));
  assert.equal(first, second);
});

test("produceEbook's sourceHash changes when the css stylesheet changes, unchanged chapters and template", async () => {
  const distDir1 = makeDistDir();
  const distDir2 = makeDistDir();
  const altCssPath = join(distDir2, "alt.css");
  writeFileSync(altCssPath, "body { color: red; }\n", "utf8");
  try {
    const record1 = await produceEbook({
      slug: "fixture-book",
      title: "Fixture Book",
      author: "Test Author",
      bookDir: FIXTURE_BOOK_DIR,
      distDir: distDir1,
    });
    const record2 = await produceEbook({
      slug: "fixture-book",
      title: "Fixture Book",
      author: "Test Author",
      bookDir: FIXTURE_BOOK_DIR,
      distDir: distDir2,
      css: altCssPath,
    });
    assert.notEqual(record1.sourceHash, record2.sourceHash);
    assert.equal(record1.chapterSet.sha256, record2.chapterSet.sha256);
    assert.equal(record1.template.sha256, record2.template.sha256);
    assert.notEqual(record1.stylesheet.sha256, record2.stylesheet.sha256);
  } finally {
    rmSync(distDir1, { recursive: true, force: true });
    rmSync(distDir2, { recursive: true, force: true });
  }
});

test("produceEbook throws naming an uninstalled style.fontFamily rather than letting xelatex silently substitute", async () => {
  const distDir = makeDistDir();
  try {
    await assert.rejects(
      produceEbook({
        slug: "fixture-book",
        title: "Fixture Book",
        author: "Test Author",
        bookDir: FIXTURE_BOOK_DIR,
        distDir,
        style: { fontFamily: "Definitely Not An Installed Font Family XYZ" },
      }),
      /not installed on this box/,
    );
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("resolveStyle: the Group's own brand elides the article in the colophon", () => {
  const style = resolveStyle({ brand: "the 561 Group", division: "561-group-economic-operations-services-section" });
  assert.equal(style.colophon, "The 561 Group's book · 561-group-economic-operations-services-section");
});

test("an edition date is the build epoch, midnight UTC, and a malformed one is refused", async () => {
  const { editionEpochSeconds, parseManifest } = await import("../src/ebook-production.mjs");
  assert.equal(editionEpochSeconds("2026-09-27"), Date.UTC(2026, 8, 27) / 1000);
  const base = { slug: "b", title: "B", author: "A", bookDir: "/b", distDir: "/d" };
  assert.equal(parseManifest({ ...base, date: "2026-09-27" }).date, "2026-09-27");
  assert.equal(parseManifest(base).date, undefined);
  assert.throws(() => parseManifest({ ...base, date: "27 September 2026" }), /YYYY-MM-DD/);
});

test("a PDF's /ID is derived from its content, at the same length, so two builds that differ only there become identical", async () => {
  const { withDeterministicPdfIdentifier } = await import("../src/ebook-production.mjs");
  const pdf = (id) => Buffer.from(`%PDF-1.5\n1 0 obj<</Type/Catalog>>endobj\n9 0 obj<</Type/XRef/ID[<${id}><${id}>]/Size 10>>stream\nx\nendstream\nstartxref\n42\n%%EOF\n`, "latin1");
  const first = withDeterministicPdfIdentifier(pdf("e84af39773b461f71a49a7b622df0259"));
  const second = withDeterministicPdfIdentifier(pdf("d83f14b1dba353104e3994c7412230d0"));
  assert.deepEqual(first, second);
  assert.equal(first.length, pdf("e84af39773b461f71a49a7b622df0259").length);
  assert.doesNotMatch(first.toString("latin1"), /e84af397/);
  assert.match(first.toString("latin1"), /\/ID\[<([0-9a-f]{32})><\1>\]/);
  const other = withDeterministicPdfIdentifier(Buffer.from(pdf("e84af39773b461f71a49a7b622df0259").toString("latin1").replace("Catalog", "Katalog"), "latin1"));
  assert.notDeepEqual(other, first);
  assert.deepEqual(withDeterministicPdfIdentifier(Buffer.from("%PDF-1.4 no id")), Buffer.from("%PDF-1.4 no id"));
});

test("withDeterministicPdfIdentifier gives the same bytes whether xdvipdfmx wrote the /ID as hex or as a literal string", async () => {
  const { withDeterministicPdfIdentifier } = await import("../src/ebook-production.mjs");
  const body = "%PDF-1.5\n1 0 obj\n<</Type/Catalog>>\nendobj\n";
  const pdf = (id) => Buffer.from(`${body}2 0 obj\n<</Type/XRef/ID${id}/Root 1 0 R/Size 3>>\nstream\nxx\nendstream\nendobj\nstartxref\n${body.length}\n%%EOF\n`, "latin1");
  const fromHex = withDeterministicPdfIdentifier(pdf("[<5c03636ac8bf6e8f899dcb68606143d4><5c03636ac8bf6e8f899dcb68606143d4>]"));
  const fromLiteral = withDeterministicPdfIdentifier(pdf("[(dgN>A[\\020\\232}0|\\364fI\\036Z)(dgN>A[\\020\\232}0|\\364fI\\036Z)]"));
  assert.deepEqual(fromLiteral, fromHex);
  assert.match(fromHex.toString("latin1"), /\/ID\[<[0-9a-f]{32}><[0-9a-f]{32}>\]/u);
});
