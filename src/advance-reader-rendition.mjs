import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { defineSchemaType } from "@red-cup-engineering/signcell/type-system/schema-type";
import { createTypedMark } from "@red-cup-engineering/signcell/typed-mark";

const exec = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * The advance-reader rendition (`advance-reader-v1`) is not a third fabrication projection: it is the accepted
 * EPUB plus one front-matter page, its manifest item and its spine entry, and, for one reader, a "Prepared for"
 * line and a grant identifier. It shares the accepted edition's input digest, and `compareAdvanceReaderRendition`
 * proves the page and stamp are the only differences.
 */
export const ADVANCE_READER_RENDITION = "advance-reader-v1";
export const PAGE_ENTRY = "text/advance-reader.xhtml";
const PAGE_ITEM_ID = "advance_reader_xhtml";
const GRANT_IDENTIFIER_ID = "review-copy-grant";
const GRANT = /^[A-Za-z0-9_-]{8,128}$/u;

const escapeXml = (text) => String(text).replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const longDate = (isoDate) => new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The page a reader sees before the book. `status` is `advance` before the book is on sale and `review` once it is;
 * `uncorrected` is true only when the text is not the release-accepted text. The page states the material
 * connection the reader should disclose and that no review is required (16 CFR 255, 16 CFR 465, Amazon's
 * free-copy rule). It makes no claim about who wrote the book: the edition's copyright page already does.
 */
