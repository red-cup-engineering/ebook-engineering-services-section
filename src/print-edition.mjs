/**
 * @module print-edition
 * A book's print edition: a paperback's interior and full-wrap cover,
 * printed on demand. The rules are KDP's for a black-ink paperback (KDP Help:
 * "Paperback Submission Guidelines", "Set Trim Size, Bleed, and Margins",
 * "Create a Paperback Cover", read 2026-09-29), which are also the tightest of
 * the print-on-demand services the house sells through; the house's own
 * margins sit inside them.
 *
 * A print edition prints an accepted edition's text. The acceptance names
 * that edition, the preflight that the files meet the printer's rules, and a
 * layout proof of the printed pages. Pure: the effects are in
 * scripts/produce-print-edition.mjs.
 */

const PT_PER_INCH = 72;

export const KDP_PAPERBACK = Object.freeze({
  bleed: 0.125,
  /** Black ink on white or cream paper. */
  pages: Object.freeze({ min: 24, max: 828 }),
  /** Inches of spine per page. */
  spinePerPage: Object.freeze({ white: 0.002252, cream: 0.0025 }),
  /** KDP prints spine text only on a book of more than 79 pages, kept 0.0625 in from each fold. */
  spineText: Object.freeze({ minPages: 80, margin: 0.0625 }),
  /** The least inside margin for a page count, [up to pages, inches]; the outside, top and bottom margins are at least 0.25 in. */
  gutter: Object.freeze([[150, 0.375], [300, 0.5], [500, 0.625], [700, 0.75], [828, 0.875]]),
  outsideMargin: 0.25,
  /** Where KDP prints its barcode when the cover has none: the back's bottom right, beside the spine. */
  barcode: Object.freeze({ width: 2, height: 1.2, inset: 0.25 }),
  trim: Object.freeze({ width: Object.freeze([4, 8.5]), height: Object.freeze([6, 11.69]) }),
  inks: Object.freeze(["black"]),
  finishes: Object.freeze(["matte", "glossy"]),
});

/** The house's interior margins, inside KDP's: a quarter inch more than the least gutter, a half inch outside. */
export const HOUSE_MARGINS = Object.freeze({ gutterAllowance: 0.25, outer: 0.5, top: 0.75, bottom: 0.75, headsep: 0.2, footskip: 0.35 });

const inches = (value) => Math.round(value * 10000) / 10000;

/**
 * The book's print specification, from its manifest's print field.
 * @param {unknown} print
 * @returns {{trim: {width: number, height: number}, paper: "white"|"cream", ink: "black", finish: string, priceCents: number, isbn: string, expandedDistribution: boolean}}
 */
export function printSpecification(print) {
  if (print === null || typeof print !== "object") throw new TypeError("a print edition needs the manifest's print specification");
  const { trim, paper, ink, finish, priceCents, isbn, expandedDistribution = false } = print;
  const [minWidth, maxWidth] = KDP_PAPERBACK.trim.width;
  const [minHeight, maxHeight] = KDP_PAPERBACK.trim.height;
  if (!(trim?.width >= minWidth && trim.width <= maxWidth && trim.height >= minHeight && trim.height <= maxHeight)) throw new RangeError(`print trim must be ${minWidth}-${maxWidth} by ${minHeight}-${maxHeight} in`);
  if (!Object.hasOwn(KDP_PAPERBACK.spinePerPage, paper)) throw new TypeError(`print paper must be ${Object.keys(KDP_PAPERBACK.spinePerPage).join(" or ")}`);
  if (!KDP_PAPERBACK.inks.includes(ink)) throw new TypeError(`print ink must be ${KDP_PAPERBACK.inks.join(" or ")}`);
  if (!KDP_PAPERBACK.finishes.includes(finish)) throw new TypeError(`print finish must be ${KDP_PAPERBACK.finishes.join(" or ")}`);
  if (!Number.isInteger(priceCents) || priceCents <= 0) throw new TypeError("print priceCents must be a positive integer");
  if (typeof isbn !== "string" || !(isbn === "kdp-assigned" || /^97[89]-?\d/u.test(isbn))) throw new TypeError('print isbn is "kdp-assigned" or an ISBN-13');
  return Object.freeze({ trim: Object.freeze({ width: trim.width, height: trim.height }), paper, ink, finish, priceCents, isbn, expandedDistribution: Boolean(expandedDistribution) });
}

