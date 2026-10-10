import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { describeEbookEditionSource, fabricateEbookEdition } from "../src/fabricate-ebook-edition.mjs";
import { sha256File } from "../src/ebook-production.mjs";

const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
const bookDir = resolve(TEST_ROOT, "fixtures/content/books/fixture-book");
const source = { slug: "fixture-book", title: "Fixture Book", author: "Test Author", bookDir, distDir: "/tmp/ebook-fabrication-test" };
const editionInputDigest = describeEbookEditionSource(source).editionInputDigest;
const workOrderDigest = `sha256:${"1".repeat(64)}`;
const span = (startLine) => ({ type: "ArtifactFabricationSourceSpan", startLine, endLine: startLine });

function candidate({ sourceDigest = workOrderDigest, editionDigest = editionInputDigest, projections = ["epub", "screen-pdf"], configuration = undefined, obligation = { id: "editorial-proof", kind: "review", statement: "Editorial proof acceptance is external to fabrication." } } = {}) {
  return {
    type: "ArtifactFabricationSpecificationCandidate", version: 1,
    source: { type: "ArtifactFabricationSource", version: 1, identity: { type: "ArtifactFabricationSourceIdentity", id: "fixture-book" }, provenance: { type: "ArtifactFabricationSourceProvenance", locator: "fixture-book", digest: sourceDigest, sourceSpan: span(1) } },
    artifact: { type: "FabricatedArtifactIdentity", version: 1, id: "fixture-book-edition", kind: "ebook-edition" },
    requirements: [{ type: "ArtifactFabricationRequirement", version: 1, id: "screen-reader-edition", statement: "Produces EPUB and screen PDF.", sourceSpan: span(2) }],
    prohibitions: [], openQuestions: [],
    constraints: [
      { type: "ArtifactFabricationConstraint", version: 1, id: "source-binding", kind: "law", authority: "SHA-256", revision: "FIPS 180-4", locator: "fips-180-4", applicability: "edition source", statement: "The admitted digest binds source bytes.", sourceSpan: span(3) },
      { type: "ArtifactFabricationConstraint", version: 1, id: "epub-standard", kind: "standard", authority: "W3C", revision: "EPUB 3.3", locator: "w3.org/TR/epub-33/", applicability: "EPUB projection", statement: "EPUB conformance requires a separate assay.", sourceSpan: span(4) },
    ],
    projections: projections.map((id, index) => ({ type: "ArtifactFabricationProjection", version: 1, id, target: id, configuration: configuration === undefined ? { profile: "epub-screen-pdf-v1", editionInputDigest: editionDigest } : configuration, sourceSpan: span(5 + index) })),
    acceptanceObligations: [{ type: "ArtifactFabricationAcceptanceObligation", version: 1, ...obligation, sourceSpan: span(7) }],
    traceability: [{ type: "ArtifactFabricationTrace", version: 1, requirementId: "screen-reader-edition", constraintIds: ["source-binding", "epub-standard"], projectionIds: projections, acceptanceObligationIds: [obligation.id] }],
  };
}

