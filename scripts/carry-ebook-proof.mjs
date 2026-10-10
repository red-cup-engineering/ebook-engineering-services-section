#!/usr/bin/env node
/**
 * Carry an accepted edition's proof to a re-rendered edition whose text is
 * unchanged, printing the carried EbookEditionProof (or the refusal, exiting
 * non-zero). The text compared is every XHTML document in each EPUB, in entry
 * order, and each PDF's text layer (pdftotext) with the colophon's build digest
 * set aside, since it names the build rather than the text, and whitespace collapsed,
 * since a proof vouches for words and a layout change only moves line breaks. Each edition's files are
 * found by name in the directory given for it, not at the paths their records
 * name, which go stale when a book moves.
 *   node scripts/carry-ebook-proof.mjs <prior-proof.json> <prior-acceptance.json> <prior-dir> <fabrication.json> <dir>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

import { carryEbookEditionProof } from "../src/accept-ebook-edition.mjs";

const contentAddress = (text) => makeNiUri(Buffer.from(text, "utf8"));

// The landmarks list is a hidden navigation structure a reading system follows
// ("start reading", "go to cover"); no reader reads it, so it is set aside.
const HIDDEN_LANDMARKS = /<nav\b(?=[^>]*epub:type="landmarks")(?=[^>]*\bhidden\b)[^>]*>[\s\S]*?<\/nav>/gu;

/** The content address of an EPUB's text: each XHTML entry, by name, in entry order. */
export function epubText(epub) {
  const entries = execFileSync("zipinfo", ["-1", epub], { encoding: "utf8" }).split("\n").filter((entry) => entry.endsWith(".xhtml")).sort();
  return contentAddress(entries.map((entry) => `${entry}\n${execFileSync("unzip", ["-p", epub, entry], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).replace(HIDDEN_LANDMARKS, "")}`).join("\n"));
}

// The colophon prints the build's source digest ("Build record hash: ni:..."),
// which names the build, not the text a proofreader read; it changes whenever
// any pipeline source byte does, even a comment, so it is set aside.
const BUILD_RECORD_LINE = /Build record hash: ni:\/\/\/sha-256;[A-Za-z0-9_-]+/gu;

/**
 * The content address of a PDF's text layer, with the colophon's build digest set aside and
 * every run of whitespace collapsed to one space. A proof vouches for words, not line breaks:
 * a layout change (a wider contents column, a new chapter opener) moves where pdftotext breaks
 * a line without changing a word, and must not make the same text read as different text.
 */
export function pdfText(pdf) {
  return contentAddress(execFileSync("pdftotext", ["-enc", "UTF-8", pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).replace(BUILD_RECORD_LINE, "Build record hash: (the build's own)").replace(/\s+/gu, " ").trim());
}

function editionFiles(record, directory) {
  return { epub: join(directory, basename(record.artifacts.epub.path)), pdf: join(directory, basename(record.artifacts.screenPdf.path)) };
}

if (import.meta.main) {
  const [priorProofPath, priorAcceptancePath, priorDir, fabricationPath, dir] = process.argv.slice(2);
  if (!dir) throw new Error("usage: carry-ebook-proof.mjs <prior-proof.json> <prior-acceptance.json> <prior-dir> <fabrication.json> <dir>");
  const read = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
  const priorAcceptance = read(priorAcceptancePath);
  const fabrication = read(fabricationPath);
  const prior = editionFiles(priorAcceptance, resolve(priorDir));
  const current = editionFiles(fabrication, resolve(dir));
  const result = carryEbookEditionProof({
    priorProof: read(priorProofPath),
    priorAcceptance,
    fabrication,
    text: { prior: { epub: epubText(prior.epub), pdf: pdfText(prior.pdf) }, current: { epub: epubText(current.epub), pdf: pdfText(current.pdf) } },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.type !== "EbookEditionProof") process.exitCode = 1;
}
