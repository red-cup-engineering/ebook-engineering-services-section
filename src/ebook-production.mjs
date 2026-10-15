/**
 * @module ebook-production
 * Production algebra: manifest validation, chapter listing, hashing, and
 * build-record assembly. Pure or read-only I/O (hashing reads files); the
 * pandoc subprocess and output-writing effects live in
 * scripts/produce-ebook.mjs, which calls buildRecord here.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readMarkdownFrontmatter } from "@red-cup-engineering/read-markdown-frontmatter-service";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { canonicalJson } from "@red-cup-engineering/json-services-section/canonical-json";
import { cssFontFamilyList, designTokenColor, designTokenFontStack, designTokenValue, hasDesignToken } from "@red-cup-engineering/web-theming-service/design-tokens";

const REQUIRED_MANIFEST_FIELDS = ["slug", "title", "author", "bookDir", "distDir"];

/**
 * House parent marks a style.brand may cite (Three Marks colophon rule,
 * 2026-08-19 note-on-three-marks-branding.md, generalized to books
 * 2026-09-04): "A <brand> book · <division> · a division of <parent>"
 * omits "a division of <parent>" only when brand IS the 561 Group's own
 * household (2026-09-04 note-on-naming-the-economic-business-and-finance-
 * divisions.md: "The 561 Group's own custody carries no 'a division of' suffix").
 */
const GROUP_OWN_BRAND_NAMES = new Set(["561 group", "the 561 group"]);

const DEFAULT_STYLE = Object.freeze({
  brand: "561 Group",
  division: null,
  colophon: null,
  fontFamily: "DejaVu Serif",
  accent: "6B2737",
});

/**
 * @param {string} brand
 * @returns {boolean} true when brand names the 561 Group's own household
 *   (no "a division of <parent>" clause applies to its own colophon line)
 */
function isGroupOwnBrand(brand) {
  return GROUP_OWN_BRAND_NAMES.has(brand.trim().toLowerCase());
}

/**
 * Compute the default Three Marks colophon line for a brand/division pair.
 * @param {string} brand
 * @param {(string|null)} division
 * @param {string} parent - defaults to "the 561 Group" (the house parents list) when unstated
 * @returns {string} "A <brand> book", "A <brand> book · <division>", or
 *   "A <brand> book · <division> · a division of <parent>"
 */
function defaultColophon(brand, division, parent = "the 561 Group") {
  const divisionClause = division ? ` · ${division}` : "";
  if (isGroupOwnBrand(brand)) {
    // The Group's own names carry their article ("the 561 Group"), so the
    // opening is possessive, never "A the ...".
    const possessive = /^the\s/i.test(brand) ? `${brand[0].toUpperCase()}${brand.slice(1)}'s book` : `A ${brand} book`;
    return `${possessive}${divisionClause}`;
  }
  return `A ${brand} book${divisionClause} · a division of ${parent}`;
}

/**
 * Normalize a manifest's optional `style` field, applying house defaults
 * (DEFAULT_STYLE) and computing the Three Marks colophon when the caller
 * does not supply one. The same computed line is used both as the title
 * page's imprint and as the colophon page's quiet line -- two visual
 * positions, one sentence.
 * @param {{
 *   brand?: string, division?: (string|null), colophon?: (string|null),
 *   fontFamily?: string, accent?: string, parent?: string,
 * }} [style]
 * @returns {{
 *   brand: string, division: (string|null), colophon: string,
 *   imprint: string, fontFamily: string, accent: string,
 * }} the resolved style, ready to pass as pandoc metadata/variables
 */
export function resolveStyle(style = {}) {
  const brand = style.brand ?? DEFAULT_STYLE.brand;
  const division = style.division ?? DEFAULT_STYLE.division;
  const colophon = style.colophon ?? defaultColophon(brand, division, style.parent);
  return {
    brand,
    division,
    colophon,
    imprint: colophon,
    fontFamily: style.fontFamily ?? DEFAULT_STYLE.fontFamily,
    accent: style.accent ?? DEFAULT_STYLE.accent,
  };
}

/**
 * Read the book roles out of a Design Tokens Community Group (Format Module
 * 2025.10) document, resolving `{a.b.c}` aliases: the body, display and
 * metadata font stacks from the `type.body-1`, `type.display-1` and
 * `type.metadata` composite tokens, ink from `color.ink`, and the accent from
 * `color.accent`, or, in the Group's tokens, `color.witness`. These are the roles the 561 Group Design Bible's type
 * pairing assigns (body in the slab, heads in the sans, folios and code in the
 * mono), and witness blue is its evidence color, which is what a book's links
 * and citations are.
 * @param {object} tokens a parsed DTCG document (e.g. 561-group.tokens.json)
 *
 * Every book has its own theme, so the rest of a book's look is read from the tokens too.
 * A cover may set its own ground and type (`color.cover-ground`, `color.cover-ink`) apart
 * from the page's paper, so a novel can have a dark cover over light pages. And the house
 * extension `$extensions["org.561.group"].book` states the book's theme (see BOOK_THEME):
 * paragraphs (continuous prose, a novel's, is set indented with no space between, the first
 * after a heading or scene break flush: Bringhurst, The Elements of Typographic Style,
 * 2.3.1-2.3.2), the scene-break mark, the chapter opener's label, alignment and weight, the
 * title page's ground, whether the PDF prints contents, the running heads' face, and the
 * cover's alignment. A document without it gets the Group's defaults, which are the look
 * every book had before themes.
 * @returns {{stacks: {body: string[], display: string[], mono: string[], byline: string[]}, ink: string, accent: string, bodyLineHeight: (number|null), cover: ({ground: string, ink: string}|null), book: object}}
 * @throws {Error} naming the first missing or malformed token
 */
