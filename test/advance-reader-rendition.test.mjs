import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { advanceReaderPage, compareAdvanceReaderRendition, renderAdvanceReaderCopy, renderAdvanceReaderEpub, withAdvanceReaderPackage, withoutAdvanceReaderPackage } from "../src/advance-reader-rendition.mjs";

const exec = promisify(execFile);
const xhtml = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title></head>${body}</html>\n`;
const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="epub-id-1">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="epub-id-1">ni:///sha-256;fixture</dc:identifier>
    <dc:title id="epub-title-1">Fixture Book</dc:title>
    <dc:language>en-US</dc:language>
    <meta property="dcterms:modified">2026-09-29T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="title_page_xhtml" href="text/title_page.xhtml" media-type="application/xhtml+xml" />
    <item id="ch001_xhtml" href="text/ch001.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="title_page_xhtml" linear="yes" />
    <itemref idref="nav" />
    <itemref idref="ch001_xhtml" />
  </spine>
</package>
`;

async function fixtureEpub() {
  const directory = await mkdtemp(join(tmpdir(), "advance-reader-test-")), root = join(directory, "src");
  const files = {
    mimetype: "application/epub+zip",
    "META-INF/container.xml": `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>\n`,
    "EPUB/content.opf": opf,
    "EPUB/nav.xhtml": xhtml(`<body><nav epub:type="toc"><ol><li><a href="text/ch001.xhtml">One</a></li></ol></nav></body>`),
    "EPUB/text/title_page.xhtml": xhtml(`<body epub:type="frontmatter"><section epub:type="titlepage"><h1>Fixture Book</h1></section></body>`),
    "EPUB/text/ch001.xhtml": xhtml(`<body epub:type="bodymatter"><h1>One</h1><p>Text.</p></body>`),
  };
  for (const [name, text] of Object.entries(files)) { const path = join(root, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); await utimes(path, new Date("2026-09-29T00:00:00Z"), new Date("2026-09-29T00:00:00Z")); }
  const epub = join(directory, "book.epub"), env = { ...process.env, TZ: "UTC" };
  await exec("zip", ["-X", "-0", "-q", epub, "mimetype"], { cwd: root, env });
  await exec("zip", ["-X", "-r", "-q", epub, "META-INF", "EPUB"], { cwd: root, env });
  const sha256 = createHash("sha256").update(await readFile(epub)).digest("hex");
  return { directory, epub, acceptance: { id: "ni:///sha-256;acceptance", content: { type: "KindleReleaseAcceptance", status: "release-ready", book: "fixture", editionInputDigest: "ni:///sha-256;edition", rendition: { kind: "EPUB", artifactSha256: sha256 } } } };
}

const notice = { status: "advance", onSale: "2026-12-08", contact: "causeway@561.group", uncorrected: true };

test("the page states not-for-sale, the on-sale date, the review terms and the contact, and escapes the reader's name", () => {
  const page = advanceReaderPage({ ...notice, title: "Fixture Book", stamp: { preparedFor: "Ada <Reader>", grant: "grant_ABCDEFGH" } });
  assert.match(page, /<h1>Advance reader copy<\/h1>/u);
  assert.match(page, /Not for sale\. Uncorrected proof\./u);
  assert.match(page, /On sale December 8, 2026\./u);
  assert.match(page, /A review is welcome and never required\. If you post one, please say you received a free copy\./u);
  assert.match(page, /Prepared for Ada &lt;Reader&gt; · grant_ABCDEFGH/u);
  assert.doesNotMatch(advanceReaderPage({ ...notice, status: "review", uncorrected: false, title: "T" }), /Uncorrected|Prepared for/u);
  assert.throws(() => advanceReaderPage({ ...notice, contact: "" , title: "T" }), /contact/u);
});

test("the package gains only the page item, its spine entry after the title page, and the grant identifier", () => {
  const stamped = withAdvanceReaderPackage(opf, { titlePageItemId: "title_page_xhtml", grant: "grant_ABCDEFGH" });
  assert.match(stamped, /<itemref idref="title_page_xhtml" linear="yes" \/>\n {4}<itemref idref="advance_reader_xhtml" \/>/u);
  assert.match(stamped, /<dc:identifier id="review-copy-grant">urn:x-561-group:review-copy-grant:grant_ABCDEFGH<\/dc:identifier>/u);
  assert.equal(withoutAdvanceReaderPackage(stamped), opf);
  assert.match(withAdvanceReaderPackage(opf), /<spine>\n {4}<itemref idref="advance_reader_xhtml" \/>/u, "no title page: first in the spine");
  assert.throws(() => withAdvanceReaderPackage(stamped), /already/u);
  assert.throws(() => withAdvanceReaderPackage(opf, { grant: "x y" }), /grant/u);
});

test("a rendition is deterministic and differs from the accepted EPUB only by its page and stamp", async () => {
  const { directory, epub, acceptance } = await fixtureEpub();
  const first = await renderAdvanceReaderEpub({ acceptedEpub: epub, outPath: join(directory, "a.epub"), notice });
  const second = await renderAdvanceReaderEpub({ acceptedEpub: epub, outPath: join(directory, "b.epub"), notice });
  assert.equal(first.artifactSha256, second.artifactSha256);
  const comparison = await compareAdvanceReaderRendition(epub, join(directory, "a.epub"));
  assert.deepEqual({ ...comparison }, { passed: true, added: ["EPUB/text/advance-reader.xhtml"], removed: [], changed: ["EPUB/content.opf"], packageOnlyGainedPage: true });
  assert.equal((await compareAdvanceReaderRendition(epub, epub)).passed, false, "the accepted EPUB is not a rendition of itself");

  const cell = await renderAdvanceReaderCopy({ book: "fixture", acceptedEpub: epub, releaseAcceptance: acceptance, outPath: join(directory, "stamped.epub"), notice, stamp: { preparedFor: "Ada Reader", grant: "grant_ABCDEFGH" } }, { validate: async () => ({ outcome: "pass", profile: { id: "fixture-validator" }, errors: 0, warnings: 0 }) });
  assert.equal(cell.content.editionInputDigest, "ni:///sha-256;edition");
  assert.equal(cell.content.grant, "grant_ABCDEFGH");
  assert.notEqual(cell.content.artifactSha256, first.artifactSha256);
  assert.doesNotMatch(JSON.stringify(cell), /Ada/u, "the record names the grant, never the reader");
  assert.equal(cell.content.validation.outcome, "pass");
});

test("a copy is refused from bytes the acceptance does not name, or when validation fails", async () => {
  const { directory, epub, acceptance } = await fixtureEpub();
  const wrong = structuredClone(acceptance); wrong.content.rendition.artifactSha256 = "0".repeat(64);
  await assert.rejects(renderAdvanceReaderCopy({ book: "fixture", acceptedEpub: epub, releaseAcceptance: wrong, outPath: join(directory, "x.epub"), notice }), /not the accepted/u);
  await assert.rejects(renderAdvanceReaderCopy({ book: "fixture", acceptedEpub: epub, releaseAcceptance: acceptance, outPath: join(directory, "y.epub"), notice }, { validate: async () => ({ outcome: "fail", errors: 2 }) }), /fails/u);
  await assert.rejects(renderAdvanceReaderEpub({ acceptedEpub: epub, outPath: epub, notice }), /never overwrites/u);
});
