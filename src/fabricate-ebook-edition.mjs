import { readMarkdownSource } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-structure";
import { projectMarkdownFeatures } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-features";
import { readMarkdownFrontmatter } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-frontmatter";
/**
 * Admit a digest-bound edition specification, render its EPUB and screen PDF,
 * and return only the realization evidence that the renderer actually made.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitArtifactFabricationRealizationPlan,
  admitArtifactFabricationSpecification,
} from "@red-cup-engineering/computer-data-engineering-services-section/artifact-fabrication";
import { designTokenStyle, listChapters, normalizeAssets, sha256File, sha256SourceHash } from "./ebook-production.mjs";
import { produceEbook } from "../scripts/produce-ebook.mjs";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const SECTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE = join(SECTION_ROOT, "templates", "book.latex");
const DEFAULT_CSS = join(SECTION_ROOT, "templates", "book.css");
const COVER_TEMPLATES = Object.freeze({ typographic: join(SECTION_ROOT, "templates", "cover.latex"), illustrated: join(SECTION_ROOT, "templates", "cover-illustrated.latex") });
const BOOK_LAYOUT_FILTER = join(SECTION_ROOT, "templates", "book-layout.lua");
const REQUIRED_PROJECTIONS = new Map([
  ["epub", "epub"],
  ["screen-pdf", "screen-pdf"],
]);
const FIXED_PROFILE = "epub-screen-pdf-v1";


function refused(code, message, detail = {}) {
  return Object.freeze({ type: "EbookEditionFabricationResult", version: 1, status: "refused", code, message, ...detail });
}

function admittedSpecification(candidate) {
  const specification = admitArtifactFabricationSpecification(candidate);
  if (specification.type === "ArtifactFabricationSpecificationRefusal") {
    return refused(specification.code, specification.message, { refusal: specification });
  }
  return specification;
}

function validateEditionProjections(specification) {
  if (specification.projections.length !== REQUIRED_PROJECTIONS.size) {
    return "An ebook edition requires exactly EPUB and screen-PDF projections.";
  }
  for (const projection of specification.projections) {
    if (REQUIRED_PROJECTIONS.get(projection.id) !== projection.target) {
      return "An ebook edition requires projections epub -> epub and screen-pdf -> screen-pdf.";
    }
    if (projection.configuration === null || typeof projection.configuration !== "object" || Array.isArray(projection.configuration)) {
      return "Each ebook projection configuration must be a fixed-profile record.";
    }
    const configurationKeys = Object.keys(projection.configuration).sort();
    if (configurationKeys.length !== 2 || configurationKeys[0] !== "editionInputDigest" || configurationKeys[1] !== "profile" || projection.configuration.profile !== FIXED_PROFILE || !isNiUri(projection.configuration.editionInputDigest)) {
      return "Each ebook projection must use the fixed epub-screen-pdf-v1 profile and one editionInputDigest content address.";
    }
  }
  if (specification.projections[0].configuration.editionInputDigest !== specification.projections[1].configuration.editionInputDigest) {
    return "EPUB and screen-PDF projections must bind the same editionInputDigest.";
  }
  return null;
}

function sourceDigest(source) {
  const chapters = listChapters(source.bookDir);
  const assets = normalizeAssets(source.assets);
  for (const asset of assets) if (relative(source.bookDir, asset.path).startsWith("..")) throw new Error(`declared asset must stay inside the book directory: ${asset.path}`);
  const declared = new Map(assets.map((asset) => [resolve(asset.path), asset]));
  for (const chapter of chapters) {
    const text = readFileSync(chapter, "utf8");
    const chapterArt = readMarkdownFrontmatter(text, { absentFrontmatter: "empty" }).frontmatter.art;
    const declaredChapterArt = typeof chapterArt === "string" ? declared.get(resolve(dirname(chapter), chapterArt)) : undefined;
    if (chapterArt !== undefined && (!declaredChapterArt || declaredChapterArt.role !== "chapter-art")) {
      const error = new Error(`chapter ${chapter} references undeclared frontmatter art ${JSON.stringify(chapterArt)}`);
      error.code = "UNDECLARED_EXTERNAL_ASSET";
      throw error;
    }
    const observed = readMarkdownSource(text);
    const features = projectMarkdownFeatures(observed);
    const definitions = new Map([...text.matchAll(/^\s*\[([^\]]+)\]:\s*(\S+)/gmu)].map((match) => [match[1].toLowerCase(), match[2].replace(/^<|>$/gu, "")]));
    const images = features.filter((feature) => feature.image === true);
    let prose = observed.text;
    for (const range of [...observed.codeRanges].reverse()) prose = prose.slice(0, range.start) + " ".repeat(range.end - range.start) + prose.slice(range.end);
    if (/\\includegraphics(?:\[[^\]]*\])?\{/u.test(prose)) {
      const error = new Error(`chapter ${chapter} references an undeclared external asset`);
      error.code = "UNDECLARED_EXTERNAL_ASSET";
      throw error;
    }
    for (const image of images) {
      const target = image.target ?? definitions.get(image.reference?.toLowerCase());
      const asset = target ? declared.get(resolve(dirname(chapter), target)) : undefined;
      if (!asset) {
        const error = new Error(`chapter ${chapter} references an undeclared external asset${target ? ` ${target}` : ""}`);
        error.code = "UNDECLARED_EXTERNAL_ASSET";
        throw error;
      }
      if (typeof image.label !== "string" || image.label.trim() === "") {
        const error = new Error(`chapter ${chapter} references ${target} without alt text`);
        error.code = "ASSET_ALT_TEXT_REQUIRED";
        throw error;
      }
      if (image.label.trim() !== asset.alt) {
        const error = new Error(`chapter ${chapter} alt text for ${target} must equal its manifest declaration`);
        error.code = "ASSET_ALT_TEXT_MISMATCH";
        throw error;
      }
    }
  }
  if (source.tokens !== undefined) {
    const theme = designTokenStyle(JSON.parse(readFileSync(source.tokens, "utf8"))).book;
    for (const [setting, value] of [["chapterArt", theme.chapterArt], ["sceneBreak", theme.sceneBreak]]) {
      if (["none", "chapter", "rule", "space"].includes(value)) continue;
      const asset = declared.get(resolve(source.bookDir, value));
      if (asset) {
        if (asset.role !== "ornament") {
          const error = new Error(`book theme ${setting} asset must have ornament role: ${value}`);
          error.code = "UNDECLARED_EXTERNAL_ASSET";
          throw error;
        }
        continue;
      }
      if (setting === "sceneBreak" && value.length <= 12) continue;
      {
        const error = new Error(`book theme ${setting} references undeclared asset ${value}`);
        error.code = "UNDECLARED_EXTERNAL_ASSET";
        throw error;
      }
    }
  }
  // The PDF's layout filter shapes its bytes as the template does, so both are bound.
  const chapterAndTemplateDigest = sha256SourceHash(chapters, sha256File(DEFAULT_TEMPLATE) + sha256File(BOOK_LAYOUT_FILTER), sha256File(DEFAULT_CSS), assets.map((asset) => sha256File(asset.path)));
  return semanticId({
    chapterAndTemplateDigest,
    slug: source.slug,
    title: source.title,
    subtitle: source.subtitle ?? null,
    author: source.author,
    // A publisher of record is bound only when an edition names one, as the style is below.
    ...(source.publisher === undefined ? {} : { publisher: source.publisher }),
    // The house style (division, colophon) is bound only when an edition names one, so editions
    // made without a style keep the digest they were admitted under.
    ...(source.style === undefined ? {} : { style: source.style }),
    // Design tokens are bound by their bytes, since the stylesheet and the
    // PDF's fonts and colors are derived from them at render time.
    ...(source.tokens === undefined ? {} : { designTokensDigest: sha256File(source.tokens) }),
    // A cover is set from its kind's template, so the template's bytes are bound too.
    ...(source.cover === undefined ? {} : { cover: source.cover, coverTemplateDigest: sha256File(COVER_TEMPLATES[source.cover]) }),
    // A book's own cover art (a TikZ drawing, or an illustration, beside its manuscript) is bound by its bytes.
    ...(source.coverArt === undefined ? {} : { coverArtDigest: sha256File(source.coverArt) }),
    ...(assets.length === 0 ? {} : { assets: assets.map((asset) => ({ path: relative(source.bookDir, asset.path), alt: asset.alt, role: asset.role, ...(asset.provenance === undefined ? {} : { provenance: asset.provenance }), digest: sha256File(asset.path) })) }),
    ...(source.series === undefined ? {} : { series: source.series }),
    // A copyright page is generated from the rights a book states, so they are bound like its text.
    ...(source.rights === undefined ? {} : { rights: source.rights }),
    // An edition date sets every timestamp the toolchain embeds, so it is bound
    // like any other input that shapes the bytes; editions without one keep
    // the digest they were admitted under.
    ...(source.date === undefined ? {} : { date: source.date }),
  });
}

/**
 * Describe the exact local bytes this adapter admits: ordered Markdown
 * chapters, its fixed template, and edition metadata. This does not claim
 * custody of fonts, the complete toolchain, or external assets.
 * @param {{slug: string, title: string, subtitle?: string, author: string, bookDir: string, tokens?: string}} source trusted Group-controlled manuscript paths
 * @returns {object} a digest description or a typed refusal
 */
