#!/usr/bin/env node
/**
 * Fabricate a book's paperback: the print interior and the full-wrap cover,
 * preflighted against the printer's rules, and the PrintEditionFabrication
 * record that names them.
 *   node scripts/produce-print-edition.mjs <ebook.json> <text-acceptance.json> [record.json]
 *
 * A print edition prints an accepted edition's text. The acceptance names the
 * screen PDF that edition was accepted on; the script sets that PDF again from
 * the book's sources and refuses unless the bytes are the same, so the
 * paperback is set from exactly the accepted text. The interior is the same
 * chapters and theme through templates/book-print.latex at the trim, with
 * KDP's gutter for its page count; the cover is templates/cover-wrap.latex,
 * the illustrated front at the trim's scale beside the spine and back.
 */
import { execFile as execFileCallback } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { renderCoverWrapLatex, sha256File, withDeterministicPdfIdentifier } from "../src/ebook-production.mjs";
import { bookSource } from "../src/fabricate-ebook-edition.mjs";
import { coverWrap, interiorGeometry, preflightPrintEdition, printSpecification, printedIsbn } from "../src/print-edition.mjs";
import { bookPdfArgs, copyrightPageArgs, copyrightPageOf, italicFaceFileOf, prepareBook, renderBookPdf, withProjectedChapters } from "./produce-ebook.mjs";

const SECTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRINT_TEMPLATE = join(SECTION_ROOT, "templates", "book-print.latex");
const WRAP_TEMPLATE = join(SECTION_ROOT, "templates", "cover-wrap.latex");
export const PRINT_PROFILE = "kdp-paperback-v1";
/** The ebook cover the front is drawn from: 1600 x 2560 at 256 to the inch. */
const EBOOK_COVER = Object.freeze({ width: 6.25, height: 10, pixelsPerInch: 256 });
/** Printers ask 300 pixels to the inch of placed art. */
const PRINT_PPI = 300;
const MAX_PASSES = 3;

const execFile = promisify(execFileCallback);
const run = async (file, args, options = {}) => (await execFile(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options })).stdout;

function refuse(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Page count and each page's size in points, from pdfinfo. */
async function pdfPages(path) {
  const pages = Number(/^Pages:\s+(\d+)$/mu.exec(await run("pdfinfo", [path]))[1]);
  const sizes = [...(await run("pdfinfo", ["-f", "1", "-l", String(pages), path])).matchAll(/^Page\s+\d+\s+size:\s+([\d.]+) x ([\d.]+) pts/gmu)]
    .map(([, width, height]) => ({ width: Number(width), height: Number(height) }));
  return { pages, pageSizes: sizes };
}

/** Each font pdffonts lists, with whether it is embedded. */
async function pdfFonts(path) {
  return (await run("pdffonts", [path])).split("\n").slice(2).filter((line) => line.trim())
    .map((line) => { const fields = line.trim().split(/\s+/u); return { name: fields[0], embedded: fields.at(-5) === "yes" }; });
}

/** Whether a box of the cover (inches from its top left) is one flat colour, rendered at 72 to the inch. */
async function boxIsPlain(pdf, box, hex, staging) {
  const inset = 1;
  const root = join(staging, "barcode");
  await run("pdftoppm", ["-r", "72", "-singlefile", "-x", String(Math.ceil(box.x * 72) + inset), "-y", String(Math.ceil(box.y * 72) + inset), "-W", String(Math.floor(box.width * 72) - 2 * inset), "-H", String(Math.floor(box.height * 72) - 2 * inset), pdf, root]);
  const bytes = readFileSync(`${root}.ppm`);
  const header = /^P6\s+\d+\s+\d+\s+\d+\s/u.exec(bytes.subarray(0, 64).toString("latin1"));
  const data = bytes.subarray(header[0].length);
  const want = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  for (let index = 0; index < data.length; index += 3) {
    if (want.some((value, channel) => Math.abs(data[index + channel] - value) > 2)) return false;
  }
  return data.length > 0;
}

/** The interior, set until its page count stays in the gutter tier it was set for. */
async function renderInterior(book, specification, { pdfChapters, staging }, pdfPath) {
  const copyrightArgs = copyrightPageArgs(copyrightPageOf(book, { setting: "This book", isbn: printedIsbn(specification) }), staging);
  let pages = 200;
  for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const layout = interiorGeometry(specification, pages);
    const pdf = await renderBookPdf(book, bookPdfArgs(book, { chapters: pdfChapters, copyrightArgs, template: PRINT_TEMPLATE, geometry: layout.geometry }), pdfPath);
    const observed = await pdfPages(pdfPath);
    if (interiorGeometry(specification, observed.pages).geometry === layout.geometry) return { pdf, layout, ...observed };
    pages = observed.pages;
  }
  throw refuse("INTERIOR_UNSTABLE", `the interior's page count did not settle in ${MAX_PASSES} passes`);
}