/**
 * A book theme's settings, each with its allowed values; the first is the default. A
 * scene break is "rule" (pandoc's centered rule), "space" (a blank line), or any short
 * mark to center between scenes, such as "⁂" or "* * *".
 */
export const BOOK_THEME = Object.freeze({
  paragraphs: ["spaced", "indented"],
  chapterLabel: ["chapter", "number", "none"],
  chapterAlign: ["left", "center"],
  chapterWeight: ["bold", "display"],
  titleGround: ["accent", "cover"],
  contents: [true, false],
  runningHeads: ["italic", "small-caps"],
  rectoHead: ["section", "chapter"],
  colophon: ["build-record", "plain"],
  coverAlign: ["left", "center"],
  chapterArt: ["none", "chapter"],
  dropCaps: [false, true],
});

function bookThemeOf(tokens) {
  const declared = tokens?.$extensions?.["org.561.group"]?.book ?? {};
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) throw new Error("$extensions[\"org.561.group\"].book must be an object");
  const theme = {};
  for (const [key, allowed] of Object.entries(BOOK_THEME)) {
    if (key === "chapterArt") continue;
    const value = declared[key] ?? allowed[0];
    if (!allowed.includes(value)) throw new Error(`book theme ${key} must be one of ${allowed.join(", ")}, not ${JSON.stringify(value)}`);
    theme[key] = value;
  }
  const sceneBreak = declared.sceneBreak ?? "rule";
  if (typeof sceneBreak !== "string" || sceneBreak.length === 0 || sceneBreak.length > 240) throw new Error("book theme sceneBreak must be \"rule\", \"space\", a short mark, or a declared ornament asset path");
  const chapterArt = declared.chapterArt ?? BOOK_THEME.chapterArt[0];
  if (typeof chapterArt !== "string" || chapterArt.length === 0 || chapterArt.length > 240) throw new Error("book theme chapterArt must be \"none\", \"chapter\", or a declared ornament asset path");
  const unknown = Object.keys(declared).filter((key) => key !== "sceneBreak" && !(key in BOOK_THEME));
  if (unknown.length) throw new Error(`book theme has unknown settings: ${unknown.join(", ")}`);
  return Object.freeze({ ...theme, sceneBreak, chapterArt });
}

const ASSET_ROLES = new Set(["illustration", "chapter-art", "ornament"]);
const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".tikz"]);

/** Validate and freeze the edition assets already resolved by a manifest reader. */
export function normalizeAssets(assets = []) {
  if (!Array.isArray(assets)) throw new Error('manifest field "assets" must be an array');
  const seen = new Set();
  return Object.freeze(assets.map((asset, index) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new Error(`manifest asset ${index} must be an object`);
    if (typeof asset.path !== "string" || asset.path.trim() === "") throw new Error(`manifest asset ${index} requires a path`);
    if (typeof asset.alt !== "string" || asset.alt.trim() === "") throw new Error(`manifest asset ${asset.path} requires non-empty alt text`);
    if (!ASSET_ROLES.has(asset.role)) throw new Error(`manifest asset ${asset.path} role must be illustration, chapter-art, or ornament`);
    const extension = asset.path.slice(asset.path.lastIndexOf(".")).toLowerCase();
    if (!ASSET_EXTENSIONS.has(extension)) throw new Error(`manifest asset ${asset.path} must be PNG, JPEG, or TikZ`);
    if (seen.has(asset.path)) throw new Error(`manifest asset path is declared more than once: ${asset.path}`);
    seen.add(asset.path);
    return Object.freeze({ path: asset.path, alt: asset.alt.trim(), role: asset.role, ...(asset.provenance === undefined ? {} : { provenance: asset.provenance }) });
  }));
}

function displayWeightOf(tokens) {
  const display = designTokenValue(tokens, "type.display-1");
  const weight = typeof display?.fontWeight === "string" && /^\{.+\}$/u.test(display.fontWeight) ? designTokenValue(tokens, display.fontWeight.slice(1, -1)) : display?.fontWeight;
  return typeof weight === "number" ? weight : null;
}

export function designTokenStyle(tokens) {
  const body = designTokenValue(tokens, "type.body-1");
  return Object.freeze({
    stacks: Object.freeze({
      body: designTokenFontStack(tokens, "body-1"),
      display: designTokenFontStack(tokens, "display-1"),
      mono: designTokenFontStack(tokens, "metadata"),
      // An illustrated cover's byline: `type.cover-byline` when the tokens set one, else the metadata family.
      byline: designTokenFontStack(tokens, hasDesignToken(tokens, "type.cover-byline") ? "cover-byline" : "metadata"),
    }),
    ink: designTokenColor(tokens, "color.ink").slice(1),
    accent: designTokenColor(tokens, hasDesignToken(tokens, "color.accent") ? "color.accent" : "color.witness").slice(1),
    // The ground a cover sets its title on: `color.paper`, or the Group's `color.bone`.
    paper: hasDesignToken(tokens, "color.paper") ? designTokenColor(tokens, "color.paper").slice(1) : hasDesignToken(tokens, "color.bone") ? designTokenColor(tokens, "color.bone").slice(1) : null,
    // Display type is set bold only when the tokens ask for a bold weight.
    displayWeight: displayWeightOf(tokens),
    bylineWeight: hasDesignToken(tokens, "type.cover-byline") && typeof designTokenValue(tokens, "type.cover-byline")?.fontWeight === "number" ? designTokenValue(tokens, "type.cover-byline").fontWeight : null,
    bodyLineHeight: typeof body?.lineHeight === "number" ? body.lineHeight : null,
    book: bookThemeOf(tokens),
    cover: hasDesignToken(tokens, "color.cover-ground")
      ? Object.freeze({ ground: designTokenColor(tokens, "color.cover-ground").slice(1), ink: designTokenColor(tokens, hasDesignToken(tokens, "color.cover-ink") ? "color.cover-ink" : "color.ink").slice(1) })
      : null,
  });
}

