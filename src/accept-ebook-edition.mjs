/**
 * Closing an edition's editorial-proof obligation: the write-to-design edge's
 * acceptance, the record that turns a fabricated edition into one an offer may
 * sell (the Group's publishing program note: only a stated acceptance turns an
 * edited state into an edition eligible for release).
 *
 * A proof is a record of one reader's pass over one exact edition:
 *   { type: "EbookEditionProof", version: 1, editionInputDigest, artifacts: { epub, screenPdf }, proofer, writer, provedAt,
 *     method, findings: [{ id, file, severity: "error"|"correction"|"note", claim, source?, fix?, resolution: "fixed"|"declined"|"open", reason? }] }
 * `artifacts` names the sha256 content address of each file the proofer read.
 * The input digest binds the sources; the artifact digests bind the bytes, which
 * also depend on the renderer, so a proof read on one build never accepts
 * another. The edition is accepted only when the proof names its digests, the proofer
 * is not its writer, and no error or correction is left open or fixed
 * without saying how.
 */
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";

const SEVERITIES = new Set(["error", "correction", "note"]);
const RESOLUTIONS = new Set(["fixed", "declined", "open"]);

function refused(code, message, detail = {}) {
  return Object.freeze({ type: "EbookEditionAcceptance", version: 1, status: "refused", code, message, ...detail });
}

/**
 * @param {object} fabrication an EbookEditionFabricationResult at fabricated-awaiting-acceptance
 * @param {object} proof an EbookEditionProof
 * @param {{now?: string}} [options]
 * @returns {object} an accepted or refused EbookEditionAcceptance
 */
export function acceptEbookEdition(fabrication, proof, { now = new Date().toISOString() } = {}) {
  if (fabrication?.type !== "EbookEditionFabricationResult" || fabrication.status !== "fabricated-awaiting-acceptance") {
    return refused("NOT_AWAITING_ACCEPTANCE", "Only a fabricated edition awaiting acceptance can be accepted.");
  }
  const editionInputDigest = fabrication.specification?.projections?.[0]?.configuration?.editionInputDigest;
  if (proof?.type !== "EbookEditionProof" || proof.version !== 1) return refused("NOT_A_PROOF", "The proof is not an EbookEditionProof record.");
  if (proof.editionInputDigest !== editionInputDigest) {
    return refused("PROOF_OF_ANOTHER_EDITION", "The proof names another edition's input digest.", { editionInputDigest, proofDigest: proof.editionInputDigest });
  }
  const read = { epub: proof.artifacts?.epub, screenPdf: proof.artifacts?.screenPdf };
  const built = { epub: fabrication.artifacts?.epub?.sha256, screenPdf: fabrication.artifacts?.screenPdf?.sha256 };
  if (read.epub !== built.epub || read.screenPdf !== built.screenPdf) {
    return refused("PROOF_OF_OTHER_BYTES", "The proof must name the EPUB and PDF digests of the fabricated edition it read.", { artifacts: built, proofArtifacts: read });
  }
  if (typeof proof.proofer !== "string" || proof.proofer === "" || proof.proofer === proof.writer) {
    return refused("PROOFER_IS_WRITER", "The proofer must be named and must not be the edition's writer.");
  }
  if (!Array.isArray(proof.findings) || proof.findings.some((finding) => !SEVERITIES.has(finding?.severity) || !RESOLUTIONS.has(finding?.resolution))) {
    return refused("MALFORMED_FINDINGS", "Every finding needs a severity (error, correction, note) and a resolution (fixed, declined, open).");
  }
  const blocking = proof.findings.filter((finding) => finding.severity !== "note"
    && (finding.resolution === "open" || (finding.resolution === "declined" && !finding.reason) || (finding.resolution === "fixed" && !finding.fix)));
  if (blocking.length > 0) {
    return refused("FINDINGS_UNRESOLVED", "Errors and corrections must be fixed, or declined with a reason, before acceptance.", { unresolved: blocking.map((finding) => finding.id) });
  }
  const pending = (fabrication.pendingAcceptanceObligationIds ?? []).filter((id) => id !== "editorial-proof");
  const count = (severity) => proof.findings.filter((finding) => finding.severity === severity).length;
  return Object.freeze({
    type: "EbookEditionAcceptance",
    version: 1,
    status: pending.length === 0 ? "accepted" : "partially-accepted",
    editionInputDigest,
    artifacts: fabrication.artifacts,
    closedObligationIds: Object.freeze(["editorial-proof"]),
    pendingAcceptanceObligationIds: Object.freeze(pending),
    proof: Object.freeze({
      digest: semanticId(proof),
      proofer: proof.proofer,
      provedAt: proof.provedAt,
      method: proof.method,
      findings: Object.freeze({ errors: count("error"), corrections: count("correction"), notes: count("note") }),
    }),
    acceptedAt: now,
  });
}