async function renderCover(book, specification, manifest, wrap, coverPath, staging) {
  const { parsed, tokenStyle, tokenFonts, style, epochSeconds } = book;
  if (manifest.cover !== "illustrated" || tokenStyle?.cover == null) throw refuse("NO_ILLUSTRATED_COVER", "a print cover is drawn from the book's illustrated cover and its design tokens");
  if (typeof manifest.description !== "string" || !manifest.description.trim()) throw refuse("NO_DESCRIPTION", "the back cover carries the book's description");
  const scale = specification.trim.width / EBOOK_COVER.width;
  // The illustration grows by the bleed on each side and centres on the trim.
  const artWidth = EBOOK_COVER.width + (2 * wrap.bleed) / scale;
  const artCenter = (specification.trim.height / scale / 2) * EBOOK_COVER.pixelsPerInch;
  const art = sharp(readFileSync(parsed.coverArt ?? manifest.coverArt));
  const { width, height } = await art.metadata();
  const needed = (specification.trim.height + 2 * wrap.bleed) / scale;
  if ((artWidth * height) / width < needed) throw refuse("ART_TOO_SHORT", `the illustration covers ${((artWidth * height) / width).toFixed(3)} of the ${needed.toFixed(3)} in the front and its bleed need`);
  const pixels = Math.round(artWidth * scale * PRINT_PPI);
  const illustration = "illustration.jpg";
  await art.resize({ width: pixels, kernel: "lanczos3" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toFile(join(staging, illustration));
  const series = manifest.series ? [manifest.series.within?.name, `${manifest.series.name} ${manifest.series.number}`].filter(Boolean).join(" · ") : "";
  const tex = join(staging, "cover.tex");
  writeFileSync(tex, renderCoverWrapLatex(readFileSync(WRAP_TEMPLATE, "utf8"), {
    wrap, title: parsed.title, subtitle: parsed.subtitle, author: parsed.author, series, blurb: manifest.description.trim(), imprint: manifest.publisher ?? style.imprint,
    illustration, artWidth, artCenter, scale,
    fonts: { display: tokenFonts.display.family, displayItalic: await italicFaceFileOf(tokenFonts.display.family), byline: tokenFonts.byline.family, reading: tokenFonts.body.family },
    colors: { ground: tokenStyle.cover.ground, ink: tokenStyle.cover.ink, accent: tokenStyle.accent },
    displayBold: !(tokenStyle.displayWeight !== null && tokenStyle.displayWeight < 600),
    bylineBold: tokenStyle.bylineWeight !== null && tokenStyle.bylineWeight >= 600,
  }), "utf8");
  // XeTeX stamps the wall-clock minute into the PDF's Creator unless FORCE_SOURCE_DATE holds it to the build epoch.
  await run("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", staging, tex], { cwd: staging, env: { ...process.env, SOURCE_DATE_EPOCH: String(epochSeconds), FORCE_SOURCE_DATE: "1" } });
  writeFileSync(coverPath, withDeterministicPdfIdentifier(readFileSync(join(staging, "cover.pdf"))));
  return { path: coverPath, bytes: statSync(coverPath).size, sha256: sha256File(coverPath), art: { sha256: sha256File(parsed.coverArt ?? manifest.coverArt), resampled: { width: pixels, pixelsPerInch: PRINT_PPI, kernel: "lanczos3" } } };
}

/**
 * @param {string} manifestPath the book's ebook.json
 * @param {string} acceptancePath the EbookEditionAcceptance of the edition to print
 * @returns {Promise<object>} the PrintEditionFabrication
 */
export async function producePrintEdition(manifestPath, acceptancePath) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const acceptance = JSON.parse(readFileSync(resolve(acceptancePath), "utf8"));
  if (acceptance?.type !== "EbookEditionAcceptance" || acceptance.status !== "accepted") throw refuse("TEXT_NOT_ACCEPTED", "a print edition prints an accepted edition");
  if (manifest.rights === undefined) throw refuse("NO_RIGHTS", "a printed book carries its copyright page; the manifest states no rights");
  const specification = printSpecification(manifest.print);
  const distDir = resolve(dirname(resolve(manifestPath)), manifest.distDir);
  const scratch = mkdtempSync(join(tmpdir(), "print-edition-"));
  try {
    const book = await prepareBook(bookSource(manifestPath, manifest, scratch));
    return await withProjectedChapters(book, async (projected) => {
      const { staging, pdfChapters } = projected;
      // The accepted text, proved by setting its screen PDF again.
      const screen = await renderBookPdf(book, bookPdfArgs(book, { chapters: pdfChapters, copyrightArgs: copyrightPageArgs(copyrightPageOf(book), staging), template: book.templatePath, geometry: "1.1in" }), join(scratch, "screen.pdf"));
      if (screen.sha256 !== acceptance.artifacts?.screenPdf?.sha256) throw refuse("SOURCE_NOT_ACCEPTED", `the book's sources set a screen PDF (${screen.sha256}) other than the accepted one (${acceptance.artifacts?.screenPdf?.sha256}); fabricate and accept an edition of these sources first`);

      mkdirSync(distDir, { recursive: true });
      const slug = book.parsed.slug;
      const interior = await renderInterior(book, specification, projected, join(scratch, "interior.pdf"));
      const interiorPath = join(distDir, `${slug}-print-interior.pdf`);
      copyFileSync(interior.pdf.path, interiorPath);
      const wrap = coverWrap(specification, interior.pages);
      const cover = await renderCover(book, specification, manifest, wrap, join(distDir, `${slug}-print-cover.pdf`), staging);

      const preflight = preflightPrintEdition({
        specification,
        interior: { pages: interior.pages, pageSizes: interior.pageSizes, fonts: await pdfFonts(interiorPath) },
        cover: { ...(await pdfPages(cover.path)), fonts: await pdfFonts(cover.path), barcodeClear: await boxIsPlain(cover.path, wrap.barcode, book.tokenStyle.cover.ground.replace(/^#/u, ""), staging) },
      });
      return {
        type: "PrintEditionFabrication",
        version: 1,
        book: slug,
        profile: PRINT_PROFILE,
        specification,
        pages: interior.pages,
        interior: { path: interiorPath, bytes: statSync(interiorPath).size, sha256: sha256File(interiorPath), margins: interior.layout.margins },
        cover: { path: cover.path, bytes: cover.bytes, sha256: cover.sha256, wrap, art: cover.art },
        templates: { interior: sha256File(PRINT_TEMPLATE), cover: sha256File(WRAP_TEMPLATE) },
        text: { acceptance: resolve(acceptancePath), editionInputDigest: acceptance.editionInputDigest, status: acceptance.status, screenPdfSha256: screen.sha256 },
        preflight,
        fabricatedAt: new Date().toISOString(),
      };
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [manifestPath, acceptancePath, out] = process.argv.slice(2);
  if (!manifestPath || !acceptancePath) throw new Error("usage: produce-print-edition.mjs <ebook.json> <text-acceptance.json> [record.json]");
  const record = await producePrintEdition(manifestPath, acceptancePath);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  if (out) writeFileSync(resolve(out), text);
  process.stdout.write(text);
  if (!record.preflight.passed) process.exitCode = 1;
}
