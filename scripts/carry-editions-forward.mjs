#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fabricateEbookEdition } from "../src/fabricate-ebook-edition.mjs";
import { acceptEbookEdition, carryEbookEditionProof } from "../src/accept-ebook-edition.mjs";
import { describeEbookEditionSource } from "../src/fabricate-ebook-edition.mjs";
import { epubText, pdfText } from "./carry-ebook-proof.mjs";
import { verifyEbookEdition } from "./verify-ebook-edition.mjs";
import { bookSource, carriedSpecification, catalogWithAcceptance, offeringForEdition, editionHome, editionRecordPaths, editionStateDir, recordsForHome } from "../src/carry-editions-forward.mjs";

const usage = "usage: carry-editions-forward.mjs [--records-dir <dir>] [--catalog <catalog.json>] [--stage] [--offering <release-id>] <ebook.json> <proof.json> <acceptance.json> [...]";

function read(path) { return JSON.parse(readFileSync(resolve(path), "utf8")); }
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function refusal(book, code) { return { book: book.slug, status: "refused", code }; }

function discoverTriples(dir, bookRoot) {
  const files = readdirSync(resolve(dir)).filter((file) => file.endsWith("-acceptance.json"));
  return files.map((acceptanceFile) => {
    const stem = acceptanceFile.slice(0, -"-acceptance.json".length);
    const proof = join(dir, `${stem}-proof.json`);
    const edition = join(dir, `${stem}.json`);
    const acceptance = join(dir, acceptanceFile);
    const match = stem.match(/^(.*)-(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)-edition$/u);
    if (!match) return null;
    return { editionPath: edition, proofPath: proof, acceptancePath: acceptance, manifestPath: bookRoot ? resolve(bookRoot, match[1], "ebook.json") : undefined, slug: match[1] };
  }).filter(Boolean);
}

function parseBooks(options, positionals) {
  if (options["records-dir"]) return discoverTriples(options["records-dir"], options["book-root"]);
  if (positionals.length === 0 || positionals.length % 3 !== 0) throw new Error(usage);
  const books = [];
  for (let i = 0; i < positionals.length; i += 3) books.push({ manifestPath: positionals[i], proofPath: positionals[i + 1], acceptancePath: positionals[i + 2] });
  return books;
}

async function carryBook(book, options) {
  const manifestPath = book.manifestPath;
  if (!manifestPath) return { status: "not reproduced", book: book.slug ?? "unknown", code: "MANIFEST_REQUIRED" };
  const manifest = read(manifestPath);
  const specificationPath = join(dirname(resolve(manifestPath)), manifest.bookDir ?? ".", "edition-specification.json");
  const specification = read(specificationPath);
  const priorProof = read(book.proofPath);
  const priorAcceptance = read(book.acceptancePath);
  const stateDir = editionStateDir(book.acceptancePath, manifest.slug);
  const stagingRoot = mkdtempSync(join(options.tmpDir, "ebook-carry-"));
  const distDir = join(stagingRoot, "dist");
  mkdirSync(distDir, { recursive: true });
  try {
    const source = bookSource(manifestPath, manifest, distDir);
    const description = describeEbookEditionSource(source);
    if (description.type !== "EbookEditionSourceDescription") return refusal(manifest, description.code);
    const nextSpecification = carriedSpecification(specification, description.editionInputDigest);
    const fabrication = await fabricateEbookEdition(nextSpecification, source);
    if (fabrication.status !== "fabricated-awaiting-acceptance") return { book: manifest.slug, status: "not reproduced", code: fabrication.code ?? "NOT_REPRODUCED" };
    const text = { prior: { epub: epubText(join(stateDir, basename(priorAcceptance.artifacts.epub.path))), pdf: pdfText(join(stateDir, basename(priorAcceptance.artifacts.screenPdf.path))) }, current: { epub: epubText(fabrication.artifacts.epub.path), pdf: pdfText(fabrication.artifacts.screenPdf.path) } };
    const proof = carryEbookEditionProof({ priorProof, priorAcceptance, fabrication, text });
    if (proof.type !== "EbookEditionProof") return refusal(manifest, proof.code);
    return await homeEdition({ manifestPath, manifest, priorAcceptancePath: book.acceptancePath, fabrication, proof, distDir, stagingRoot, options, verb: "carried" });
  } finally { rmSync(stagingRoot, { recursive: true, force: true }); }
}