export function describeEbookEditionSource(source) {
  try {
    return Object.freeze({
      type: "EbookEditionSourceDescription",
      version: 1,
      editionInputDigest: sourceDigest(source),
      coverage: Object.freeze(["ordered-markdown-chapters", "fixed-latex-template", "fixed-css-stylesheet", "edition-metadata", ...(source.tokens === undefined ? [] : ["design-tokens"]), ...((source.assets?.length ?? 0) === 0 ? [] : ["declared-assets"])]),
    });
  } catch (error) {
    const code = ["UNDECLARED_EXTERNAL_ASSET", "ASSET_ALT_TEXT_REQUIRED", "ASSET_ALT_TEXT_MISMATCH"].includes(error.code) ? error.code : "SOURCE_UNAVAILABLE";
    return Object.freeze({ type: "EbookEditionSourceDescriptionRefusal", version: 1, code, message: error.message });
  }
}

function verifiedArtifact(artifact) {
  if (!artifact || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string") {
    throw new Error("renderer returned an artifact without a path and SHA-256 digest");
  }
  const bytes = statSync(artifact.path).size;
  const digest = sha256File(artifact.path);
  if (bytes !== artifact.bytes || digest !== artifact.sha256) {
    throw new Error(`renderer artifact evidence does not match bytes at ${artifact.path}`);
  }
  return Object.freeze({ path: artifact.path, bytes, sha256: digest });
}