/**
 * The EPUB stylesheet for a book styled from design tokens: the section's base
 * stylesheet followed by rules derived from the tokens, which win by coming
 * later in the cascade. Beside the fonts and colors, the derived block applies
 * the Design Bible's type-pairing rules that hold for every artifact: no
 * first-line indent, paragraphs separated by space, and lining tabular figures.
 * @param {string} baseCss the base stylesheet text (templates/book.css)
 * @param {ReturnType<typeof designTokenStyle>} tokenStyle
 * @returns {string} the derived stylesheet text
 */
export function bookStylesheet(baseCss, tokenStyle) {
  const { stacks, ink, accent, bodyLineHeight } = tokenStyle;
  const book = tokenStyle.book ?? bookThemeOf({});
  const css = `${baseCss.trimEnd()}

/* Derived from design tokens: fonts, ink and accent, and the Design Bible's
   type-pairing rules (no first-line indent, space between paragraphs, lining
   tabular figures). */
body {
  font-family: ${cssFontFamilyList(stacks.body)};
  color: #${ink};${bodyLineHeight === null ? "" : `\n  line-height: ${bodyLineHeight};`}
  font-variant-numeric: lining-nums tabular-nums;
  text-align: left;
}
h1, h2, h3, h4 { font-family: ${cssFontFamilyList(stacks.display)}; color: #${ink}; }
h1 { border-bottom-color: #${ink}; }
h1::first-letter { color: inherit; font-size: 1em; }
p, h1 + p, h2 + p, h3 + p { text-indent: 0; margin: 0 0 0.875em 0; }
a { color: #${accent}; }
blockquote { border-left-color: #${accent}; color: inherit; }
code, pre, .colophon { font-family: ${cssFontFamilyList(stacks.mono)}; }
hr { border-top-color: #${ink}; }
`;
  const themed = [];
  if (book.paragraphs === "indented") {
    themed.push("/* Continuous prose: indented paragraphs with no space between, flush after a heading or a scene break. */",
      "p { text-indent: 1.2em; margin: 0; }", "h1 + p, h2 + p, h3 + p, hr + p { text-indent: 0; }");
  }
  if (book.sceneBreak === "space") themed.push("hr { border: 0; height: 1.4em; margin: 0; }");
  else if (book.sceneBreak !== "rule") {
    const mark = book.sceneBreak.replace(/["\\]/gu, (character) => `\\${character}`);
    themed.push("hr { border: 0; margin: 1.4em 0; text-align: center; }", `hr::after { content: "${mark}"; }`);
  }
  if (book.chapterAlign === "center") themed.push("h1 { text-align: center; }");
  if (book.chapterWeight === "display") themed.push(`h1 { font-weight: ${tokenStyle.displayWeight ?? 400}; }`);
  if (book.dropCaps) themed.push(".drop-cap { float: left; font-family: inherit; font-size: 3.2em; line-height: 0.8; padding: 0.08em 0.08em 0 0; }");
  if (book.chapterArt !== "none") themed.push(".chapter-art { display: block; max-height: 35vh; max-width: 100%; margin: 0.8em auto 1.4em; object-fit: contain; }");
  if (/\.(?:png|jpe?g|tikz)$/iu.test(book.sceneBreak)) themed.push(".scene-break-ornament { display: block; max-height: 3em; max-width: 35%; margin: 1.4em auto; object-fit: contain; }");
  if (themed.length === 0) return css;
  return `${css}
/* The book's theme (design tokens, $extensions["org.561.group"].book). */
${themed.join("\n")}
`;
}

/**
 * Validate and normalize a manifest object.
 * @param {{
 *   slug: string,
 *   title: string,
 *   subtitle?: string,
 *   author: string,
 *   publisher?: string,
 *   bookDir: string,
 *   distDir: string,
 *   template?: string,
 *   tokens?: string,
 *   pandocBin?: string,
 * }} manifest
 * @returns {{
 *   slug: string,
 *   title: string,
 *   subtitle: (string|undefined),
 *   author: string,
 *   publisher: (string|undefined),
 *   bookDir: string,
 *   distDir: string,
 *   template: (string|undefined),
 *   tokens: (string|undefined),
 *   pandocBin: string,
 * }} the normalized manifest, with pandocBin defaulted to "pandoc"
 * @throws {Error} naming the first missing or invalid field
 */
export function parseManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("parseManifest requires a manifest object");
  }
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const value = manifest[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`manifest is missing required field "${field}"`);
    }
  }
  if (manifest.date !== undefined && !(typeof manifest.date === "string" && EDITION_DATE.test(manifest.date) && Number.isFinite(Date.parse(`${manifest.date}T00:00:00Z`)))) {
    throw new Error('manifest field "date" must be the edition date as YYYY-MM-DD');
  }
  return {
    slug: manifest.slug,
    title: manifest.title,
    subtitle: manifest.subtitle,
    author: manifest.author,
    publisher: manifest.publisher,
    bookDir: manifest.bookDir,
    distDir: manifest.distDir,
    template: manifest.template,
    tokens: manifest.tokens,
    cover: manifest.cover,
    coverArt: manifest.coverArt,
    assets: normalizeAssets(manifest.assets),
    date: manifest.date,
    pandocBin: manifest.pandocBin ?? "pandoc",
  };
}

