import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { listChapters } from "./ebook-production.mjs";
import { bookSource, describeEbookEditionSource } from "./fabricate-ebook-edition.mjs";
import { lintManuscript } from "./lint-manuscript.mjs";

/** Pure/read-only specification step split from the historical write-oriented CLI. */
export function specifyEbookEdition({ manifestPath, request, distDir, proof = "An independent provider proofs the exact edition." }) {
  if (!request?.startsWith("ni:///sha-256;")) throw new TypeError("edition request must be an ni SHA-256 address");
  const absoluteManifest = resolve(manifestPath), manifest = JSON.parse(readFileSync(absoluteManifest, "utf8")), manifestDir = dirname(absoluteManifest);
  const bookDir = resolve(manifestDir, manifest.bookDir ?? ".");
  const storyBible = manifest.storyBible ? JSON.parse(readFileSync(resolve(manifestDir, manifest.storyBible), "utf8")) : undefined;
  const lint = lintManuscript(listChapters(bookDir).map((path) => ({ path, text: readFileSync(path, "utf8") })), { profile: manifest.profile ?? "book", storyBible });
  if (!lint.ok) return Object.freeze({ status: "refused", code: "manuscript-lint", lint });
  const source = bookSource(absoluteManifest, manifest, distDir);
  const described = describeEbookEditionSource(source); if (described.type !== "EbookEditionSourceDescription") return Object.freeze({ status: "refused", code: described.code, description: described });
  const hex = Buffer.from(request.split(";")[1], "base64url").toString("hex"), span = { type: "ArtifactFabricationSourceSpan", startLine: 1, endLine: 1 };
  const specification = {
    type: "ArtifactFabricationSpecificationCandidate", version: 1,
    source: { type: "ArtifactFabricationSource", version: 1, identity: { type: "ArtifactFabricationSourceIdentity", id: manifest.slug }, provenance: { type: "ArtifactFabricationSourceProvenance", locator: request, digest: `sha256:${hex}`, sourceSpan: span } },
    artifact: { type: "FabricatedArtifactIdentity", version: 1, id: `${manifest.slug}-edition`, kind: "ebook-edition" },
    requirements: [{ type: "ArtifactFabricationRequirement", version: 1, id: "edition", statement: `${manifest.title} as EPUB and screen PDF from its admitted manuscript.`, sourceSpan: span }], prohibitions: [], openQuestions: [],
    constraints: [
      { type: "ArtifactFabricationConstraint", version: 1, id: "source-binding", kind: "law", authority: "SHA-256", revision: "FIPS 180-4", locator: "fips-180-4", applicability: "edition source", statement: "The admitted digest binds the edition inputs.", sourceSpan: span },
      { type: "ArtifactFabricationConstraint", version: 1, id: "epub-standard", kind: "standard", authority: "W3C", revision: "EPUB 3.3", locator: "w3.org/TR/epub-33/", applicability: "EPUB projection", statement: "Release conformance is assayed with the named validator profile.", sourceSpan: span },
      { type: "ArtifactFabricationConstraint", version: 1, id: "epub-validator-profile", kind: "standard", authority: "EPUBCheck", revision: "5.3.0", locator: "github.com/w3c/epubcheck/releases/tag/v5.3.0", applicability: "EPUB 3.3 release gate", statement: "The blocking release profile is EPUB 3.3 with EPUBCheck 5.3.0; EPUBCheck 5.4.0 is a non-blocking EPUB 3.4 observation lane.", sourceSpan: span },
      { type: "ArtifactFabricationConstraint", version: 1, id: "retailer-portability", kind: "standard", authority: "561 Group", revision: "kindle-reflowable-2026-09", locator: "kindle-reflowable-2026-09", applicability: "retail EPUB projection", statement: "Reader-controlled reflow and semantic navigation remain effective; unsupported features are reported, never silently rewritten.", sourceSpan: span },
    ],
    projections: ["epub", "screen-pdf"].map((id) => ({ type: "ArtifactFabricationProjection", version: 1, id, target: id, configuration: { profile: "epub-screen-pdf-v1", editionInputDigest: described.editionInputDigest }, sourceSpan: span })),
    acceptanceObligations: [
      { type: "ArtifactFabricationAcceptanceObligation", version: 1, id: "editorial-proof", kind: "review", statement: proof, sourceSpan: span },
      { type: "ArtifactFabricationAcceptanceObligation", version: 1, id: "epub-conformance", kind: "assay", statement: "A machine-readable EPUBCheck 5.3.0 report must bind and pass the exact EPUB bytes.", sourceSpan: span },
      { type: "ArtifactFabricationAcceptanceObligation", version: 1, id: "accessibility-assessment", kind: "assay", statement: "Accessibility evidence must distinguish automated Ace evidence, manual assessment, and untested observations without making an unsupported conformance claim.", sourceSpan: span },
    ],
    traceability: [{ type: "ArtifactFabricationTrace", version: 1, requirementId: "edition", constraintIds: ["source-binding", "epub-standard", "epub-validator-profile", "retailer-portability"], projectionIds: ["epub", "screen-pdf"], acceptanceObligationIds: ["editorial-proof", "epub-conformance", "accessibility-assessment"] }],
  };
  return Object.freeze({ status: "specified", specification, source, lint, editionInputDigest: described.editionInputDigest });
}