/**
 * @param {object} specificationCandidate closed-world generic fabrication candidate
 * @param {{slug: string, title: string, subtitle?: string, author: string, bookDir: string, distDir: string}} source trusted Group-controlled manuscript paths only; Pandoc/XeLaTeX is not a sandbox for untrusted uploads
 * @param {{renderer?: typeof produceEbook}} [capabilities] host-provided renderer capability; source never selects an executable
 * @returns {Promise<object>} a refused, failed, or fabricated-awaiting-acceptance result
 */
export async function fabricateEbookEdition(specificationCandidate, source, { renderer = produceEbook } = {}) {
  const specification = admittedSpecification(specificationCandidate);
  if (specification.status === "refused") return specification;

  const projectionError = validateEditionProjections(specification);
  if (projectionError) return refused("MISSING_REQUIRED_PROJECTION", projectionError, { specification });

  const sourceDescription = describeEbookEditionSource(source);
  if (sourceDescription.type === "EbookEditionSourceDescriptionRefusal") {
    return refused(sourceDescription.code, sourceDescription.message, { specification, sourceDescription });
  }
  const actualEditionInputDigest = sourceDescription.editionInputDigest;
  const admittedEditionInputDigest = specification.projections[0].configuration.editionInputDigest;
  if (actualEditionInputDigest !== admittedEditionInputDigest) {
    return refused("EDITION_INPUT_DIGEST_MISMATCH", "The edition source bytes do not match the editionInputDigest bound by the fixed projection profile.", { specification, actualEditionInputDigest });
  }

  const plan = admitArtifactFabricationRealizationPlan(specification, {
    type: "ArtifactFabricationRealizationPlanCandidate",
    version: 1,
    artifactId: specification.artifact.id,
    specificationDigest: specification.specificationDigest,
    projectionIds: specification.projections.map(({ id }) => id),
    acceptanceObligationIds: specification.acceptanceObligations.map(({ id }) => id),
  });
  if (plan.type === "ArtifactFabricationRealizationPlanRefusal") {
    return refused(plan.code, plan.message, { specification, refusal: plan });
  }

  let record;
  try {
    record = await renderer({
      slug: source.slug,
      title: source.title,
      subtitle: source.subtitle,
      author: source.author,
      ...(source.publisher === undefined ? {} : { publisher: source.publisher }),
      bookDir: source.bookDir,
      distDir: source.distDir,
      ...(source.style === undefined ? {} : { style: source.style }),
      ...(source.tokens === undefined ? {} : { tokens: source.tokens }),
      ...(source.cover === undefined ? {} : { cover: source.cover }),
      ...(source.coverArt === undefined ? {} : { coverArt: source.coverArt }),
      ...(source.coverArtProvenance === undefined ? {} : { coverArtProvenance: source.coverArtProvenance }),
      ...(source.assets === undefined ? {} : { assets: source.assets }),
      ...(source.series === undefined ? {} : { series: source.series }),
      ...(source.rights === undefined ? {} : { rights: source.rights }),
      ...(source.date === undefined ? {} : { date: source.date }),
    });
  } catch (error) {
    return Object.freeze({ type: "EbookEditionFabricationResult", version: 1, status: "failed", code: "RENDERER_FAILED", message: error.message, specification, plan });
  }

  const postRenderSourceDescription = describeEbookEditionSource(source);
  if (postRenderSourceDescription.type === "EbookEditionSourceDescriptionRefusal") {
    return Object.freeze({ type: "EbookEditionFabricationResult", version: 1, status: "failed", code: postRenderSourceDescription.code, message: postRenderSourceDescription.message, specification, plan });
  }
  if (postRenderSourceDescription.editionInputDigest !== actualEditionInputDigest) {
    return Object.freeze({ type: "EbookEditionFabricationResult", version: 1, status: "failed", code: "SOURCE_MUTATED_DURING_RENDER", message: "The source changed while the renderer was running.", specification, plan });
  }
  let artifacts;
  try {
    artifacts = Object.freeze({ epub: verifiedArtifact(record.artifacts.epub), screenPdf: verifiedArtifact(record.artifacts.pdf), buildRecordDigest: semanticId(record) });
  } catch (error) {
    return Object.freeze({ type: "EbookEditionFabricationResult", version: 1, status: "failed", code: "ARTIFACT_EVIDENCE_MISMATCH", message: error.message, specification, plan });
  }
  const formatEvidence = Object.freeze({
    renderer: Object.freeze({ outcome: "exited-successfully", toolchain: Object.freeze({ pandoc: record.pandocVersion, xelatex: record.xelatexVersion }) }),
    epub: Object.freeze({ outcome: "bytes-produced", conformance: "unassayed" }),
    screenPdf: Object.freeze({ outcome: "bytes-produced", conformance: "unassayed", printReadiness: "unassayed" }),
  });
  return Object.freeze({
    type: "EbookEditionFabricationResult",
    version: 1,
    status: "fabricated-awaiting-acceptance",
    specification,
    plan,
    artifacts,
    formatEvidence,
    pendingAcceptanceObligationIds: specification.acceptanceObligations.map(({ id }) => id),
  });
}

