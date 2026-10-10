import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptEbookEdition, carryEbookEditionProof } from "../src/accept-ebook-edition.mjs";
import { nextEditionOrdinal } from "../src/carry-editions-forward.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/content/books/fixture-book");
const fixtureText = readFileSync(join(fixture, "01-opening.md"), "utf8");
const fabrication = (digest, epub, pdf) => ({
  type: "EbookEditionFabricationResult", status: "fabricated-awaiting-acceptance",
  specification: { projections: [{ configuration: { editionInputDigest: digest } }] },
  artifacts: { epub: { sha256: epub }, screenPdf: { sha256: pdf } }, pendingAcceptanceObligationIds: ["editorial-proof"],
});

test("carries the fixture book forward and refuses the changed fixture text", () => {
  const prior = fabrication("ni:///sha-256;old", "ni:///sha-256;old-epub", "ni:///sha-256;old-pdf");
  const priorProof = {
    type: "EbookEditionProof", version: 1, editionInputDigest: "ni:///sha-256;old",
    artifacts: { epub: "ni:///sha-256;old-epub", screenPdf: "ni:///sha-256;old-pdf" },
    proofer: "fixture-reader", writer: "fixture-writer", provedAt: "2026-09-27", method: `read ${fixtureText.length} bytes`,
    findings: [],
  };
  const priorAcceptance = acceptEbookEdition(prior, priorProof);
  const next = fabrication("ni:///sha-256;new", "ni:///sha-256;new-epub", "ni:///sha-256;new-pdf");
  const carried = carryEbookEditionProof({
    priorProof, priorAcceptance, fabrication: next,
    text: { prior: { epub: "ni:///sha-256;fixture", pdf: "ni:///sha-256;fixture" }, current: { epub: "ni:///sha-256;fixture", pdf: "ni:///sha-256;fixture" } },
  });
  assert.equal(carried.type, "EbookEditionProof");
  assert.equal(acceptEbookEdition(next, carried).status, "accepted");
  const changed = carryEbookEditionProof({
    priorProof, priorAcceptance, fabrication: next,
    text: { prior: { epub: "ni:///sha-256;fixture", pdf: "ni:///sha-256;fixture" }, current: { epub: "ni:///sha-256;changed", pdf: "ni:///sha-256;fixture" } },
  });
  assert.equal(changed.code, "TEXT_CHANGED");
  assert.equal(nextEditionOrdinal("first"), "second");
});

test("edition records follow the house names, and the prior edition is read from its acceptance record", async () => {
  const { editionRecordPaths, priorEditionOf, editionStateDir } = await import("../src/carry-editions-forward.mjs");
  const dir = "/x/section/data/records/editions";
  const paths = editionRecordPaths(dir, "2026-09-28", "ice-out", "second");
  assert.equal(paths.edition, `${dir}/2026-09-28-ice-out-second-edition.json`);
  assert.equal(paths.proof, `${dir}/2026-09-28-ice-out-second-edition-proof.json`);
  assert.equal(paths.acceptance, `${dir}/2026-09-28-ice-out-second-edition-acceptance.json`);
  const prior = priorEditionOf(`${dir}/2026-09-27-the-capm-domain-by-domain-fourth-edition-acceptance.json`);
  assert.equal(prior.ordinal, "fourth");
  assert.equal(prior.editionPath, `${dir}/2026-09-27-the-capm-domain-by-domain-fourth-edition.json`);
  assert.equal(nextEditionOrdinal(prior.ordinal), "fifth");
  assert.equal(editionStateDir(`${dir}/2026-09-27-ice-out-first-edition-acceptance.json`, "ice-out"), "/x/section/data/state/editions/ice-out");
  assert.throws(() => priorEditionOf(`${dir}/notes.json`));
});

test("the catalog takes a carried acceptance by id or by manuscript directory", async () => {
  const { catalogWithAcceptance } = await import("../src/carry-editions-forward.mjs");
  const catalog = { books: [
    { id: "ice-out", book: { manuscript: "fiction/content/books/ice-out", acceptance: "old" } },
    { id: "other", book: { manuscript: "x/content/books/the-x402-economy", acceptance: "old" } },
  ] };
  const one = catalogWithAcceptance(catalog, "ice-out", "new-ice");
  assert.equal(one.changed, 1);
  assert.equal(one.catalog.books[0].book.acceptance, "new-ice");
  assert.equal(catalog.books[0].book.acceptance, "old");
  const two = catalogWithAcceptance(catalog, "the-x402-economy", "new-x402");
  assert.equal(two.catalog.books[1].book.acceptance, "new-x402");
  assert.equal(catalogWithAcceptance(catalog, "absent", "z").changed, 0);
});