/**
 * Accept a fabricated edition on its proof and make it the book's current edition: verify it
 * rebuilds byte-identically from the manuscript, then replace the book's edition state with its
 * files and write its records beside the prior edition's, named for the next ordinal. A refusal
 * leaves the current edition and its records untouched.
 */
export async function homeEdition({ manifestPath, manifest, priorAcceptancePath, fabrication, proof, distDir, stagingRoot, options = {}, verb }) {
  const offeringId = options.stage ? offeringForEdition(options.catalog ? read(options.catalog) : null, manifest.slug, options.offering) : null;
  const acceptance = acceptEbookEdition(fabrication, proof);
  if (acceptance.status !== "accepted") return refusal(manifest, acceptance.code ?? "NOT_ACCEPTED");
  const { stateDir, recordsDir, ordinal } = editionHome(manifestPath, manifest, priorAcceptancePath);
  const editionDate = new Date().toISOString().slice(0, 10);
  const records = editionRecordPaths(recordsDir, editionDate, manifest.slug, ordinal);
  const finalFiles = recordsForHome(fabrication, proof, acceptance, stateDir);
  // Verify before replacing anything, so a refusal leaves the current edition and its records untouched.
  const verification = await verifyEbookEdition(manifestPath, finalFiles.acceptance);
  if (!verification.reproduced) return { book: manifest.slug, status: "not reproduced", verification };
  rmSync(stateDir, { recursive: true, force: true });
  mkdirSync(stateDir, { recursive: true });
  for (const file of readdirSync(distDir)) cpSync(join(distDir, file), join(stateDir, file));
  write(records.edition, { ...fabrication, artifacts: finalFiles.fabrication.artifacts });
  write(records.proof, finalFiles.proof);
  write(records.acceptance, finalFiles.acceptance);
  if (options.catalog) updateCatalog(options.catalog, manifest.slug, records.acceptance);
  if (options.stage) {
    try { stageRelease(records.acceptance, offeringId, stateDir, stagingRoot); }
    catch (error) { return { book: manifest.slug, status: "release staging failed", acceptance: records.acceptance, verification, message: error.message }; }
  }
  return { book: manifest.slug, status: verb, acceptance: records.acceptance, verification };
}

function updateCatalog(path, slug, acceptancePath) {
  // Catalog paths are relative to the services root that holds the catalog (lib/emsenn/services/561-group/services/).
  const catalogPath = resolve(path);
  const servicesRoot = catalogPath.slice(0, catalogPath.lastIndexOf("/561-group/services/") + "/561-group/services".length);
  const relative = resolve(acceptancePath).replace(`${servicesRoot}/`, "");
  const { catalog, changed } = catalogWithAcceptance(read(catalogPath), slug, relative);
  if (changed === 0) throw new Error(`the catalog names no book ${slug}`);
  write(catalogPath, catalog);
}

function stageRelease(acceptance, offeringId, stateDir, stagingRoot) {
  // Resolve from this script's own services root, not the caller's working directory.
  const servicesRoot = import.meta.dirname.slice(0, import.meta.dirname.lastIndexOf("/561-group/services/") + "/561-group/services".length);
  const storefront = resolve(servicesRoot, "engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-platform-services-section/services/web2-platform-services-section/services/web2-financial-platform-services-section/services/web2-payment-platform-services-section/services/digital-goods-storefront-services-section");
  const wrangler = process.env.WRANGLER ?? resolve(storefront, "node_modules/.bin/wrangler");
  const script = resolve(storefront, "scripts/stage-paid-release.mjs");
  execFileSync(process.execPath, [script, acceptance, "--offering", offeringId, "--out", join(stagingRoot, "release"), "--dir", stateDir, "--upload"], { stdio: "inherit", env: { ...process.env, WRANGLER: wrangler } });
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "records-dir": { type: "string" }, "book-root": { type: "string" }, catalog: { type: "string" }, stage: { type: "boolean" }, offering: { type: "string" }, help: { type: "boolean", short: "h" } } });
  if (values.help) { console.log(usage); process.exit(0); }
  const results = [];
  for (const book of parseBooks(values, positionals)) {
    try { results.push(await carryBook(book, { ...values, tmpDir: "/tmp" })); } catch (error) { results.push({ book: book.manifestPath ?? book.slug, status: "not reproduced", code: error.code ?? "ERROR", message: error.message }); }
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some(result => result.status !== "carried")) process.exitCode = 1;
}