function successfulRenderer() {
  const directory = mkdtempSync(join(tmpdir(), "ebook-fabrication-test-"));
  const epubPath = join(directory, "fixture.epub");
  const pdfPath = join(directory, "fixture.pdf");
  writeFileSync(epubPath, "epub bytes");
  writeFileSync(pdfPath, "pdf bytes");
  return {
    renderer: async () => ({ pandocVersion: "pandoc 3.1.3", xelatexVersion: "XeTeX 3.141592653", artifacts: { epub: { path: epubPath, bytes: 10, sha256: sha256File(epubPath) }, pdf: { path: pdfPath, bytes: 9, sha256: sha256File(pdfPath) } } }),
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("refuses an edition input digest that does not match current manuscript bytes", async () => {
  const fake = successfulRenderer();
  const result = await fabricateEbookEdition(candidate({ editionDigest: `ni:///sha-256;${"A".repeat(43)}` }), source, { renderer: fake.renderer });
  fake.dispose();
  assert.equal(result.status, "refused");
  assert.equal(result.code, "EDITION_INPUT_DIGEST_MISMATCH");
});

test("refuses metadata that differs from the metadata bound into the admitted source digest", async () => {
  const fake = successfulRenderer();
  const result = await fabricateEbookEdition(candidate(), { ...source, title: "Changed Title" }, { renderer: fake.renderer });
  fake.dispose();
  assert.equal(result.code, "EDITION_INPUT_DIGEST_MISMATCH");
});

test("refuses a specification missing the screen-PDF projection", async () => {
  const fake = successfulRenderer();
  const result = await fabricateEbookEdition(candidate({ projections: ["epub"] }), source, { renderer: fake.renderer });
  fake.dispose();
  assert.equal(result.status, "refused");
  assert.equal(result.code, "MISSING_REQUIRED_PROJECTION");
});

test("refuses unknown projection configuration instead of silently ignoring it", async () => {
  const fake = successfulRenderer();
  const result = await fabricateEbookEdition(candidate({ configuration: { arbitraryExecutable: "nope" } }), source, { renderer: fake.renderer });
  fake.dispose();
  assert.equal(result.code, "MISSING_REQUIRED_PROJECTION");
});

test("refuses null and scalar projection configuration without throwing", async () => {
  for (const configuration of [null, "epub-screen-pdf-v1"]) {
    const fake = successfulRenderer();
    const result = await fabricateEbookEdition(candidate({ configuration }), source, { renderer: fake.renderer });
    fake.dispose();
    assert.equal(result.status, "refused");
    assert.equal(result.code, "MISSING_REQUIRED_PROJECTION");
  }
});

test("reports renderer failure without a fabrication receipt", async () => {
  const result = await fabricateEbookEdition(candidate(), source, { renderer: async () => { throw new Error("pandoc failed"); } });
  assert.equal(result.status, "failed");
  assert.equal(result.code, "RENDERER_FAILED");
  assert.equal("receipt" in result, false);
});

test("reports source disappearance during rendering as a typed failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ebook-fabrication-source-"));
  const copiedBook = join(directory, "book");
  cpSync(bookDir, copiedBook, { recursive: true });
  const copiedSource = { ...source, bookDir: copiedBook };
  const admittedDigest = describeEbookEditionSource(copiedSource).editionInputDigest;
  const fake = successfulRenderer();
  try {
    const result = await fabricateEbookEdition(candidate({ editionDigest: admittedDigest }), copiedSource, { renderer: async (...args) => { rmSync(copiedBook, { recursive: true, force: true }); return fake.renderer(...args); } });
    assert.equal(result.status, "failed");
    assert.equal(result.code, "SOURCE_UNAVAILABLE");
  } finally {
    fake.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not report a renderer's tampered artifact digest as realized evidence", async () => {
  const fake = successfulRenderer();
  try {
    const result = await fabricateEbookEdition(candidate(), source, { renderer: async (...args) => {
      const record = await fake.renderer(...args);
      record.artifacts.epub.sha256 = "0".repeat(64);
      return record;
    } });
    assert.equal(result.status, "failed");
    assert.equal(result.code, "ARTIFACT_EVIDENCE_MISMATCH");
  } finally { fake.dispose(); }
});

test("records actual artifact identities while leaving format and editorial acceptance pending", async () => {
  const fake = successfulRenderer();
  const result = await fabricateEbookEdition(candidate(), source, { renderer: fake.renderer });
  fake.dispose();
  assert.equal(result.status, "fabricated-awaiting-acceptance");
  assert.ok(isNiUri(result.artifacts.epub.sha256));
  assert.ok(isNiUri(result.artifacts.screenPdf.sha256));
  assert.equal(result.formatEvidence.epub.conformance, "unassayed");
  assert.equal(result.formatEvidence.screenPdf.printReadiness, "unassayed");
  assert.deepEqual(result.pendingAcceptanceObligationIds, ["editorial-proof"]);
});

test("leaves non-review technical obligations pending instead of fabricating acceptance", async () => {
  const fake = successfulRenderer();
  try {
    const result = await fabricateEbookEdition(candidate({ obligation: { id: "epubcheck", kind: "test", statement: "EPUBCheck must pass before release." } }), source, { renderer: fake.renderer });
    assert.equal(result.status, "fabricated-awaiting-acceptance");
    assert.deepEqual(result.pendingAcceptanceObligationIds, ["epubcheck"]);
    assert.equal("receipt" in result, false);
  } finally { fake.dispose(); }
});


test("asset admission observes Markdown images without treating fenced or inline examples as assets", () => {
  const directory = mkdtempSync(join(tmpdir(), "ebook-markdown-observation-"));
  try {
    const chapter = join(directory, "01-source.md");
    writeFileSync(chapter, "# Source\n\n~~~~md\n![example](hidden.png)\n~~~~\n`![inline](hidden.png)`\n");
    assert.equal(describeEbookEditionSource({ ...source, bookDir: directory }).type, "EbookEditionSourceDescription");
    writeFileSync(chapter, "# Source\n\n![actual][asset]\n\n[asset]: visible.png\n");
    assert.equal(describeEbookEditionSource({ ...source, bookDir: directory }).code, "UNDECLARED_EXTERNAL_ASSET");
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
