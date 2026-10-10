#!/usr/bin/env node
/**
 * @module fabricate-ebook-from-corpus
 * The composed face: derives an ordered chapters directory from named
 * corpus section roots (`deriveSetOfChaptersFromCorpus`), then produces the
 * EPUB and PDF from those chapters (`produceEbook`), printing the combined
 * result as JSON. Composes a script package and a script from this same
 * section -- an app composing scripts and a published sibling script
 * package, never originating logic of its own.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveSetOfChaptersFromCorpus } from "../scripts/derive-ebook-chapters-from-corpus.mjs";
import { produceEbook } from "../scripts/produce-ebook.mjs";

const HELP = `usage: fabricate-ebook-from-corpus --spec <path.json>
       fabricate-ebook-from-corpus --help

--spec <path>  a JSON object with deriveSetOfChaptersFromCorpus's own fields
               (parts, title, author, chaptersDir, carriers?, style?,
               subtitle?, frontMatterNotePaths?, appendixNotePaths?) plus
               produceEbook's remaining fields: distDir (the ebook OUTPUT
               location; distinct from chaptersDir, the chapters SOURCE
               location this app derives), and optionally template, css,
               pandocBin.
--help         print this message
`;

/**
 * Parse argv into a CLI action.
 * @param {string[]} argv
 * @returns {{help: boolean, specPath: (string|undefined)}}
 */
export function parseArgs(argv) {
  const help = argv.includes("--help") || argv.includes("-h");
  const flagIndex = argv.indexOf("--spec");
  const specPath = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  return { help, specPath };
}

/**
 * Derive a corpus book's chapters, then produce its EPUB and PDF.
 * @param {object} spec - deriveSetOfChaptersFromCorpus's fields plus produceEbook's distDir and optional template/css/pandocBin
 * @returns {Promise<{chapters: object, buildRecord: object}>}
 */
export async function fabricateEbookFromCorpus(spec) {
  const { distDir, template, css, pandocBin, ...deriveInput } = spec;
  if (typeof distDir !== "string" || distDir.length === 0) {
    throw new TypeError("fabricateEbookFromCorpus requires spec.distDir (the ebook output location)");
  }
  const chapters = await deriveSetOfChaptersFromCorpus(deriveInput);
  const manifest = {
    ...chapters.manifest,
    distDir,
    ...(template ? { template } : {}),
    ...(css ? { css } : {}),
    ...(pandocBin ? { pandocBin } : {}),
  };
  const buildRecord = await produceEbook(manifest);
  return { chapters, buildRecord };
}

async function main() {
  const { help, specPath } = parseArgs(process.argv.slice(2));
  if (help || !specPath) {
    console.log(HELP);
    process.exitCode = help ? 0 : 1;
    return;
  }
  const spec = JSON.parse(readFileSync(resolve(specPath), "utf8"));
  const result = await fabricateEbookFromCorpus(spec);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
