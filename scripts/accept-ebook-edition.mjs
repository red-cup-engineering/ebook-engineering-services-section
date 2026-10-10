#!/usr/bin/env node
/**
 * Accept one fabricated edition against its proof record, printing the
 * EbookEditionAcceptance; exits non-zero when acceptance is refused.
 *   node scripts/accept-ebook-edition.mjs <fabrication-record.json> <proof-record.json>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { acceptEbookEdition } from "../src/accept-ebook-edition.mjs";

if (import.meta.main) {
  const [fabricationPath, proofPath] = process.argv.slice(2);
  if (!fabricationPath || !proofPath) throw new Error("usage: accept-ebook-edition.mjs <fabrication-record.json> <proof-record.json>");
  const result = acceptEbookEdition(JSON.parse(readFileSync(resolve(fabricationPath), "utf8")), JSON.parse(readFileSync(resolve(proofPath), "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "refused") process.exitCode = 1;
}
