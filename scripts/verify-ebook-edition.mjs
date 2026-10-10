#!/usr/bin/env node
/**
 * Rebuild an accepted edition from its tracked manuscript and report whether
 * the EPUB and PDF come out byte-identical to the ones its acceptance record
 * names. An edition reproduces only when its manifest states its date (see
 * editionEpochSeconds); the result says which epoch the rebuild used.
 *   node scripts/verify-ebook-edition.mjs <ebook.json> <acceptance.json>
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { produceEbook } from "./produce-ebook.mjs";

/**
 * @param {string} manifestPath a book's ebook.json
 * @param {object} acceptance its EbookEditionAcceptance
 * @returns {Promise<{reproduced: boolean, epoch: object, artifacts: object}>}
 */
export async function verifyEbookEdition(manifestPath, acceptance) {
  if (acceptance?.type !== "EbookEditionAcceptance" || acceptance.status !== "accepted") throw new TypeError("expected an accepted EbookEditionAcceptance");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const here = dirname(resolve(manifestPath));
  const distDir = mkdtempSync(join(tmpdir(), "ebook-verify-"));
  try {
    const record = await produceEbook({
      ...manifest,
      bookDir: resolve(here, manifest.bookDir),
      distDir,
      ...(manifest.tokens ? { tokens: resolve(here, manifest.tokens) } : {}),
      ...(manifest.coverArt ? { coverArt: resolve(here, manifest.coverArt) } : {}),
    });
    const artifacts = {
      epub: { expected: acceptance.artifacts.epub.sha256, observed: record.artifacts.epub.sha256 },
      pdf: { expected: acceptance.artifacts.screenPdf.sha256, observed: record.artifacts.pdf.sha256 },
    };
    return {
      reproduced: Object.values(artifacts).every(({ expected, observed }) => expected === observed),
      epoch: record.epoch,
      artifacts,
    };
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [manifestPath, acceptancePath] = process.argv.slice(2);
  if (!manifestPath || !acceptancePath) throw new Error("usage: verify-ebook-edition.mjs <ebook.json> <acceptance.json>");
  const result = await verifyEbookEdition(manifestPath, JSON.parse(readFileSync(resolve(acceptancePath), "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.reproduced) process.exitCode = 1;
}
