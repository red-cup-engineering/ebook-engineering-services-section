#!/usr/bin/env node
/**
 * Specify one edition of a book: from its `ebook.json`, the request the edition answers (an ni
 * address), and where its bytes go, write `edition-specification.json` beside the manuscript (the
 * digest-bound specification `fabricate-ebook-edition.mjs` admits) and print the edition source.
 * The specification binds the current chapter bytes, so it is written again whenever they change.
 * The manuscript lint runs first, with the manifest's profile (and story bible), and an error
 * finding refuses the specification: design never starts on a failing draft.
 *   node scripts/specify-ebook-edition.mjs <ebook.json> --request <ni> --dist <dir> [--source-out <file>]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { specifyEbookEdition } from "../src/specify-ebook-edition.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { request: { type: "string" }, dist: { type: "string" }, "source-out": { type: "string" }, proof: { type: "string" } } });
const manifestPath = resolve(positionals[0] ?? "");
if (!positionals[0] || !values.request?.startsWith("ni:///sha-256;") || !values.dist) throw new Error("usage: specify-ebook-edition.mjs <ebook.json> --request <ni:///sha-256;...> --dist <dir> [--source-out <file>] [--proof <who proofs it>]");
const result = specifyEbookEdition({ manifestPath, request: values.request, distDir: values.dist, proof: values.proof });
if (result.status !== "specified") {
  if (result.lint?.ok === false) {
    process.stderr.write(`${JSON.stringify(result.lint.findings.filter((finding) => finding.severity === "error"), null, 2)}\n`);
    throw new Error("the manuscript lint found errors; fix them before specifying an edition");
  }
  throw new Error(`${result.code ?? "specification-refused"}: ${result.description?.message ?? "edition specification refused"}`);
}
const specificationPath = resolve(result.source.bookDir, "edition-specification.json");
writeFileSync(specificationPath, `${JSON.stringify(result.specification, null, 2)}\n`);
if (values["source-out"]) writeFileSync(resolve(values["source-out"]), `${JSON.stringify(result.source, null, 2)}\n`);
console.log(JSON.stringify({ specification: specificationPath, editionInputDigest: result.editionInputDigest, source: result.source }, null, 2));