/**
 * The edition source an `ebook.json` manifest names: every field that shapes
 * the edition, with paths resolved against the manifest. The one reading of a
 * manifest into a source, for specifying, fabricating and carrying an edition.
 * @param {string} manifestPath the manifest file
 * @param {object} manifest its parsed contents
 * @param {string} distDir where the fabrication writes
 */
export function bookSource(manifestPath, manifest, distDir) {
  const root = dirname(resolve(manifestPath));
  return {
    slug: manifest.slug,
    title: manifest.title,
    subtitle: manifest.subtitle,
    author: manifest.author,
    ...(manifest.publisher ? { publisher: manifest.publisher } : {}),
    ...(manifest.style === undefined ? {} : { style: manifest.style }),
    ...(manifest.tokens ? { tokens: resolve(root, manifest.tokens) } : {}),
    ...(manifest.cover ? { cover: manifest.cover } : {}),
    ...(manifest.coverArt ? { coverArt: resolve(root, manifest.coverArt) } : {}),
    ...(manifest.coverArtProvenance ? { coverArtProvenance: manifest.coverArtProvenance } : {}),
    ...(manifest.assets ? { assets: manifest.assets.map((asset) => ({ ...asset, path: resolve(root, asset.path) })) } : {}),
    ...(manifest.series ? { series: manifest.series } : {}),
    ...(manifest.rights ? { rights: manifest.rights } : {}),
    ...(manifest.date ? { date: manifest.date } : {}),
    bookDir: resolve(root, manifest.bookDir ?? "."),
    distDir: resolve(distDir),
  };
}
