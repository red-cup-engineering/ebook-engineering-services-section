/**
 * @module record-founding
 * Writes the one-time founding receipt for this section into its own
 * data/records/. Not a runtime FAE-root journal -- a single dated record
 * of how the section came to exist, per house convention for a section
 * carrying data/ for its own founding receipt only.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSemanticRecordJournal } from "@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record";

const SECTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACTOR = "ebook-production-services-section";
const OBJECT_KIND = "ebook-production-services-section.founding-record";
const CATEGORY = "ebook-production-services-section.founding";

/**
 * @param {{ dataRoot?: string }} [options]
 * @returns {ReturnType<typeof createSemanticRecordJournal>}
 */
function journal(options = {}) {
  return createSemanticRecordJournal({
    root: resolve(options.dataRoot ?? join(SECTION_ROOT, "data/records")),
    objectKind: OBJECT_KIND,
  });
}

/**
 * @param {{ dataRoot?: string, recordedAt?: string }} [options]
 * @returns {ReturnType<ReturnType<typeof createSemanticRecordJournal>["record"]>}
 */
export function recordFounding(options = {}) {
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  const record = {
    type: "EbookProductionServicesSectionFoundingRecord",
    provider: ACTOR,
    recordedAt,
    built: {
      packageName: "@red-cup-engineering/ebook-engineering-services-section",
      publishedVersion: "0.1.6",
      seatRationale:
        "pandoc-services-section's own README states its scope is codec conversion, explicitly not release to an audience surface; ebook production (multi-chapter assembly, cover art, deterministic build record, EPUB+PDF release) is the natural sibling book document-genre package, seated beside pandoc-services-section and articles-services-section under documents-services-section.",
      coverDependency: {
        name: "@red-cup-engineering/computer-inference-engine/image/image-generation",
        pinnedVersion: "0.1.1",
      },
      differentiator:
        "a hash-verified, reproducible build record proving exactly what inputs (chapter set + LaTeX template) produced these exact output bytes -- Reedsy, Draft2Digital, Vellum, Atticus, KDP, IngramSpark, and Pressbooks offer no equivalent.",
    },
    publish: {
      outcome: "published",
      finalVersion: "0.1.6",
      versionHistory: [
        { version: "0.1.0", note: "first publish; npm silently dropped the bin field because apps/ebook-production-cli.mjs lacked the executable bit" },
        { version: "0.1.1", note: "chmod +x on the CLI entry; npm still dropped bin because the bin path used a leading ./ npm's normalizer rejects" },
        { version: "0.1.2", note: "bin path corrected to a bare relative path (apps/ebook-production-cli.mjs); bin wiring confirmed live via npm view" },
        { version: "0.1.3", note: "exports map broadened to include ./scripts/produce-ebook.mjs and ./scripts/produce-set-of-ebooks.mjs -- the migration target needed produceEbook, which the original './' -> src-only exports map did not expose" },
        { version: "0.1.4", note: "added the semantic-record-journal-service dependency and this founding-receipt script" },
        { version: "0.1.5", note: "discovered pandoc's EPUB writer stamps a random UUID and wall-clock date/dcterms:modified, and xelatex stamps a wall-clock CreationDate, undermining reproducibility; pinned identifier/date metadata and SOURCE_DATE_EPOCH to the source's own latest-mtime, with two disclosed residuals: pandoc 3.1.3's dcterms:modified has no metadata override, and this box's xdvipdfmx (TeX Live 2022) stamps trailer /ID entropy SOURCE_DATE_EPOCH does not reach -- see README Reproducibility section" },
      ],
    },
    migration: {
      consumer: "artificial-intelligence-curriculum-enterprise (scripts/build-ebook.mjs)",
      dependencyPin: "0.1.5",
      oldHash: {
        epubSha256: "41aef391e0adceecf22dda236a2d1cbf3813960505bf8ca8bbd8531791e6854b",
        pdfSha256: "18976a5b173f4fac099d137636ae3f277f03ce1cc53a95fe8a9c28367aa054d1",
      },
      newHash: {
        epubSha256: "e3f59cd43811bb40ceea4243d9f9092d50d860b300013486e3b391c6f5ce349c",
        pdfSha256: "e40e25abe150a606a161b0e46747965b16f76c2bfb4284febafa34c1d11330e2",
      },
      hashChangeExplanation:
        "expected template upgrade, not a regression: the old build used pandoc's bare default LaTeX template with -V documentclass=book; the new build uses this section's own templates/book.latex, adding a real title page and a colophon printing a source-hash variable. Cover generation was left unset for this migration so the hash-change explanation stays isolated to the template upgrade alone. (Two intermediate rebuilds at 0.1.3/0.1.4 produced other transient hashes before this final one at 0.1.5, which also fixed EPUB/PDF build-timestamp non-determinism -- see this record's publish.versionHistory.)",
    },
    testCount: { tests: 9, pass: 9, fail: 0, suite: "ebook-production-services-section test/ebook-production.test.mjs" },
  };
  return journal(options).record({
    category: CATEGORY,
    recordedAt,
    record,
    told: { for: true, against: false },
    relation: { subject: ACTOR, predicate: "founds", object: "@red-cup-engineering/ebook-engineering-services-section" },
  });
}

export const operation = Object.freeze({ name: "record-founding", description: "recordFounding — the record-founding operation.", operation: recordFounding });