/**
 * List a book's chapter Markdown files, ordered by filename.
 * @param {string} bookDir - absolute path to a directory of `*.md` chapters
 * @returns {string[]} sorted absolute paths to the chapter Markdown files
 * @throws {Error} when bookDir contains no `.md` files
 */
export function listChapters(bookDir) {
  const chapters = readdirSync(bookDir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(bookDir, name));
  if (chapters.length === 0) {
    throw new Error(`no chapter Markdown files found under ${bookDir}`);
  }
  return chapters;
}

/**
 * @param {*} value
 * @returns {string} a canonical JSON serialization with object keys sorted,
 *   so two structurally-equal values with differently-ordered keys compare equal
 */
/**
 * Merge every chapter's frontmatter `references` map (CSL-JSON items keyed
 * by citation id, the shape parseManifest's callers use in chapter YAML
 * frontmatter) into one ordered CSL-JSON reference list. Ids are kept in
 * first-seen order across the sorted chapter set, so the result is
 * deterministic for an unchanged chapter set.
 * @param {string[]} chapterPaths - sorted absolute paths to chapter files (see listChapters)
 * @returns {{ids: string[], items: object[]}} the merged reference ids, in
 *   first-seen order, and their CSL-JSON items (each item's `id` field set
 *   from its map key)
 * @throws {Error} naming the id and both chapter files when the same
 *   citation id maps to two different CSL-JSON items across chapters
 */
export function collectReferences(chapterPaths) {
  const items = new Map();
  const sourceFiles = new Map();
  const ids = [];
  for (const chapterPath of chapterPaths) {
    const text = readFileSync(chapterPath, "utf8");
    const { frontmatter } = readMarkdownFrontmatter(text, { absentFrontmatter: "empty" });
    const references = frontmatter.references;
    if (references === undefined || references === null || typeof references !== "object" || Array.isArray(references)) {
      continue;
    }
    for (const [id, item] of Object.entries(references)) {
      const existing = items.get(id);
      if (existing === undefined) {
        items.set(id, item);
        sourceFiles.set(id, chapterPath);
        ids.push(id);
        continue;
      }
      if (canonicalJson(existing) !== canonicalJson(item)) {
        throw new Error(
          `reference "${id}" differs between ${sourceFiles.get(id)} and ${chapterPath}`,
        );
      }
    }
  }
  return { ids, items: ids.map((id) => ({ ...items.get(id), id })) };
}

/**
 * @param {string} filePath
 * @returns {string} the RFC 6920 sha-256 `ni:` URI for the file's bytes
 */
export function sha256File(filePath) {
  return sha256Buffer(readFileSync(filePath));
}

/**
 * @param {Buffer} buffer
 * @returns {string} the RFC 6920 sha-256 `ni:` URI for the buffer's bytes
 */
export function sha256Buffer(buffer) {
  return makeNiUri(buffer);
}

/**
 * Hash the ordered chapter set: each chapter file is hashed individually,
 * then the ordered digest URIs are joined with "\n" and hashed again. This
 * makes the chapter-set hash sensitive to chapter content, chapter order,
 * and chapter count, without requiring the record to embed every
 * per-chapter digest.
 * @param {string[]} chapterPaths - sorted absolute paths to chapter files
 * @returns {string} the RFC 6920 sha-256 `ni:` URI for the ordered chapter set
 */
export function sha256ChapterSet(chapterPaths) {
  const perChapter = chapterPaths.map((path) => sha256File(path));
  return makeNiUri(Buffer.from(perChapter.join("\n"), "utf8"));
}

/**
 * Hash the chapter set together with the template (and, since the house
 * EPUB stylesheet pass, the CSS) that will render it. This is computable
 * before pandoc ever runs (all operands are source bytes), so it is the
 * value stamped into the PDF's own colophon via the `build-record-hash`
 * template variable -- letting a reader compare the hash printed inside
 * the PDF against the same field in the delivered build record, proving
 * the record and the artifact share one source. A book built before the
 * stylesheet existed passes cssHash as null; a book built after always
 * passes the real CSS file's digest, so sourceHash is sensitive to a
 * stylesheet edit exactly the way it is already sensitive to a template edit.
 * @param {string[]} chapterPaths - sorted absolute paths to chapter files
 * @param {string} templateHash - ni: URI digest of the LaTeX template file
 * @param {(string|null)} [cssHash] - ni: URI digest of the EPUB stylesheet file, or null when none is used
 * @returns {string} the RFC 6920 sha-256 `ni:` URI for chapterSet + template + css
 */
export function sha256SourceHash(chapterPaths, templateHash, cssHash = null, assetHashes = []) {
  const assets = assetHashes.length === 0 ? "" : `:${assetHashes.join(":")}`;
  return makeNiUri(Buffer.from(`${sha256ChapterSet(chapterPaths)}:${templateHash}:${cssHash ?? ""}${assets}`, "utf8"));
}

const EDITION_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * The build epoch an edition date names: midnight UTC that day, in seconds.
 * An edition that states its date in its manifest builds with this epoch on
 * any checkout, so every timestamp the toolchain embeds is the same.
 * @param {string} date the edition date, YYYY-MM-DD
 * @returns {number} seconds since the epoch
 */
export function editionEpochSeconds(date) {
  if (typeof date !== "string" || !EDITION_DATE.test(date)) throw new TypeError("edition date must be YYYY-MM-DD");
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}

