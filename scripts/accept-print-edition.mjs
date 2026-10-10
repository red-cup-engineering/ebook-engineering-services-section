#!/usr/bin/env node
/**
 * Accept one print edition against its layout proof, printing the
 * PrintEditionAcceptance; exits non-zero when acceptance is refused.
 *   node scripts/accept-print-edition.mjs <print-fabrication.json> <print-proof.json>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { acceptPrintEdition } from "../src/print-edition.mjs";

if (import.meta.main) {
  const [fabricationPath, proofPath] = process.argv.slice(2);
  if (!fabricationPath || !proofPath) throw new Error("usage: accept-print-edition.mjs <print-fabrication.json> <print-proof.json>");
  const result = acceptPrintEdition(JSON.parse(readFileSync(resolve(fabricationPath), "utf8")), JSON.parse(readFileSync(resolve(proofPath), "utf8")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "refused") process.exitCode = 1;
}