/**
 * Carry an accepted edition's proof to a new edition whose text is the same:
 * a re-rendering that changes only what the text is laid into (embedded
 * timestamps, identifiers, the renderer) is read by no one, because nothing a
 * reader reads changed. The carried proof names the new edition's digests and
 * keeps the original proofer, writer and findings; its method says it was
 * carried, from which proof, and on what evidence: the digests of the two
 * editions' extracted text, which must be equal.
 * @param {{priorProof: object, priorAcceptance: object, fabrication: object,
 *   text: {prior: {epub: string, pdf: string}, current: {epub: string, pdf: string}}, now?: string}} input
 *   `text` holds content addresses of each edition's extracted EPUB and PDF text
 * @returns {object} an EbookEditionProof, or a refusal
 */
export function carryEbookEditionProof({ priorProof, priorAcceptance, fabrication, text, now = new Date().toISOString() }) {
  const refusal = (code, message) => Object.freeze({ type: "EbookEditionProofCarryRefusal", version: 1, code, message });
  if (priorAcceptance?.type !== "EbookEditionAcceptance" || priorAcceptance.status !== "accepted") return refusal("PRIOR_NOT_ACCEPTED", "Only an accepted edition's proof can be carried.");
  if (priorProof?.type !== "EbookEditionProof" || semanticId(priorProof) !== priorAcceptance.proof?.digest) return refusal("PROOF_NOT_THE_ACCEPTED_ONE", "The proof is not the one the prior edition was accepted on.");
  if (fabrication?.type !== "EbookEditionFabricationResult" || fabrication.status !== "fabricated-awaiting-acceptance") return refusal("NOT_AWAITING_ACCEPTANCE", "Only a fabricated edition awaiting acceptance can take a carried proof.");
  if (!text?.prior?.epub || text.prior.epub !== text.current?.epub || !text.prior.pdf || text.prior.pdf !== text.current?.pdf) {
    return refusal("TEXT_CHANGED", "The new edition's text is not the proofed edition's; it needs its own proof.");
  }
  return Object.freeze({
    type: "EbookEditionProof",
    version: 1,
    editionInputDigest: fabrication.specification.projections[0].configuration.editionInputDigest,
    artifacts: Object.freeze({ epub: fabrication.artifacts.epub.sha256, screenPdf: fabrication.artifacts.screenPdf.sha256 }),
    proofer: priorProof.proofer,
    writer: priorProof.writer,
    provedAt: priorProof.provedAt,
    carried: Object.freeze({
      from: priorAcceptance.editionInputDigest,
      proof: priorAcceptance.proof.digest,
      at: now,
      text: Object.freeze({ epub: text.current.epub, pdf: text.current.pdf }),
    }),
    method: `Carried from the proof of edition ${priorAcceptance.editionInputDigest} (proof ${priorAcceptance.proof.digest}): this edition's extracted text equals that edition's (EPUB ${text.current.epub}, PDF ${text.current.pdf}, the colophon's build digest set aside and whitespace collapsed), so the findings read on it hold here. The original pass: ${priorProof.method}`,
    findings: priorProof.findings,
  });
}