/**
 * A PDF whose trailer identifier is derived from its own content. xdvipdfmx
 * seeds /ID partly from the output file's path, so the same document built in
 * two directories differs only there; this replaces each /ID string with the
 * same-length prefix of the SHA-256 of the file with its /ID strings zeroed,
 * which moves no byte offset (the approach of qpdf's --deterministic-id).
 *
 * xdvipdfmx writes the /ID as a hex string or, depending on its random bytes, as a literal
 * string, whose length then varies from build to build. A literal /ID in the final
 * cross-reference section (after the offset the last `startxref` names, where no offset
 * points past it) is first rewritten to the hex form `/ID[<32 hex><32 hex>]`, so every build
 * of the same document arrives at the same bytes whichever form xdvipdfmx chose.
 * @param {Buffer} bytes a PDF
 * @returns {Buffer} the same PDF with a content-derived /ID
 */
export function withDeterministicPdfIdentifier(bytes) {
  const text = canonicalLiteralPdfIdentifier(bytes.toString("latin1"));
  const pattern = /\/ID\s*\[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]/gu;
  const found = [...text.matchAll(pattern)];
  if (found.length === 0) return bytes;
  const zeroed = text.replace(pattern, (match, first, second) => match.replace(first, "0".repeat(first.length)).replace(second, "0".repeat(second.length)));
  const digest = createHash("sha256").update(Buffer.from(zeroed, "latin1")).digest("hex").repeat(4);
  // Uppercase only where the original used uppercase letters; a canonical all-zero /ID is lowercase.
  const identifier = (hex) => (/[A-F]/u.test(hex) ? digest.toUpperCase() : digest).slice(0, hex.length);
  return Buffer.from(text.replace(pattern, (match, first, second) => match.replace(first, identifier(first)).replace(second, identifier(second))), "latin1");
}

const PDF_LITERAL_STRING = String.raw`\((?:\\[\s\S]|[^\\()])*\)`;
const LITERAL_PDF_IDENTIFIER = new RegExp(String.raw`/ID\s*\[\s*${PDF_LITERAL_STRING}\s*${PDF_LITERAL_STRING}\s*\]`, "gu");

// Rewrite a literal /ID in the final cross-reference section to the fixed hex form.
function canonicalLiteralPdfIdentifier(text) {
  const startxref = [...text.matchAll(/startxref\s+(\d+)/gu)].at(-1);
  if (!startxref) return text;
  const tail = Number(startxref[1]);
  return text.replace(LITERAL_PDF_IDENTIFIER, (match, offset) => (offset >= tail ? `/ID[<${"0".repeat(32)}><${"0".repeat(32)}>]` : match));
}

/**
 * Latest mtime across a set of source files, in whole seconds since the
 * epoch: the build epoch of an edition whose manifest states no date. A
 * checkout sets every file's mtime to when it was checked out, so an edition
 * built this way reproduces on the machine that built it but not from a
 * fresh checkout; an edition that should reproduce anywhere states its date
 * (editionEpochSeconds).
 * @param {string[]} filePaths - absolute paths to hash inputs (chapters, template)
 * @returns {number} the latest mtime among filePaths, in whole seconds
 */
export function sourceEpochSeconds(filePaths) {
  const latestMs = Math.max(...filePaths.map((path) => statSync(path).mtimeMs));
  return Math.floor(latestMs / 1000);
}

/**
 * Assemble the hash-verified, deterministic build record: proof of exactly
 * which source bytes (chapter set + template) produced exactly which
 * output bytes (EPUB/PDF, and cover when generated).
 * @param {{
 *   manifest: object,
 *   chapters: string[],
 *   epub: {path: string, bytes: number, sha256: string},
 *   pdf: {path: string, bytes: number, sha256: string},
 *   cover?: ({path: string, bytes: number, sha256: string, provenance: object}|null),
 *   references?: ({ids: string[], items: object[]}|null),
 *   pandocVersion: string,
 *   xelatexVersion: string,
 *   templateHash: string,
 *   cssPath?: (string|null),
 *   cssHash?: (string|null),
 *   style?: object,
 *   epoch?: ({seconds: number, source: "edition-date"|"source-mtime"}|null),
 *   generatedAt: string,
 * }} facts
 * @returns {object} the build record, ready for JSON.stringify
 */
export function buildRecord({
  manifest,
  chapters,
  epub,
  pdf,
  cover = null,
  assets = [],
  references = null,
  pandocVersion,
  xelatexVersion,
  templateHash,
  cssPath = null,
  cssHash = null,
  style = null,
  designTokens = null,
  epoch = null,
  generatedAt,
}) {
  const referenceIds = references?.ids ?? [];
  return {
    type: "EbookBuildRecord",
    slug: manifest.slug,
    title: manifest.title,
    subtitle: manifest.subtitle ?? null,
    author: manifest.author,
    generatedAt,
    // The epoch every embedded timestamp was set from, and where it came from:
    // only an edition-date epoch reproduces the same bytes from a fresh checkout.
    ...(epoch === null ? {} : { epoch }),
    pandocVersion,
    xelatexVersion,
    chapterSet: {
      count: chapters.length,
      files: chapters,
      sha256: sha256ChapterSet(chapters),
    },
    template: {
      path: manifest.template ?? null,
      sha256: templateHash,
    },
    stylesheet: {
      path: cssPath,
      sha256: cssHash,
    },
    style,
    ...(designTokens === null ? {} : { designTokens }),
    sourceHash: sha256SourceHash(chapters, templateHash, cssHash, assets.map((asset) => asset.sha256)),
    artifacts: {
      epub,
      pdf,
    },
    cover,
    ...(assets.length === 0 ? {} : { assets }),
    referencesCount: referenceIds.length,
    referenceIds,
  };
}

