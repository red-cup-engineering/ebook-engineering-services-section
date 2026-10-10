import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptEbookEdition } from "../src/accept-ebook-edition.mjs";

const fabrication = { type: "EbookEditionFabricationResult", status: "fabricated-awaiting-acceptance", specification: { projections: [{ configuration: { editionInputDigest: "ni:///sha-256;edition" } }] }, artifacts: { epub: { sha256: "ni:///sha-256;epub" }, screenPdf: { sha256: "ni:///sha-256;pdf" } }, pendingAcceptanceObligationIds: ["editorial-proof"] };
const proof = (findings, overrides = {}) => ({ type: "EbookEditionProof", version: 1, editionInputDigest: "ni:///sha-256;edition", artifacts: { epub: "ni:///sha-256;epub", screenPdf: "ni:///sha-256;pdf" }, proofer: "reader", writer: "writer", provedAt: "2026-09-27", method: "against sources", findings, ...overrides });

test("an edition whose errors are all fixed is accepted", () => {
  const result = acceptEbookEdition(fabrication, proof([{ id: "f1", severity: "error", resolution: "fixed", fix: "corrected the date" }, { id: "f2", severity: "note", resolution: "open" }]), { now: "2026-09-27T00:00:00Z" });
  assert.equal(result.status, "accepted");
  assert.deepEqual({ ...result.proof.findings }, { errors: 1, corrections: 0, notes: 1 });
});

test("an open error, a proof of another edition, or a writer proofing their own work is refused", () => {
  assert.equal(acceptEbookEdition(fabrication, proof([{ id: "f1", severity: "error", resolution: "open" }])).code, "FINDINGS_UNRESOLVED");
  assert.equal(acceptEbookEdition(fabrication, proof([], { editionInputDigest: "ni:///sha-256;other" })).code, "PROOF_OF_ANOTHER_EDITION");
  assert.equal(acceptEbookEdition(fabrication, proof([], { proofer: "writer" })).code, "PROOFER_IS_WRITER");
  assert.equal(acceptEbookEdition(fabrication, proof([], { artifacts: { epub: "ni:///sha-256;epub", screenPdf: "ni:///sha-256;rebuilt" } })).code, "PROOF_OF_OTHER_BYTES");
});

test("a proof is carried to a re-rendered edition only when its text is the proofed edition's, and says so", async () => {
  const { acceptEbookEdition, carryEbookEditionProof } = await import("../src/accept-ebook-edition.mjs");
  const fab = (digest, epub, pdf) => ({ type: "EbookEditionFabricationResult", status: "fabricated-awaiting-acceptance", specification: { projections: [{ configuration: { editionInputDigest: digest } }] }, artifacts: { epub: { sha256: epub }, screenPdf: { sha256: pdf } }, pendingAcceptanceObligationIds: ["editorial-proof"] });
  const priorFab = fab("ni:///sha-256;old", "ni:///sha-256;e1", "ni:///sha-256;p1");
  const priorProof = { type: "EbookEditionProof", version: 1, editionInputDigest: "ni:///sha-256;old", artifacts: { epub: "ni:///sha-256;e1", screenPdf: "ni:///sha-256;p1" }, proofer: "reader", writer: "writer", provedAt: "2026-09-27T00:00:00Z", method: "read it", findings: [{ id: "f1", severity: "error", claim: "x", fix: "y", resolution: "fixed" }] };
  const priorAcceptance = acceptEbookEdition(priorFab, priorProof);
  assert.equal(priorAcceptance.status, "accepted");
  const next = fab("ni:///sha-256;new", "ni:///sha-256;e2", "ni:///sha-256;p2");
  const same = { prior: { epub: "ni:///sha-256;t1", pdf: "ni:///sha-256;t2" }, current: { epub: "ni:///sha-256;t1", pdf: "ni:///sha-256;t2" } };
  const carried = carryEbookEditionProof({ priorProof, priorAcceptance, fabrication: next, text: same, now: "2026-09-28T00:00:00Z" });
  assert.equal(carried.type, "EbookEditionProof");
  assert.deepEqual({ ...carried.artifacts }, { epub: "ni:///sha-256;e2", screenPdf: "ni:///sha-256;p2" });
  assert.equal(carried.proofer, "reader");
  assert.equal(carried.carried.from, "ni:///sha-256;old");
  assert.match(carried.method, /^Carried from the proof of edition ni:\/\/\/sha-256;old/);
  const accepted = acceptEbookEdition(next, carried);
  assert.equal(accepted.status, "accepted");
  assert.deepEqual({ ...accepted.proof.findings }, { errors: 1, corrections: 0, notes: 0 });
  assert.equal(carryEbookEditionProof({ priorProof, priorAcceptance, fabrication: next, text: { ...same, current: { ...same.current, pdf: "ni:///sha-256;other" } } }).code, "TEXT_CHANGED");
  assert.equal(carryEbookEditionProof({ priorProof: { ...priorProof, method: "altered" }, priorAcceptance, fabrication: next, text: same }).code, "PROOF_NOT_THE_ACCEPTED_ONE");
});
