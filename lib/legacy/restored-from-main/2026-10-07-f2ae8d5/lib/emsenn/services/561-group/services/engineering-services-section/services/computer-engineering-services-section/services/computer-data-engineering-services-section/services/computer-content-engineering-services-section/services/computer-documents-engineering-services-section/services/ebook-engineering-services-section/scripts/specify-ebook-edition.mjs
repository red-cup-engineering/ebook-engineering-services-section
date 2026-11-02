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
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listChapters } from "../src/ebook-production.mjs";
import { bookSource, describeEbookEditionSource } from "../src/fabricate-ebook-edition.mjs";
import { lintManuscript } from "../src/lint-manuscript.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { request: { type: "string" }, dist: { type: "string" }, "source-out": { type: "string" }, proof: { type: "string" } } });
const manifestPath = resolve(positionals[0] ?? "");
if (!positionals[0] || !values.request?.startsWith("ni:///sha-256;") || !values.dist) throw new Error("usage: specify-ebook-edition.mjs <ebook.json> --request <ni:///sha-256;...> --dist <dir> [--source-out <file>] [--proof <who proofs it>]");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const bookDir = resolve(dirname(manifestPath), manifest.bookDir ?? ".");
const storyBible = manifest.storyBible ? JSON.parse(readFileSync(resolve(dirname(manifestPath), manifest.storyBible), "utf8")) : undefined;
const lint = lintManuscript(listChapters(bookDir).map((path) => ({ path, text: readFileSync(path, "utf8") })), { profile: manifest.profile ?? "book", storyBible });
if (!lint.ok) {
  process.stderr.write(`${JSON.stringify(lint.findings.filter((finding) => finding.severity === "error"), null, 2)}\n`);
  throw new Error("the manuscript lint found errors; fix them before specifying an edition");
}
const source = bookSource(manifestPath, manifest, values.dist);
const described = describeEbookEditionSource(source);
if (described.type !== "EbookEditionSourceDescription") throw new Error(`${described.code}: ${described.message}`);
const hex = Buffer.from(values.request.split(";")[1], "base64url").toString("hex");
const span = { type: "ArtifactFabricationSourceSpan", startLine: 1, endLine: 1 };
const specification = {
  type: "ArtifactFabricationSpecificationCandidate", version: 1,
  source: { type: "ArtifactFabricationSource", version: 1, identity: { type: "ArtifactFabricationSourceIdentity", id: manifest.slug }, provenance: { type: "ArtifactFabricationSourceProvenance", locator: values.request, digest: `sha256:${hex}`, sourceSpan: span } },
  artifact: { type: "FabricatedArtifactIdentity", version: 1, id: `${manifest.slug}-edition`, kind: "ebook-edition" },
  requirements: [{ type: "ArtifactFabricationRequirement", version: 1, id: "edition", statement: `${manifest.title} as an EPUB and a screen PDF made by the house toolchain from its manuscript.`, sourceSpan: span }],
  prohibitions: [], openQuestions: [],
  constraints: [
    { type: "ArtifactFabricationConstraint", version: 1, id: "source-binding", kind: "law", authority: "SHA-256", revision: "FIPS 180-4", locator: "fips-180-4", applicability: "edition source", statement: "The admitted digest binds the chapter bytes, template, stylesheet, metadata and house style.", sourceSpan: span },
    { type: "ArtifactFabricationConstraint", version: 1, id: "epub-standard", kind: "standard", authority: "W3C", revision: "EPUB 3.3", locator: "w3.org/TR/epub-33/", applicability: "EPUB projection", statement: "EPUB conformance is assayed separately.", sourceSpan: span },
  ],
  projections: ["epub", "screen-pdf"].map((id) => ({ type: "ArtifactFabricationProjection", version: 1, id, target: id, configuration: { profile: "epub-screen-pdf-v1", editionInputDigest: described.editionInputDigest }, sourceSpan: span })),
  acceptanceObligations: [{ type: "ArtifactFabricationAcceptanceObligation", version: 1, id: "editorial-proof", kind: "review", statement: values.proof ?? "The edition is proofed before it is handed to its readers.", sourceSpan: span }],
  traceability: [{ type: "ArtifactFabricationTrace", version: 1, requirementId: "edition", constraintIds: ["source-binding", "epub-standard"], projectionIds: ["epub", "screen-pdf"], acceptanceObligationIds: ["editorial-proof"] }],
};
writeFileSync(resolve(bookDir, "edition-specification.json"), `${JSON.stringify(specification, null, 2)}\n`);
if (values["source-out"]) writeFileSync(resolve(values["source-out"]), `${JSON.stringify(source, null, 2)}\n`);
console.log(JSON.stringify({ specification: resolve(bookDir, "edition-specification.json"), editionInputDigest: described.editionInputDigest, source }, null, 2));
