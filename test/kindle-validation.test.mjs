import test from "node:test";
import { acceptEbookEdition } from "../src/accept-ebook-edition.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EPUB_VALIDATOR_PROFILES, acceptKindleRelease, assayRetailerPortability, validateKindleEdition, signKindleValidationReceipt, verifyKindleValidationReceipt } from "../src/kindle-validation.mjs";

const reflowable = Object.freeze({
  features: Object.freeze({ type: "EpubFeatureManifest", version: 1, mathml: false, scriptedContent: false, remoteResources: false, mediaOverlays: false, embeddedFonts: false, svg: false, fixedLayout: false, navigation: Object.freeze(["toc", "landmarks"]) }),
  navigation: Object.freeze({ type: "EpubNavigationAssay", version: 1, passed: true, checks: {}, findings: {} }),
});

test("exact EPUB and KDP cover bytes produce a signed publication-gate SignCell", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "kindle-validation-"));
  const epubPath = join(directory, "book.epub"), coverPath = join(directory, "cover.jpg");
  await writeFile(epubPath, "fixture epub"); await writeFile(coverPath, "fixture cover");
  const cell = await validateKindleEdition({ book: "fixture", epubPath, coverPath, validatedAt: "2026-09-29T00:00:00.000Z" }, {
    releaseTool: { available: true, command: "epubcheck", prefix: [], source: "fixture" }, toolVersion: "5.3.0",
    runCommand: async () => ({ status: 0, signal: null, stdout: "EPUBCheck 5.3.0", stderr: "" }),
    inspectEpub: async () => reflowable, skipObservation: true, exists: async () => false,
    metadata: async () => ({ width: 1600, height: 2560, space: "srgb", format: "jpeg" }),
  });
  assert.equal(cell.content.passed, true);
  assert.equal(cell.content.validatorProfile.id, "epub-3.3-epubcheck-5.3.0");
  assert.equal(cell.content.checks.accessibility.conformsTo, null);
  assert.equal(cell.content.checks.readingSystems.every(({ outcome }) => outcome === "untested"), true);
  assert.match(cell.id, /^ni:\/\/\/sha-256;/u);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = signKindleValidationReceipt(cell, privateKey, "fixture-key");
  assert.equal(verifyKindleValidationReceipt(signed, publicKey), true);
  const epubNi = `ni:///sha-256;${Buffer.from(cell.content.artifacts.epub.sha256, "hex").toString("base64url")}`;
  const editionInputDigest = "ni:///sha-256;fixture";
  const fabrication = {
    type: "EbookEditionFabricationResult", status: "fabricated-awaiting-acceptance",
    specification: { projections: [{ configuration: { editionInputDigest } }] },
    artifacts: { epub: { sha256: epubNi }, screenPdf: { sha256: "ni:///sha-256;screen-pdf" } },
    pendingAcceptanceObligationIds: ["editorial-proof", "epub-conformance"],
  };
  const editorialAcceptance = acceptEbookEdition(fabrication, {
    type: "EbookEditionProof", version: 1, editionInputDigest,
    artifacts: { epub: epubNi, screenPdf: fabrication.artifacts.screenPdf.sha256 },
    proofer: "fixture-reader", writer: "fixture-writer", findings: [],
    provedAt: "2026-09-29T00:00:00.000Z", method: "synthetic fixture",
  });
  assert.equal(editorialAcceptance.status, "partially-accepted");
  const releaseInput = { book: "fixture", fabrication, editorialAcceptance, validation: cell };
  const release = acceptKindleRelease(releaseInput);
  assert.equal(release.content.editionInputDigest, editionInputDigest);
  await t.test("rejects another edition's editorial proof", () => {
    assert.throws(() => acceptKindleRelease({ ...releaseInput, editorialAcceptance: { ...editorialAcceptance, editionInputDigest: "ni:///sha-256;another-edition" } }), /different edition input digest/);
  });
  await t.test("rejects fabrication without an edition input digest", () => {
    assert.throws(() => acceptKindleRelease({ ...releaseInput, fabrication: { ...fabrication, specification: {} } }), /different edition input digest/);
  });
  for (const kind of ["epub", "screenPdf"]) {
    const changedArtifacts = { ...editorialAcceptance.artifacts, [kind]: { sha256: "ni:///sha-256;another-build" } };
    await t.test(`rejects editorial proof of different ${kind} bytes`, () => {
      assert.throws(() => acceptKindleRelease({ ...releaseInput, editorialAcceptance: { ...editorialAcceptance, artifacts: changedArtifacts } }), new RegExp(`different ${kind} bytes`));
    });
    const missingArtifacts = { ...editorialAcceptance.artifacts };
    delete missingArtifacts[kind];
    await t.test(`rejects editorial acceptance without ${kind} bytes`, () => {
      assert.throws(() => acceptKindleRelease({ ...releaseInput, editorialAcceptance: { ...editorialAcceptance, artifacts: missingArtifacts } }), new RegExp(`different ${kind} bytes`));
    });
    const missingBoth = { ...fabrication.artifacts };
    delete missingBoth[kind];
    await t.test(`rejects ${kind} missing from both records`, () => {
      assert.throws(() => acceptKindleRelease({ ...releaseInput, fabrication: { ...fabrication, artifacts: missingBoth }, editorialAcceptance: { ...editorialAcceptance, artifacts: missingBoth } }), new RegExp(`different ${kind} bytes`));
    });
  }
  assert.equal(release.content.status, "release-ready");
  assert.equal(release.content.evidence.accessibilityConformanceClaim, null);
  const tampered = { ...signed, cell: { ...signed.cell, content: { ...signed.cell.content, book: "another-book" } } };
  assert.equal(verifyKindleValidationReceipt(tampered, publicKey), false);
});

test("unknown or non-KDP cover metadata never becomes zero or a passing receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kindle-validation-"));
  const epubPath = join(directory, "book.epub"), coverPath = join(directory, "cover.png");
  await writeFile(epubPath, "fixture epub"); await writeFile(coverPath, "fixture cover");
  const cell = await validateKindleEdition({ book: "fixture", epubPath, coverPath, validatedAt: "2026-09-29T00:00:00.000Z" }, {
    exists: async () => false, inspectEpub: async () => reflowable, skipObservation: true,
    metadata: async () => ({ width: undefined, height: undefined, space: "cmyk", format: "png" }),
  });
  assert.equal(cell.content.passed, false);
  assert.equal(cell.content.checks.conformance.release.obstruction, "epubcheck-unavailable");
  assert.equal(cell.content.checks.cover.width, null);
});

test("a different EPUBCheck version cannot satisfy the pinned EPUB 3.3 release profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kindle-validation-version-"));
  const epubPath = join(directory, "book.epub"); await writeFile(epubPath, "fixture epub");
  const { validateEpub } = await import("../src/kindle-validation.mjs");
  const result = await validateEpub(epubPath, {
    profile: EPUB_VALIDATOR_PROFILES.release,
    tool: { available: true, command: "epubcheck", prefix: [], source: "fixture" },
    runCommand: async () => ({ status: 0, stdout: "EPUBCheck 5.4.0", stderr: "" }),
  });
  assert.equal(result.passed, false); assert.equal(result.obstruction, "validator-version-mismatch");
});

test("retailer portability reports unsupported present features without rewriting them", () => {
  const assays = assayRetailerPortability({ ...reflowable.features, mathml: true });
  assert.equal(assays["google-play-books-2026-09"].features.mathml, "unsupported");
  assert.deepEqual(assays["google-play-books-2026-09"].blocking, ["mathml"]);
  assert.equal(assays["kindle-reflowable-2026-09"].passed, true);
});
