import { readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

export function ordinal(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("edition ordinal must be a positive integer");
  return ORDINALS[n - 1] ?? `${n}th`;
}

export function nextEditionOrdinal(latestOrdinal) {
  const index = ORDINALS.indexOf(latestOrdinal);
  if (index >= 0) return ordinal(index + 2);
  const number = Number(latestOrdinal);
  return ordinal(number + 1);
}

/** The house names an edition's records <date>-<slug>-<ordinal>-edition.json, -edition-proof.json and -edition-acceptance.json. */
export function editionRecordPaths(recordsDir, date, slug, editionOrdinal) {
  const stem = `${date}-${slug}-${editionOrdinal}-edition`;
  const home = resolve(recordsDir);
  return Object.freeze({
    edition: join(home, `${stem}.json`),
    proof: join(home, `${stem}-proof.json`),
    acceptance: join(home, `${stem}-acceptance.json`),
  });
}

/** The prior edition's fabrication record and ordinal, read from its acceptance record's name. */
export function priorEditionOf(acceptancePath) {
  const name = basename(acceptancePath);
  const match = name.match(/-(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)-edition-acceptance\.json$/u);
  if (!match) throw new Error(`${name} is not named <date>-<slug>-<ordinal>-edition-acceptance.json`);
  return Object.freeze({ editionPath: join(dirname(acceptancePath), name.replace(/-acceptance\.json$/u, ".json")), ordinal: match[1] });
}

/** A book's edition state directory: <section>/data/state/editions/<slug>, beside <section>/data/records/editions. */
export function editionStateDir(acceptancePath, slug) {
  return resolve(dirname(acceptancePath), "..", "..", "state", "editions", slug);
}

/**
 * Where a book's next edition goes and what it is called. After a prior edition, beside that
 * edition's records under the next ordinal; a book with no edition yet gets its first in the
 * state directory its manifest names (`distDir`), with records in the section's
 * data/records/editions, and is refused if that directory already holds one of its editions.
 */
export function editionHome(manifestPath, manifest, priorAcceptancePath) {
  if (priorAcceptancePath) return Object.freeze({ stateDir: editionStateDir(priorAcceptancePath, manifest.slug), recordsDir: dirname(resolve(priorAcceptancePath)), ordinal: nextEditionOrdinal(priorEditionOf(priorAcceptancePath).ordinal) });
  if (!manifest.distDir) throw new Error(`${manifest.slug} names no distDir, so its first edition has no home`);
  const stateDir = resolve(dirname(resolve(manifestPath)), manifest.distDir);
  const recordsDir = resolve(stateDir, "..", "..", "..", "records", "editions");
  const own = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${manifest.slug}-[a-z0-9]+-edition-acceptance\\.json$`, "u");
  let existing = [];
  try { existing = readdirSync(recordsDir).filter((name) => own.test(name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing.length) throw new Error(`${manifest.slug} already has an edition (${existing.at(-1)}); issue the next one from it`);
  return Object.freeze({ stateDir, recordsDir, ordinal: "first" });
}

export function carriedSpecification(previous, editionInputDigest) {
  const next = structuredClone(previous);
  delete next.specificationDigest;
  next.type = "ArtifactFabricationSpecificationCandidate";
  for (const projection of next.projections ?? []) {
    projection.configuration = { ...projection.configuration, editionInputDigest };
  }
  return next;
}

export function acceptanceStatement(specification) {
  return specification?.acceptanceObligations?.find((obligation) => obligation.id === "editorial-proof")?.statement;
}

function rewritePaths(value, paths) {
  const next = structuredClone(value);
  if (next?.artifacts?.epub) next.artifacts.epub.path = paths.epub;
  if (next?.artifacts?.screenPdf) next.artifacts.screenPdf.path = paths.pdf;
  if (next?.artifacts?.pdf) next.artifacts.pdf.path = paths.pdf;
  return next;
}

export function recordsForHome(fabrication, proof, acceptance, home) {
  const paths = { epub: join(home, basename(fabrication.artifacts.epub.path)), pdf: join(home, basename(fabrication.artifacts.screenPdf.path)) };
  return Object.freeze({
    fabrication: rewritePaths(fabrication, paths),
    proof: structuredClone(proof),
    acceptance: rewritePaths(acceptance, paths),
  });
}

export { bookSource } from "./fabricate-ebook-edition.mjs";

/**
 * The shop catalog with a book's acceptance record replaced. Catalog entries name a book by `id`
 * (or by the manuscript directory their `book.manuscript` points at); paths are relative to the
 * services root. Returns the catalog and how many entries changed.
 */
export function catalogWithAcceptance(catalog, slug, acceptance) {
  let changed = 0;
  const visit = (value) => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(visit);
    const names = value.id === slug || value.slug === slug || basename(value.book?.manuscript ?? "") === slug;
    const next = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, visit(inner)]));
    if (names && next.book && typeof next.book === "object") { next.book = { ...next.book, acceptance }; changed += 1; }
    return next;
  };
  return Object.freeze({ catalog: visit(catalog), changed });
}

/** Resolve a book's paid-release namespace before any edition state changes. */
export function offeringForEdition(catalog, slug, explicit) {
  if (!catalog) return explicit ?? slug;
  const rows = (catalog.offerings ?? []).filter(row => row.id === slug || row.slug === slug || basename(row.book?.manuscript ?? "") === slug);
  if (rows.length !== 1 || typeof rows[0].release !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(rows[0].release)) throw new TypeError(`the catalog must name exactly one paid-release namespace for ${slug}`);
  if (explicit && explicit !== rows[0].release) throw new TypeError(`the explicit offering differs from ${slug}'s catalog release`);
  return rows[0].release;
}