/**
 * EPUB Accessibility 1.1 discovery metadata for a pandoc-built book, stating
 * only what the house toolchain's output has: text content sufficient on its
 * own, a navigation document and table of contents, heading structure, and a
 * reading order that follows the chapters, with no hazards. It claims no WCAG
 * conformance level; that needs an assessment this toolchain does not run.
 * @param {{summary?: string}} [options]
 * @returns {string} the `<meta>` elements to add to the package document's metadata
 */
export function epubAccessibilityMetadata({ summary = "Text-only book with a table of contents, navigable chapter and section headings, and a reading order that follows the chapters. It has no images essential to understanding it, no media, and no hazards.", mathml = false } = {}) {
  const escape = (value) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  return [
    '<meta property="schema:accessMode">textual</meta>',
    '<meta property="schema:accessModeSufficient">textual</meta>',
    '<meta property="schema:accessibilityFeature">tableOfContents</meta>',
    '<meta property="schema:accessibilityFeature">structuralNavigation</meta>',
    '<meta property="schema:accessibilityFeature">readingOrder</meta>',
    ...(mathml ? ['<meta property="schema:accessibilityFeature">MathML</meta>'] : []),
    '<meta property="schema:accessibilityHazard">none</meta>',
    `<meta property="schema:accessibilitySummary">${escape(summary)}</meta>`,
  ].map((line) => `    ${line}`).join("\n");
}

/**
 * EPUB 3 collection metadata for a book in a series: belongs-to-collection,
 * its collection-type and the book's position. A series within a larger one
 * (series.within) is refined by that larger collection, as EPUB 3 nests them.
 * @param {{name: string, number?: number, within?: object}} series
 * @returns {string}
 */
export function epubCollectionMetadata(series) {
  const escape = (value) => String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  const lines = [];
  for (let collection = series, depth = 1, refines = null; collection; collection = collection.within, depth += 1) {
    const id = `collection-${depth}`;
    lines.push(
      `<meta${refines ? ` refines="#${refines}"` : ""} property="belongs-to-collection" id="${id}">${escape(collection.name)}</meta>`,
      `<meta refines="#${id}" property="collection-type">series</meta>`,
      ...(collection.number ? [`<meta refines="#${id}" property="group-position">${Number(collection.number)}</meta>`] : []),
    );
    refines = id;
  }
  return lines.map((line) => `    ${line}`).join("\n");
}

/**
 * Add accessibility metadata to an EPUB package document once, before its
 * closing `</metadata>`. A package whose items carry MathML declares the
 * MathML feature; a book in a series gains its collection metadata.
 * @param {string} opf the package document text
 * @param {{summary?: string, series?: {name: string, number?: number}}} [options]
 * @returns {string}
 */
export function withEpubAccessibilityMetadata(opf, options) {
  if (opf.includes("schema:accessMode")) return opf;
  if (!opf.includes("</metadata>")) throw new Error("the EPUB package document has no metadata element");
  const collection = options?.series?.name ? `\n${epubCollectionMetadata(options.series)}` : "";
  const mathml = /properties="[^"]*\bmathml\b/u.test(opf);
  return opf.replace("</metadata>", `${epubAccessibilityMetadata({ ...options, mathml })}${collection}\n  </metadata>`);
}

/**
 * The package-relative href of the first spine document whose body is body
 * matter, the place a reading system opens a book at ("start reading"). pandoc
 * files an epigraph as body matter too, so a document that opens on one is passed over.
 * @param {string} opf the package document text
 * @param {(href: string) => string} readDocument the text of a package-relative document
 * @returns {string|null}
 */
export function firstBodymatterHref(opf, readDocument) {
  const hrefs = new Map([...opf.matchAll(/<item\b[^>]*>/gu)].map(([tag]) => [tag.match(/\bid="([^"]+)"/u)?.[1], tag.match(/\bhref="([^"]+)"/u)?.[1]]));
  for (const [, idref] of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gu)) {
    const href = hrefs.get(idref);
    const text = href ? readDocument(href) : "";
    if (/<body\b[^>]*epub:type="[^"]*\bbodymatter\b/u.test(text) && !/<section\b[^>]*epub:type="[^"]*\bepigraph\b/u.test(text)) return href;
  }
  return null;
}

/**
 * Add a bodymatter landmark to an EPUB navigation document once, so Kindle
 * and other reading systems open the book at its first chapter rather than
 * its cover. pandoc's landmarks name only the cover, title page and contents.
 * @param {string} nav the navigation document text
 * @param {string} href the first body-matter document, relative to the navigation document
 * @returns {string}
 */
export function withBodymatterLandmark(nav, href) {
  const landmarks = nav.match(/<nav\b[^>]*epub:type="landmarks"[^>]*>[\s\S]*?<\/nav>/u)?.[0];
  if (!landmarks || /epub:type="bodymatter"/u.test(landmarks)) return nav;
  const item = `  <li>\n      <a href="${href}" epub:type="bodymatter">Start of Content</a>\n    </li>\n  </ol>`;
  return nav.replace(landmarks, landmarks.replace(/<\/ol>(?![\s\S]*<\/ol>)/u, item));
}

const LATEX_SPECIALS = new Map([["\\", "\\textbackslash{}"], ["&", "\\&"], ["%", "\\%"], ["$", "\\$"], ["#", "\\#"], ["_", "\\_"], ["{", "\\{"], ["}", "\\}"], ["~", "\\textasciitilde{}"], ["^", "\\textasciicircum{}"]]);