export function advanceReaderPage({ title, language = "en-US", onSale, status, uncorrected = false, contact, stamp = null }) {
  if (!["advance", "review"].includes(status)) throw new TypeError("status is advance or review");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(onSale ?? "")) throw new TypeError("onSale is an ISO date");
  if (!contact) throw new TypeError("a reader needs a publisher contact");
  const heading = status === "advance" ? "Advance reader copy" : "Review copy";
  const lines = [
    `<p class="not-for-sale">Not for sale.${uncorrected ? " Uncorrected proof." : ""}</p>`,
    `<p class="on-sale">${status === "advance" ? "On sale" : "On sale since"} ${longDate(onSale)}.</p>`,
    `<p class="review-terms">A review is welcome and never required. If you post one, please say you received a free copy.</p>`,
    `<p class="contact">Questions: ${escapeXml(contact)}</p>`,
    ...(stamp ? [`<p class="prepared-for">Prepared for ${escapeXml(stamp.preparedFor)} · ${escapeXml(stamp.grant)}</p>`] : []),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}" xml:lang="${escapeXml(language)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(heading)}: ${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/stylesheet1.css" />
</head>
<body epub:type="frontmatter">
<section id="advance-reader" class="advance-reader">
<h1>${escapeXml(heading)}</h1>
${lines.join("\n")}
</section>
</body>
</html>
`;
}

const manifestItem = `    <item id="${PAGE_ITEM_ID}" href="${PAGE_ENTRY}" media-type="application/xhtml+xml" />\n`;
const spineItemref = `    <itemref idref="${PAGE_ITEM_ID}" />\n`;
const grantIdentifier = (grant) => `    <dc:identifier id="${GRANT_IDENTIFIER_ID}">urn:x-561-group:review-copy-grant:${grant}</dc:identifier>\n`;

/**
 * The accepted package document with the page added after the title page (or first in the spine when the
 * edition has none), and, when stamped, a second dc:identifier naming the grant. Nothing else changes, so the
 * edition keeps its unique identifier and modification date.
 */
export function withAdvanceReaderPackage(opf, { titlePageItemId = null, grant = null } = {}) {
  if (opf.includes(`id="${PAGE_ITEM_ID}"`)) throw new Error("the package already carries the advance-reader page");
  if (grant !== null && !GRANT.test(grant)) throw new TypeError("a grant id is 8 to 128 URL-safe characters");
  let next = opf.replace(/^([ \t]*<\/manifest>)/mu, `${manifestItem}$1`);
  const titleRef = titlePageItemId && next.match(new RegExp(`^[ \\t]*<itemref\\b[^>]*\\bidref="${titlePageItemId}"[^>]*/>\\n`, "mu"));
  next = titleRef ? next.replace(titleRef[0], `${titleRef[0]}${spineItemref}`) : next.replace(/^([ \t]*<spine\b[^>]*>\n)/mu, `$1${spineItemref}`);
  if (grant !== null) next = next.replace(/(<dc:identifier\b[^>]*>[^<]*<\/dc:identifier>\n)/u, `$1${grantIdentifier(grant)}`);
  if (!next.includes(manifestItem) || !next.includes(spineItemref) || (grant !== null && !next.includes(grantIdentifier(grant)))) throw new Error("the package document has no manifest, spine or dc:identifier to extend");
  return next;
}

/** The inverse of withAdvanceReaderPackage: the package with exactly the inserted lines removed. */
export function withoutAdvanceReaderPackage(opf) {
  return opf.replace(manifestItem, "").replace(spineItemref, "").replace(new RegExp(`^[ \\t]*<dc:identifier id="${GRANT_IDENTIFIER_ID}">[^<]*</dc:identifier>\\n`, "mu"), "");
}

async function listEntries(epubPath) { return (await exec("unzip", ["-Z1", epubPath], { maxBuffer: MAX_BUFFER })).stdout.split("\n").filter(Boolean); }
async function readEntry(epubPath, entry) { return (await exec("unzip", ["-p", epubPath, entry], { encoding: "buffer", maxBuffer: MAX_BUFFER })).stdout; }
const packagePath = (container) => container.match(/full-path="([^"]+)"/u)?.[1];

/** The accepted EPUB's package document, its directory inside the zip, and the spine item that is its title page. */
async function readPackage(epubPath) {
  const opfEntry = packagePath((await readEntry(epubPath, "META-INF/container.xml")).toString("utf8"));
  if (!opfEntry) throw new Error("META-INF/container.xml names no package document");
  const root = opfEntry.includes("/") ? opfEntry.slice(0, opfEntry.lastIndexOf("/") + 1) : "";
  const opf = (await readEntry(epubPath, opfEntry)).toString("utf8");
  let titlePageItemId = null;
  for (const [, itemref] of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gu)) {
    const href = opf.match(new RegExp(`<item\\b[^>]*\\bid="${itemref}"[^>]*\\bhref="([^"]+)"`, "u"))?.[1] ?? opf.match(new RegExp(`<item\\b[^>]*\\bhref="([^"]+)"[^>]*\\bid="${itemref}"`, "u"))?.[1];
    if (href?.endsWith(".xhtml") && /epub:type="[^"]*\btitlepage\b/u.test((await readEntry(epubPath, `${root}${href}`)).toString("utf8"))) { titlePageItemId = itemref; break; }
  }
  const modified = opf.match(/<meta property="dcterms:modified">([^<]+)<\/meta>/u)?.[1] ?? "1980-01-01T00:00:00Z";
  return { opfEntry, root, opf, titlePageItemId, modified };
}

/**
 * Write the advance-reader rendition of an accepted EPUB to `outPath`. Deterministic: the same EPUB, notice and
 * stamp give the same bytes, because the two written entries carry the edition's own modification time, a fixed
 * mode and a UTC zip time, and every other entry is copied unchanged.
 * @param {{acceptedEpub: string, outPath: string, notice: object, stamp?: {preparedFor: string, grant: string}|null}} input
 * @returns {Promise<{artifactSha256: string, pageSha256: string, bytes: number}>}
 */
export async function renderAdvanceReaderEpub({ acceptedEpub, outPath, notice, stamp = null }) {
  const accepted = resolve(acceptedEpub), out = resolve(outPath);
  if (accepted === out) throw new Error("the rendition never overwrites the accepted EPUB");
  if (stamp && (!stamp.preparedFor || !GRANT.test(stamp.grant ?? ""))) throw new TypeError("a stamp names who it is prepared for and a grant id");
  const { opfEntry, root, opf, titlePageItemId, modified } = await readPackage(accepted);
  const title = opf.match(/<dc:title\b[^>]*>([^<]+)<\/dc:title>/u)?.[1] ?? "";
  const language = opf.match(/<dc:language>([^<]+)<\/dc:language>/u)?.[1] ?? "en-US";
  const page = advanceReaderPage({ ...notice, title, language, stamp });
  const entries = [[opfEntry, withAdvanceReaderPackage(opf, { titlePageItemId, grant: stamp?.grant ?? null })], [`${root}${PAGE_ENTRY}`, page]];
  await mkdir(dirname(out), { recursive: true });
  await copyFile(accepted, out);
  const staging = await mkdtemp(join(tmpdir(), "advance-reader-"));
  const epoch = new Date(modified);
  try {
    for (const [entry, text] of entries) {
      const staged = join(staging, entry);
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, text, "utf8");
      await chmod(staged, 0o644);
      await utimes(staged, epoch, epoch);
    }
    await exec("zip", ["-X", "-q", out, ...entries.map(([entry]) => entry)], { cwd: staging, env: { ...process.env, TZ: "UTC" } });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const bytes = await readFile(out);
  return Object.freeze({ artifactSha256: sha256(bytes), pageSha256: sha256(Buffer.from(page, "utf8")), bytes: bytes.length });
}

/**
 * Compare a rendition entry by entry with the accepted EPUB. It passes when every accepted entry is present and
 * byte-identical except the package document, the only added entry is the advance-reader page, and the package
 * document minus the inserted page item, spine entry and grant identifier is the accepted one.
 */
export async function compareAdvanceReaderRendition(acceptedEpub, renditionEpub) {
  const accepted = resolve(acceptedEpub), rendition = resolve(renditionEpub);
  const { opfEntry, root } = await readPackage(accepted);
  const before = await listEntries(accepted), after = await listEntries(rendition);
  const added = after.filter((entry) => !before.includes(entry)), removed = before.filter((entry) => !after.includes(entry)), changed = [];
  for (const entry of before.filter((name) => after.includes(name))) if (!(await readEntry(accepted, entry)).equals(await readEntry(rendition, entry))) changed.push(entry);
  const pageEntry = `${root}${PAGE_ENTRY}`;
  const packageOnlyGainedPage = !changed.includes(opfEntry) ? false : withoutAdvanceReaderPackage((await readEntry(rendition, opfEntry)).toString("utf8")) === (await readEntry(accepted, opfEntry)).toString("utf8");
  const passed = removed.length === 0 && added.length === 1 && added[0] === pageEntry && changed.length === 1 && packageOnlyGainedPage && after[0] === "mimetype";
  return Object.freeze({ passed, added: Object.freeze(added), removed: Object.freeze(removed), changed: Object.freeze(changed), packageOnlyGainedPage });
}

const sha256Hex = { type: "string", pattern: "^[0-9a-f]{64}$" };

export const advanceReaderRenditionType = defineSchemaType({
  $id: "org.561-group.ebook.advance-reader-rendition.v1", title: "Advance reader rendition",
  description: "An advance-reader or review copy derived from a release-accepted EPUB: the accepted edition's input digest and bytes, the rendition's bytes and page, the grant it is stamped for (never the reader's name), the comparison proving the page and stamp are its only differences, and its EPUB validation.",
  type: "object", additionalProperties: false,
  required: ["type", "version", "book", "rendition", "editionInputDigest", "accepted", "artifactSha256", "page", "grant", "comparison", "validation"],
  properties: {
    type: { const: "AdvanceReaderRendition" }, version: { const: 1 }, book: { type: "string", minLength: 1 },
    rendition: { const: ADVANCE_READER_RENDITION }, editionInputDigest: { type: "string", pattern: "^ni:///sha-256;" },
    accepted: { type: "object", additionalProperties: false, required: ["artifactSha256", "releaseAcceptance"], properties: { artifactSha256: sha256Hex, releaseAcceptance: { type: "string", pattern: "^ni:///sha-256;" } } },
    artifactSha256: sha256Hex,
    page: { type: "object", additionalProperties: false, required: ["sha256", "status", "uncorrected", "onSale"], properties: { sha256: sha256Hex, status: { enum: ["advance", "review"] }, uncorrected: { type: "boolean" }, onSale: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } },
    grant: { type: ["string", "null"] },
    comparison: { type: "object", required: ["passed"], properties: { passed: { const: true } } },
    validation: { type: ["object", "null"], required: ["outcome"], properties: { outcome: { enum: ["pass", "fail", "untested", "refused"] } } },
  },
});

/**
 * Render, compare and record one advance-reader copy of a release-accepted EPUB. Refuses an EPUB whose bytes are
 * not the ones the release acceptance names, and a rendition whose comparison fails. `validate` is the EPUB
 * validator (kindle-validation's validateEpub); its outcome is recorded and a failing one refuses the copy.
 */
export async function renderAdvanceReaderCopy({ book, acceptedEpub, releaseAcceptance, outPath, notice, stamp = null }, { validate = null } = {}) {
  const acceptance = releaseAcceptance.content ?? releaseAcceptance;
  if (acceptance.type !== "KindleReleaseAcceptance" || acceptance.status !== "release-ready") throw new Error("an advance-reader copy is derived only from a release-ready acceptance");
  const acceptedSha = sha256(await readFile(resolve(acceptedEpub)));
  if (acceptedSha !== acceptance.rendition.artifactSha256) throw new Error(`the EPUB is ${acceptedSha}, not the accepted ${acceptance.rendition.artifactSha256}`);
  const rendered = await renderAdvanceReaderEpub({ acceptedEpub, outPath, notice, stamp });
  const comparison = await compareAdvanceReaderRendition(acceptedEpub, outPath);
  if (!comparison.passed) throw new Error(`the rendition differs from the accepted EPUB beyond its page: ${JSON.stringify(comparison)}`);
  const validated = validate ? await validate(outPath) : null;
  if (validated && validated.outcome === "fail") throw new Error(`the rendition fails ${validated.profile?.id ?? "EPUB validation"} with ${validated.errors} errors`);
  const validation = validated ? { outcome: validated.outcome, ...(validated.profile ? { profile: validated.profile.id } : {}), ...(Number.isInteger(validated.errors) ? { errors: validated.errors, warnings: validated.warnings } : {}), ...(validated.report ? { report: validated.report } : {}) } : null;
  const cell = createTypedMark(advanceReaderRenditionType, {
    type: "AdvanceReaderRendition", version: 1, book, rendition: ADVANCE_READER_RENDITION,
    editionInputDigest: acceptance.editionInputDigest,
    accepted: { artifactSha256: acceptedSha, releaseAcceptance: releaseAcceptance.id ?? acceptance.id },
    artifactSha256: rendered.artifactSha256,
    page: { sha256: rendered.pageSha256, status: notice.status, uncorrected: Boolean(notice.uncorrected), onSale: notice.onSale },
    grant: stamp?.grant ?? null, comparison: { ...comparison }, validation,
  });
  if (!cell.ok) throw new TypeError(cell.refusal.message);
  return cell.value;
}