/** The ISBN a copyright page prints: none until the printer assigns one. */
export const printedIsbn = (specification) => (specification.isbn === "kdp-assigned" ? undefined : specification.isbn);

/** The least inside margin KDP allows for a page count. */
export function kdpGutter(pages) {
  if (!Number.isInteger(pages) || pages < KDP_PAPERBACK.pages.min || pages > KDP_PAPERBACK.pages.max) throw new RangeError(`a paperback has ${KDP_PAPERBACK.pages.min}-${KDP_PAPERBACK.pages.max} pages, not ${pages}`);
  return KDP_PAPERBACK.gutter.find(([upTo]) => pages <= upTo)[1];
}

/**
 * The interior's page geometry for a page count, as the geometry package's
 * options: the trim as the paper, the house margins, mirrored for a bound book.
 * @returns {{margins: object, geometry: string}}
 */
export function interiorGeometry({ trim }, pages) {
  const margins = { inner: inches(kdpGutter(pages) + HOUSE_MARGINS.gutterAllowance), outer: HOUSE_MARGINS.outer, top: HOUSE_MARGINS.top, bottom: HOUSE_MARGINS.bottom };
  const geometry = [
    `paperwidth=${trim.width}in`, `paperheight=${trim.height}in`,
    `inner=${margins.inner}in`, `outer=${margins.outer}in`, `top=${margins.top}in`, `bottom=${margins.bottom}in`,
    `headsep=${HOUSE_MARGINS.headsep}in`, `footskip=${HOUSE_MARGINS.footskip}in`,
  ].join(",");
  return Object.freeze({ margins: Object.freeze(margins), geometry });
}

/**
 * The full-wrap cover's layout, in inches from its top left corner: back,
 * spine and front side by side, with bleed on every outer edge.
 */
export function coverWrap({ trim, paper }, pages) {
  kdpGutter(pages);
  const { bleed } = KDP_PAPERBACK;
  const spine = inches(pages * KDP_PAPERBACK.spinePerPage[paper]);
  const width = inches(bleed + trim.width + spine + trim.width + bleed);
  const height = inches(trim.height + 2 * bleed);
  const back = { x: bleed, y: bleed, width: trim.width, height: trim.height };
  const spineBox = { x: inches(bleed + trim.width), width: spine };
  const front = { x: inches(bleed + trim.width + spine), y: bleed, width: trim.width, height: trim.height };
  const { width: barcodeWidth, height: barcodeHeight, inset } = KDP_PAPERBACK.barcode;
  const barcode = { x: inches(back.x + back.width - inset - barcodeWidth), y: inches(back.y + back.height - inset - barcodeHeight), width: barcodeWidth, height: barcodeHeight };
  return Object.freeze({ width, height, bleed, spine, pages, back, spineBox, front, barcode, spineText: pages >= KDP_PAPERBACK.spineText.minPages });
}

const near = (a, b) => Math.abs(a - b) <= 0.5; // points; pdfinfo rounds to three decimals

/**
 * Check the files against the printer's rules. Each check names what it saw.
 * @param {{
 *   specification: ReturnType<typeof printSpecification>,
 *   interior: {pages: number, pageSizes: Array<{width: number, height: number}>, fonts: Array<{name: string, embedded: boolean}>},
 *   cover: {pageSizes: Array<{width: number, height: number}>, fonts: Array<{name: string, embedded: boolean}>, barcodeClear: boolean},
 * }} observed page sizes in points
 * @returns {{passed: boolean, checks: Array<{id: string, passed: boolean, detail: string}>}}
 */
