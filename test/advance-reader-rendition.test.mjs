import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compareAdvanceReaderRendition, renderAdvanceReaderCopy, renderAdvanceReaderEpub } from "@red-cup-engineering/ebook-engineering-services-section/advance-reader-rendition";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const notice = { status: "advance", onSale: "2027-01-15", contact: "editor@example.test" };
const stamp = { preparedFor: "Fixture Reader", grant: "fixture-grant-01" };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "ebook-review-"));
  const originalCwd = process.cwd();
  t.after(() => { process.chdir(originalCwd); rmSync(directory, { recursive: true, force: true }); });
  execFileSync("git", ["init", "--quiet", directory]);
  process.chdir(directory);
  for (const sub of ["META-INF", "OPS/text"]) mkdirSync(join(directory, sub), { recursive: true });
  writeFileSync("mimetype", "application/epub+zip");
  writeFileSync("META-INF/container.xml", '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  writeFileSync("OPS/book.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="fixture">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="fixture">urn:test:advance-reader</dc:identifier>
    <dc:title>Fixture edition</dc:title>
    <dc:language>en-US</dc:language>
    <meta property="dcterms:modified">2026-11-01T12:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>
`);
  writeFileSync("OPS/text/chapter.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Fixture chapter</h1></body></html>');
  const acceptedEpub = join(directory, "accepted.epub");
  execFileSync("zip", ["-X", "-0", "-q", acceptedEpub, "mimetype"]);
  execFileSync("zip", ["-X", "-q", acceptedEpub, "META-INF/container.xml", "OPS/book.opf", "OPS/text/chapter.xhtml"]);
  const acceptedBytes = readFileSync(acceptedEpub);
  const id = "ni:///sha-256;fixture-acceptance";
  const releaseAcceptance = { id, content: { type: "KindleReleaseAcceptance", status: "release-ready",
    editionInputDigest: "ni:///sha-256;fixture-edition", rendition: { artifactSha256: digest(acceptedBytes) } } };
  return { acceptedBytes, directory, request: { book: "fixture", acceptedEpub, releaseAcceptance, outPath: join(directory, "copy.epub"), notice, stamp } };
}

test("only the compared and validated stamped rendition reaches the output", async t => {
  const { request, acceptedBytes, directory } = fixture(t);
  writeFileSync(request.outPath, "previous output");
  const cell = await renderAdvanceReaderCopy(request, { validate: async staged => {
    assert.notEqual(staged, request.outPath);
    assert.equal(readFileSync(request.outPath, "utf8"), "previous output");
    assert.equal((await compareAdvanceReaderRendition(request.acceptedEpub, staged)).passed, true);
    return { outcome: "pass" };
  } });
  const published = readFileSync(request.outPath);
  assert.equal(cell.content.artifactSha256, digest(published));
  assert.equal(cell.content.comparison.passed, true);
  assert.match(execFileSync("unzip", ["-p", request.outPath, "OPS/text/advance-reader.xhtml"], { encoding: "utf8" }), /Prepared for Fixture Reader/u);
  assert.deepEqual(readFileSync(request.acceptedEpub), acceptedBytes);
  const other = join(directory, "repeat.epub");
  const direct = await renderAdvanceReaderEpub({ ...request, outPath: other });
  assert.equal(direct.artifactSha256, cell.content.artifactSha256);
  assert.deepEqual(readFileSync(other), published);
  assert.deepEqual(readdirSync(join(directory, "data", "state", "temporary-state")), []);
});

test("refused validation, changed staged bytes and wrong acceptance leave output untouched", async t => {
  const { request, directory } = fixture(t);
  writeFileSync(request.outPath, "previous output");
  await assert.rejects(renderAdvanceReaderCopy(request, { validate: async () => ({ outcome: "fail", errors: 1 }) }),
    /fails EPUB validation/u);
  assert.equal(readFileSync(request.outPath, "utf8"), "previous output");
  await assert.rejects(renderAdvanceReaderCopy(request, { validate: async staged => {
    writeFileSync(staged, "changed during validation");
    return { outcome: "pass" };
  } }), /validation changed the staged EPUB/u);
  assert.equal(readFileSync(request.outPath, "utf8"), "previous output");
  const badAcceptance = structuredClone(request.releaseAcceptance);
  badAcceptance.content.rendition.artifactSha256 = "0".repeat(64);
  await assert.rejects(renderAdvanceReaderCopy({ ...request, releaseAcceptance: badAcceptance }), /not the accepted/u);
  assert.equal(readFileSync(request.outPath, "utf8"), "previous output");
  const absent = join(directory, "not-created", "refused-copy.epub");
  await assert.rejects(renderAdvanceReaderCopy({ ...request, book: "", outPath: absent }), TypeError);
  assert.throws(() => readFileSync(absent), { code: "ENOENT" });
  assert.deepEqual(readdirSync(join(directory, "data", "state", "temporary-state")), []);
});
