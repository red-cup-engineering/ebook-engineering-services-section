#!/usr/bin/env node
/**
 * Issue a book's next edition after its manuscript or metadata changed, in two
 * steps around an independent proof. A book whose text is unchanged is carried
 * with its prior proof instead (carry-editions-forward.mjs); this is for the
 * edition whose words differ, which a proofreader must read.
 *
 * `stage` fabricates the edition from the book's current manuscript into a
 * staging directory and writes, beside it, both editions' text as a reader sees
 * it (the EPUB's documents without markup, the PDF's text layer) and their
 * differences, so the proofreader can read the whole edition and see exactly
 * what changed. `accept` accepts the staged edition on the proof they wrote,
 * verifies it rebuilds byte-identically, and makes it the book's current
 * edition as carry-editions-forward does, updating the shop catalog when given.
 *
 * A book with no edition yet names `first` in place of the prior acceptance:
 * its text is staged alone, with nothing to compare, and the edition is homed
 * where its manifest's distDir says, as its first. Its edition-specification.json
 * must already exist (specify-ebook-edition.mjs writes it).
 *
 *   node scripts/issue-ebook-edition.mjs stage <ebook.json> (<prior-acceptance.json> | first) <stage-dir>
 *   node scripts/issue-ebook-edition.mjs accept <ebook.json> (<prior-acceptance.json> | first) <stage-dir> <proof.json> [--catalog <catalog.json>] [--stage] [--offering <release-id>]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { describeEbookEditionSource, fabricateEbookEdition } from "../src/fabricate-ebook-edition.mjs";
import { bookSource, carriedSpecification, editionStateDir } from "../src/carry-editions-forward.mjs";
import { homeEdition } from "./carry-editions-forward.mjs";

const usage = [
  "usage: issue-ebook-edition.mjs stage <ebook.json> (<prior-acceptance.json> | first) <stage-dir>",
  "       issue-ebook-edition.mjs accept <ebook.json> (<prior-acceptance.json> | first) <stage-dir> <proof.json> [--catalog <catalog.json>] [--stage] [--offering <release-id>]",
].join("\n");
const read = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`); };

/** An EPUB's documents in entry order, each headed by its name, with markup removed and entities read. */
function epubReadable(epub) {
  const entries = execFileSync("zipinfo", ["-1", epub], { encoding: "utf8" }).split("\n").filter((entry) => entry.endsWith(".xhtml")).sort();
  const entity = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  return entries.map((entry) => {
    const xhtml = execFileSync("unzip", ["-p", epub, entry], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const body = xhtml.replace(/<(script|style)\b[\s\S]*?<\/\1>/gu, "").replace(/<\/(p|h[1-6]|li|dt|dd|div|tr|blockquote|figcaption|section)>|<br\s*\/?>/gu, "\n").replace(/<[^>]+>/gu, "")
      .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (match, name) => name[0] === "#" ? String.fromCodePoint(name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : entity[name] ?? match);
    return `=== ${entry}\n${body.split("\n").map((line) => line.trim()).filter(Boolean).join("\n")}\n`;
  }).join("\n");
}

/** A PDF's text layer, page by page. */
const pdfReadable = (pdf) => execFileSync("pdftotext", ["-enc", "UTF-8", "-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function difference(prior, current) {
  try { return execFileSync("diff", ["-u", prior, current], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch (error) { if (error.status === 1) return error.stdout; throw error; }
}

async function stage(manifestPath, priorAcceptancePath, stageDir) {
  const manifest = read(manifestPath);
  const specification = read(join(dirname(resolve(manifestPath)), manifest.bookDir ?? ".", "edition-specification.json"));
  const distDir = join(stageDir, "dist");
  mkdirSync(distDir, { recursive: true });
  const source = bookSource(manifestPath, manifest, distDir);
  const description = describeEbookEditionSource(source);
  if (description.type !== "EbookEditionSourceDescription") return { book: manifest.slug, status: "refused", code: description.code };
  const fabrication = await fabricateEbookEdition(carriedSpecification(specification, description.editionInputDigest), source);
  if (fabrication.status !== "fabricated-awaiting-acceptance") return { book: manifest.slug, status: "not reproduced", code: fabrication.code ?? "NOT_REPRODUCED" };
  write(join(stageDir, "fabrication.json"), fabrication);
  const text = join(stageDir, "text");
  const files = { current: { epub: fabrication.artifacts.epub.path, pdf: fabrication.artifacts.screenPdf.path } };
  if (priorAcceptancePath) {
    const priorAcceptance = read(priorAcceptancePath);
    const priorDir = editionStateDir(priorAcceptancePath, manifest.slug);
    files.prior = { epub: join(priorDir, basename(priorAcceptance.artifacts.epub.path)), pdf: join(priorDir, basename(priorAcceptance.artifacts.screenPdf.path)) };
  }
  for (const edition of Object.keys(files)) {
    write(join(text, `${edition}-epub.txt`), epubReadable(files[edition].epub));
    write(join(text, `${edition}-pdf.txt`), pdfReadable(files[edition].pdf));
  }
  if (files.prior) for (const format of ["epub", "pdf"]) write(join(text, `${format}.diff`), difference(join(text, `prior-${format}.txt`), join(text, `current-${format}.txt`)));
  return {
    book: manifest.slug, status: "staged", stage: resolve(stageDir),
    editionInputDigest: fabrication.specification.projections[0].configuration.editionInputDigest,
    artifacts: { epub: { path: files.current.epub, sha256: fabrication.artifacts.epub.sha256 }, screenPdf: { path: files.current.pdf, sha256: fabrication.artifacts.screenPdf.sha256 } },
    prior: files.prior ?? null,
  };
}

async function accept(manifestPath, priorAcceptancePath, stageDir, proofPath, options) {
  const manifest = read(manifestPath);
  return homeEdition({ manifestPath, manifest, priorAcceptancePath, fabrication: read(join(stageDir, "fabrication.json")), proof: read(proofPath), distDir: join(stageDir, "dist"), stagingRoot: stageDir, options, verb: "issued" });
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { catalog: { type: "string" }, stage: { type: "boolean" }, offering: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) { console.log(usage); process.exit(0); }
  const [verb, manifestPath, prior, stageDir, proofPath] = positionals;
  const priorAcceptancePath = prior === "first" ? null : prior;
  let result;
  if (verb === "stage" && stageDir) result = await stage(manifestPath, priorAcceptancePath, stageDir);
  else if (verb === "accept" && proofPath) result = await accept(manifestPath, priorAcceptancePath, stageDir, proofPath, values);
  else throw new Error(usage);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!["staged", "issued"].includes(result.status)) process.exitCode = 1;
}