export function preflightPrintEdition({ specification, interior, cover }) {
  const { trim } = specification;
  const wrap = coverWrap(specification, interior.pages);
  const checks = [];
  const check = (id, passed, detail) => checks.push(Object.freeze({ id, passed: Boolean(passed), detail }));
  check("interior-page-count", interior.pages >= KDP_PAPERBACK.pages.min && interior.pages <= KDP_PAPERBACK.pages.max, `${interior.pages} pages; ${KDP_PAPERBACK.pages.min}-${KDP_PAPERBACK.pages.max} allowed`);
  const trimPoints = { width: trim.width * PT_PER_INCH, height: trim.height * PT_PER_INCH };
  const offTrim = interior.pageSizes.filter((size) => !near(size.width, trimPoints.width) || !near(size.height, trimPoints.height)).length;
  check("interior-trim", interior.pageSizes.length === interior.pages && offTrim === 0, `${interior.pageSizes.length - offTrim} of ${interior.pages} pages at ${trim.width} x ${trim.height} in (${trimPoints.width} x ${trimPoints.height} pt)`);
  const loose = (fonts) => fonts.filter((font) => !font.embedded).map((font) => font.name);
  check("interior-fonts-embedded", interior.fonts.length > 0 && loose(interior.fonts).length === 0, loose(interior.fonts).length ? `not embedded: ${loose(interior.fonts).join(", ")}` : `${interior.fonts.length} fonts, all embedded`);
  const wrapPoints = { width: wrap.width * PT_PER_INCH, height: wrap.height * PT_PER_INCH };
  check("cover-one-page", cover.pageSizes.length === 1, `${cover.pageSizes.length} pages`);
  check("cover-wrap-size", cover.pageSizes.length === 1 && near(cover.pageSizes[0].width, wrapPoints.width) && near(cover.pageSizes[0].height, wrapPoints.height), `${wrap.width} x ${wrap.height} in expected (spine ${wrap.spine} in for ${interior.pages} ${specification.paper} pages); saw ${cover.pageSizes.map((size) => `${inches(size.width / PT_PER_INCH)} x ${inches(size.height / PT_PER_INCH)} in`).join(", ")}`);
  check("cover-fonts-embedded", cover.fonts.length > 0 && loose(cover.fonts).length === 0, loose(cover.fonts).length ? `not embedded: ${loose(cover.fonts).join(", ")}` : `${cover.fonts.length} fonts, all embedded`);
  check("cover-barcode-clear", cover.barcodeClear, `the ${wrap.barcode.width} x ${wrap.barcode.height} in box KDP prints its barcode in is ${cover.barcodeClear ? "the plain ground" : "not clear"}`);
  return Object.freeze({ passed: checks.every((entry) => entry.passed), checks: Object.freeze(checks) });
}

/**
 * Accept a print edition: its fabrication passed preflight, printed an accepted
 * edition, and a layout proof of the printed pages leaves nothing open.
 * @param {object} fabrication a PrintEditionFabrication
 * @param {{type: "PrintEditionProof", proofer: string, method: string, findings: {errors: number, corrections: number, notes: number}, items: Array<{kind: string, resolution?: string}>}} proof
 * @returns {object} a PrintEditionAcceptance, or a refusal naming why
 */
export function acceptPrintEdition(fabrication, proof, { now = new Date().toISOString() } = {}) {
  const refuse = (code, message) => Object.freeze({ type: "PrintEditionAcceptanceRefusal", version: 1, status: "refused", code, message });
  if (fabrication?.type !== "PrintEditionFabrication" || fabrication.version !== 1) return refuse("NOT_A_FABRICATION", "not a PrintEditionFabrication");
  if (!fabrication.preflight?.passed) return refuse("PREFLIGHT_FAILED", `preflight failed: ${fabrication.preflight?.checks?.filter((entry) => !entry.passed).map((entry) => entry.id).join(", ")}`);
  if (fabrication.text?.status !== "accepted") return refuse("TEXT_NOT_ACCEPTED", "the print edition does not print an accepted edition");
  if (proof?.type !== "PrintEditionProof" || typeof proof.proofer !== "string" || typeof proof.method !== "string") return refuse("NO_PROOF", "a print edition is accepted on a layout proof of its printed pages");
  if (proof.interiorSha256 !== fabrication.interior.sha256 || proof.coverSha256 !== fabrication.cover.sha256) return refuse("PROOF_OF_OTHER_FILES", "the layout proof read other files than these");
  const open = (proof.items ?? []).filter((item) => ["error", "correction"].includes(item.kind) && !item.resolution);
  if (open.length) return refuse("PROOF_OPEN", `${open.length} layout findings are neither fixed nor answered`);
  return Object.freeze({
    type: "PrintEditionAcceptance",
    version: 1,
    status: "accepted",
    book: fabrication.book,
    profile: fabrication.profile,
    editionInputDigest: fabrication.text.editionInputDigest,
    textAcceptance: fabrication.text.acceptance,
    specification: fabrication.specification,
    pages: fabrication.pages,
    interior: fabrication.interior,
    cover: fabrication.cover,
    preflight: fabrication.preflight,
    proof: Object.freeze({ proofer: proof.proofer, provedAt: proof.provedAt, method: proof.method, findings: proof.findings }),
    acceptedAt: now,
  });
}