/** Escape text for LaTeX body copy. */
export function latexText(value) {
  return String(value).replace(/[\\&%$#_{}~^]/gu, (character) => LATEX_SPECIALS.get(character));
}

/**
 * Fill the house cover template (templates/cover.latex) for one book: its
 * title, subtitle and author, set in the families chosen from the design
 * tokens, on the tokens' paper with their ink and accent.
 * @param {string} template the cover template text
 * @param {{title: string, subtitle?: string, author: string, fonts: {display: string, body: string, mono: string}, colors: {paper: string, ink: string, accent: string}, brand?: string, displayBold?: boolean, align?: ("left"|"center"), art?: (string|null)}} book
 * @returns {string} a complete LaTeX document
 */
export function renderCoverLatex(template, { title, subtitle, author, brand = "561 Group", series = null, fonts, colors, displayBold = true, align = "left", art = null }) {
  const sameName = (left, right) => left.trim().toLowerCase().replace(/^the /u, "") === right.trim().toLowerCase().replace(/^the /u, "");
  const groupBrand = sameName(brand, "561 Group");
  const fields = {
    BONE: colors.paper, INK: colors.ink, ACCENT: colors.accent,
    DISPLAY: fonts.display, BODY: fonts.body, MONO: fonts.mono,
    DISPLAYWEIGHT: displayBold ? "\\bfseries" : "",
    ALIGN: align === "center" ? "\\centering" : "\\raggedright",
    // A book's own art: the body of a tikzpicture, drawn in the cover's colors (bone, ink, witness).
    ART: art === null ? "" : `{\\centering\\begin{tikzpicture}\n${art.trim()}\n\\end{tikzpicture}\\par}`,
    TITLE: latexText(title), SUBTITLE: latexText(subtitle ?? ""),
    // The foot lockup names the brand, so an author who is the brand is not named twice.
    AUTHOR: sameName(author, brand) ? "" : latexText(author.toUpperCase()),
    FOOTMARK: groupBrand ? "561" : latexText(brand),
    FOOTLABEL: groupBrand ? "GROUP" : "",
    SERIES: series?.name ? latexText(`${series.name.toUpperCase()}${series.number ? ` · ${series.number}` : ""}`) : "",
  };
  return fillCoverTemplate(template, fields);
}

function fillCoverTemplate(template, fields) {
  return template.replace(/@@([A-Z]+)@@/gu, (match, key) => {
    if (!(key in fields)) throw new Error(`cover template names an unknown field ${match}`);
    return fields[key];
  });
}

/**
 * Fill the house illustrated cover template (templates/cover-illustrated.latex)
 * for one book: its byline, title and subtitle set over its illustration, named
 * as a file beside the .tex (free of LaTeX specials, since graphicx reads it verbatim).
 * @param {string} template the illustrated cover template text
 * @param {{title: string, subtitle?: string, author: string, illustration: string, fonts: {display: string, displayItalic: ({file: string, directory: string}|null), byline: string}, colors: {ground: string, ink: string, accent: string}, displayBold?: boolean, bylineBold?: boolean}} book
 * @returns {string} a complete LaTeX document
 */
export function renderIllustratedCoverLatex(template, { title, subtitle, author, illustration, fonts, colors, displayBold = false, bylineBold = true }) {
  return fillCoverTemplate(template, {
    GROUND: colors.ground, INK: colors.ink, ACCENT: colors.accent,
    DISPLAY: fonts.display, BYLINE: fonts.byline,
    // The display italic by file, since fontspec may otherwise pick a web font xdvipdfmx cannot embed; slanted when the family has none.
    DISPLAYITALIC: fonts.displayItalic ? `{${fonts.displayItalic.file}}[Path=${fonts.displayItalic.directory}/]` : `{${fonts.display}}[FakeSlant=0.2]`,
    DISPLAYWEIGHT: displayBold ? "\\bfseries" : "",
    BYLINEWEIGHT: bylineBold ? "\\bfseries" : "",
    // The illustration's file name in the staging directory; graphicx reads it verbatim.
    ILLUSTRATION: illustration,
    TITLE: latexText(title), SUBTITLE: latexText(subtitle ?? ""),
    AUTHOR: latexText(author.toUpperCase()),
  });
}

/**
 * Fill the house full-wrap paperback cover (templates/cover-wrap.latex): the
 * illustrated front at the trim's scale, the spine, and the back, laid out by
 * src/print-edition.mjs's coverWrap.
 * @param {string} template the wrap template text
 * @param {{
 *   wrap: ReturnType<typeof import("./print-edition.mjs").coverWrap>,
 *   title: string, subtitle?: string, author: string, series?: string, blurb: string, imprint?: string,
 *   illustration: string, artWidth: number, artCenter: number, scale: number,
 *   fonts: {display: string, displayItalic: ({file: string, directory: string}|null), byline: string, reading: string},
 *   colors: {ground: string, ink: string, accent: string}, displayBold?: boolean, bylineBold?: boolean,
 * }} book artWidth and artCenter are the illustration's width and its centre's depth in the front's own
 *   (ebook cover) inches and 256ths of an inch; scale is the front's, trim width over the ebook cover's
 */
export function renderCoverWrapLatex(template, { wrap, title, subtitle, author, series, blurb, imprint, illustration, artWidth, artCenter, scale, fonts, colors, displayBold = false, bylineBold = true }) {
  const margin = 0.5;
  // Spine type as large as the spine allows inside the printer's margins, up to 15 pt.
  const spineSize = wrap.spineText ? Math.min(15, Math.floor((wrap.spine - 2 * 0.0625) * 72 * 0.72)) : 1;
  return fillCoverTemplate(template, {
    WIDTH: String(wrap.width), HEIGHT: String(wrap.height), BLEED: String(wrap.bleed),
    GROUND: colors.ground, INK: colors.ink, ACCENT: colors.accent,
    DISPLAY: fonts.display, BYLINE: fonts.byline, READING: fonts.reading,
    DISPLAYITALIC: fonts.displayItalic ? `{${fonts.displayItalic.file}}[Path=${fonts.displayItalic.directory}/]` : `{${fonts.display}}[FakeSlant=0.2]`,
    DISPLAYWEIGHT: displayBold ? "\\bfseries" : "",
    BYLINEWEIGHT: bylineBold ? "\\bfseries" : "",
    FRONTX: String(wrap.front.x), SCALE: String(scale), ARTWIDTH: String(artWidth), ARTCENTER: String(artCenter), ILLUSTRATION: illustration,
    TITLE: latexText(title), SUBTITLE: latexText(subtitle ?? ""), AUTHOR: latexText(author.toUpperCase()),
    SPINECENTER: String(wrap.spineBox.x + wrap.spine / 2), MIDDLE: String(wrap.height / 2),
    SPINESIZE: String(spineSize), SPINEBYLINESIZE: String(Math.max(1, Math.round(spineSize * 0.62))), SPINEGAP: wrap.spineText ? "0.3" : "0",
    SPINETITLE: wrap.spineText ? latexText(title) : "", SPINEAUTHOR: wrap.spineText ? latexText(author.toUpperCase()) : "",
    BACKX: String(wrap.back.x), BACKMARGIN: String(margin), BACKTOP: "0.75", BACKTEXTWIDTH: String(wrap.back.width - 2 * margin),
    SERIES: latexText((series ?? "").toUpperCase()), BLURB: latexText(blurb), IMPRINT: latexText(imprint ?? ""),
    IMPRINTBASE: String(wrap.back.height - margin),
  });
}

/** The file an edition's cover is written to: a typographic cover is a PNG, an illustrated one a JPEG. */
export function coverFileName({ slug, cover }) {
  return `${slug}-cover.${cover === "illustrated" ? "jpg" : "png"}`;
}

/**
 * What a reader and a retailer are told about an illustrated cover's making, from the
 * manifest's coverArtProvenance: one sentence, so the copyright page, the shop and the
 * retail declarations cannot drift apart.
 * @param {{model: string, modelName?: string, provider?: string, references?: string}} provenance
 */
export function illustratedCoverDisclosure({ model, modelName, provider, references }) {
  if (!model) throw new TypeError("an illustrated cover's provenance names its model");
  return `The cover illustration was generated by an AI image model (${modelName ?? model}${provider ? ` on ${provider}` : ""}) from a prompt written by an AI agent${references ? `, using ${references} as reference` : ""}; its title, byline and subtitle were set by code.`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A book's copyright page, as pandoc Markdown in EPUB 3's copyright-page semantics:
 * the title and series; the notice (US 17 U.S.C. 401(b): the symbol, the year of first
 * publication, the owner, which may be a known trade name) and the book's own
 * reservation, which for a text generated by AI claims no more than the law gives
 * (US Copyright Office, AI report Part 2, 2025); how the text and the cover were made;
 * the interior typefaces; the book's other notices; the imprint; and the edition,
 * dated and identified by its source digest.
 * @param {{
 *   title: string, subtitle?: string, series?: {name: string, number?: number},
 *   rights: {holder: string, year: number, reservation?: string, authorship?: string, notices?: string[], contact?: string},
 *   imprint?: string, coverDisclosure?: string, typefaces?: string[], date?: string, edition?: string,
 *   setting?: string, isbn?: string,
 * }} book setting names what the typefaces set ("The PDF" for an ebook, "This book" in print); isbn is a print edition's
 * @returns {string} the page's Markdown paragraphs; copyrightPageMarkdown makes them an EPUB section
 */
export function copyrightPageText({ title, subtitle, series, rights, imprint, coverDisclosure, typefaces = [], date, edition, setting = "The PDF", isbn }) {
  if (!rights?.holder || !Number.isInteger(rights?.year)) throw new TypeError("a copyright page needs rights.holder and an integer rights.year");
  const faces = [...new Set(typefaces)];
  const published = date && /^\d{4}-\d{2}/u.test(date) ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : null;
  const paragraphs = [
    `*${title}*${subtitle ? `\\\n${subtitle}` : ""}${series?.name ? `\\\n${series.name}${series.number ? `, book ${series.number}` : ""}` : ""}`,
    `Copyright © ${rights.year} ${rights.holder}. ${rights.reservation ?? "All rights reserved."}`,
    [rights.authorship, coverDisclosure, faces.length ? `${setting} is set in ${faces.length > 1 ? `${faces.slice(0, -1).join(", ")} and ${faces.at(-1)}` : faces[0]}.` : null].filter(Boolean).join(" "),
    ...(rights.notices ?? []),
    [imprint ? `${imprint}.` : null, rights.contact].filter(Boolean).join("\\\n"),
    [published ? `First published ${published}.` : null, isbn ? `ISBN ${isbn}` : null, edition ? `Edition \`${edition}\`` : null].filter(Boolean).join("\\\n"),
  ].filter(Boolean);
  return paragraphs.join("\n\n");
}

/**
 * The copyright page as its own unnumbered, unlisted EPUB section (pandoc files it in the
 * front matter by its epub:type); the PDF sets the same text on its colophon page.
 * @param {Parameters<typeof copyrightPageText>[0]} book
 */
export function copyrightPageMarkdown(book) {
  return `# Copyright {.unnumbered .unlisted epub:type=copyright-page}\n\n::: copyright\n${copyrightPageText(book)}\n:::\n`;
}
