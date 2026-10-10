/**
 * @module produce-ebook
 * The effect: validates a manifest, runs pandoc twice (EPUB, PDF via the
 * house LaTeX template), and assembles the build record. Cover art is not
 * generated here (see produceEbook's doc comment).
 */

import { execFile as execFileCallback } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readMarkdownFrontmatter } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-frontmatter";
import {
  parseManifest,
  listChapters,
  collectReferences,
  resolveStyle,
  designTokenStyle,
  latexText,
  renderCoverLatex,
  renderIllustratedCoverLatex,
  coverFileName,
  illustratedCoverDisclosure,
  copyrightPageMarkdown,
  copyrightPageText,
  bookStylesheet,
  withEpubAccessibilityMetadata,
  firstBodymatterHref,
  withBodymatterLandmark,
  sha256File,
  sha256SourceHash,
  sourceEpochSeconds,
  editionEpochSeconds,
  withDeterministicPdfIdentifier,
  buildRecord,
} from "../src/ebook-production.mjs";

const SECTION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE = join(SECTION_ROOT, "templates", "book.latex");
const BOOK_LAYOUT_FILTER = join(SECTION_ROOT, "templates", "book-layout.lua");
const DEFAULT_CSS = join(SECTION_ROOT, "templates", "book.css");
const COVER_TEMPLATE = join(SECTION_ROOT, "templates", "cover.latex");
const ILLUSTRATED_COVER_TEMPLATE = join(SECTION_ROOT, "templates", "cover-illustrated.latex");
const COPYRIGHT_PAGE_CSS = `.titlepage .date { display: none; }
.copyright p { text-indent: 0; text-align: left; margin: 0 0 0.9em 0; font-size: 0.85em; }
.copyright code { font-size: 0.85em; word-break: break-all; }
`;
const execFile = promisify(execFileCallback);
const run = async (file, args, options = {}) => (await execFile(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options })).stdout;

/**
 * @param {string} pandocBin
 * @returns {string} the first line of `pandoc --version`
 */
async function pandocVersionOf(pandocBin) {
  return (await run(pandocBin, ["--version"])).split("\n")[0].trim();
}

async function xelatexVersionOf() {
  return (await run("xelatex", ["--version"])).split("\n")[0].trim();
}

/**
 * Read `fc-list`'s installed-font family names once, so a manifest's
 * style.fontFamily (or the house default) can be checked against fonts
 * this box actually has before xelatex is ever invoked -- never assume a
 * font is present.
 * @returns {Set<string>} lowercased family names fc-list reports, each
 *   comma-separated alias on a line counted as its own entry
 */
async function installedFontFamilies() {
  const output = await run("fc-list", ["-f", "%{family}\n"]);
  const families = new Set();
  for (const line of output.split("\n")) {
    for (const name of line.split(",")) {
      const trimmed = name.trim().toLowerCase();
      if (trimmed) families.add(trimmed);
    }
  }
  return families;
}

/**
 * @param {string} fontFamily - a style.fontFamily value (e.g. "DejaVu Serif")
 * @throws {Error} naming the font, when fc-list reports no installed font by that family name
 */
async function assertFontFamilyInstalled(fontFamily) {
  const families = await installedFontFamilies();
  if (!families.has(fontFamily.trim().toLowerCase())) {
    throw new Error(
      `style.fontFamily "${fontFamily}" is not installed on this box (checked via fc-list); ` +
        `xelatex would silently fall back to a substitute font. Install it or choose an installed family.`,
    );
  }
}

/**
 * Rewrite the EPUB's package document with accessibility metadata, updating
 * that one entry of the archive in place (the uncompressed mimetype entry
 * stays first, as EPUB requires).
 * @param {string} epubPath
 * @param {string} [summary]
 */
/**
 * Render the house cover for one book to PDF with XeLaTeX, then to a
 * 1600 x 2400 PNG (6 x 9 in) with pdftoppm.
 * @returns {{path: string, bytes: number, sha256: string, provenance: object}}
 */
async function renderTypographicCover({ parsed, manifest, style, tokenStyle, tokenFonts, epochSeconds }) {
  const staging = mkdtempSync(join(tmpdir(), "ebook-cover-"));
  try {
    const tex = join(staging, "cover.tex");
    writeFileSync(tex, renderCoverLatex(readFileSync(COVER_TEMPLATE, "utf8"), {
      title: parsed.title, subtitle: parsed.subtitle, author: parsed.author, brand: style.brand, series: manifest.series ?? null,
      fonts: { display: tokenFonts.display.family, body: tokenFonts.body.family, mono: tokenFonts.mono.family },
      colors: tokenStyle.cover ? { paper: tokenStyle.cover.ground, ink: tokenStyle.cover.ink, accent: tokenStyle.accent } : { paper: tokenStyle.paper, ink: tokenStyle.ink, accent: tokenStyle.accent },
      // The same rule the PDF title page follows: bold unless the tokens set a display weight under 600.
      displayBold: !(tokenStyle.displayWeight !== null && tokenStyle.displayWeight < 600),
      align: tokenStyle.book.coverAlign,
      art: manifest.coverArt ? readFileSync(manifest.coverArt, "utf8") : null,
    }), "utf8");
    await run("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", staging, tex], { env: { ...process.env, SOURCE_DATE_EPOCH: String(epochSeconds) } });
    const path = join(parsed.distDir, coverFileName(parsed));
    await run("pdftoppm", ["-png", "-singlefile", "-scale-to-x", "1600", "-scale-to-y", "2400", join(staging, "cover.pdf"), path.replace(/\.png$/u, "")]);
    return { path, bytes: statSync(path).size, sha256: sha256File(path), provenance: { method: "typographic", template: sha256File(COVER_TEMPLATE), tokens: sha256File(parsed.tokens), ...(manifest.coverArt ? { art: sha256File(manifest.coverArt) } : {}) } };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Set the house type over a book's illustration with XeLaTeX, then rasterize
 * it to a 1600 x 2560 JPEG (KDP's ideal ebook cover) with pdftoppm. The
 * illustration is the book's own raster (its provenance travels with the
 * manifest); the type is set here, never by the image model.
 * @returns {{path: string, bytes: number, sha256: string, provenance: object}}
 */
async function renderIllustratedCover({ parsed, manifest, tokenStyle, tokenFonts, epochSeconds }) {
  const staging = mkdtempSync(join(tmpdir(), "ebook-cover-"));
  try {
    const illustration = `illustration${manifest.coverArt.slice(manifest.coverArt.lastIndexOf(".")).toLowerCase()}`;
    copyFileSync(manifest.coverArt, join(staging, illustration));
    const tex = join(staging, "cover.tex");
    writeFileSync(tex, renderIllustratedCoverLatex(readFileSync(ILLUSTRATED_COVER_TEMPLATE, "utf8"), {
      title: parsed.title, subtitle: parsed.subtitle, author: parsed.author, illustration,
      fonts: { display: tokenFonts.display.family, displayItalic: await italicFaceFileOf(tokenFonts.display.family), byline: tokenFonts.byline.family },
      colors: { ground: tokenStyle.cover.ground, ink: tokenStyle.cover.ink, accent: tokenStyle.accent },
      displayBold: !(tokenStyle.displayWeight !== null && tokenStyle.displayWeight < 600),
      bylineBold: tokenStyle.bylineWeight !== null && tokenStyle.bylineWeight >= 600,
    }), "utf8");
    await run("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", staging, tex], { cwd: staging, env: { ...process.env, SOURCE_DATE_EPOCH: String(epochSeconds) } });
    const path = join(parsed.distDir, coverFileName(parsed));
    await run("pdftoppm", ["-jpeg", "-jpegopt", "quality=95", "-singlefile", "-scale-to-x", "1600", "-scale-to-y", "2560", join(staging, "cover.pdf"), path.replace(/\.jpg$/u, "")]);
    return { path, bytes: statSync(path).size, sha256: sha256File(path), provenance: { method: "illustrated", template: sha256File(ILLUSTRATED_COVER_TEMPLATE), tokens: sha256File(parsed.tokens), art: sha256File(manifest.coverArt), ...(manifest.coverArtProvenance ? { artProvenance: manifest.coverArtProvenance } : {}) } };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * The PDF template's variables (and the layout filter's metadata) for a book's theme.
 * Each is emitted only when the theme departs from the Group's default look, so a
 * default-themed book renders exactly as before themes.
 * @param {ReturnType<typeof designTokenStyle>} tokenStyle
 * @returns {string[]} pandoc arguments
 */
export function bookThemeArgs(tokenStyle) {
  const { book, cover } = tokenStyle;
  const args = [];
  if (book.sceneBreak !== "rule") args.push("-M", "scenebreak=true", "-V", `scenebreakmark=${book.sceneBreak === "space" ? "" : latexText(book.sceneBreak)}`);
  if (book.chapterLabel === "none") args.push("-V", "chapternolabel=true");
  if (book.chapterLabel === "number") args.push("-V", "chapternumberlabel=true");
  if (book.chapterAlign === "center") args.push("-V", "chaptercenter=true");
  if (book.chapterWeight === "display") args.push("-V", "chapterdisplayweight=true");
  if (book.titleGround === "cover" && cover) args.push("-V", `titleground=${cover.ground}`, "-V", `titleink=${cover.ink}`);
  if (!book.contents) args.push("-V", "nocontents=true");
  if (book.runningHeads === "small-caps") args.push("-V", "runningheadsmallcaps=true");
  if (book.rectoHead === "chapter") args.push("-V", "chapterrunninghead=true");
  if (book.colophon === "plain") args.push("-V", "plaincolophon=true");
  if (book.dropCaps) args.push("-M", "dropcaps=true", "-V", "dropcaps=true");
  return args;
}

function assetNamed(assets, bookDir, name) {
  const path = resolve(bookDir, name);
  return assets.find((asset) => resolve(asset.path) === path);
}

async function renderTikzAsset(asset, staging, tokenStyle, epochSeconds) {
  const stem = `asset-${Buffer.from(asset.path).toString("hex").slice(-24)}`;
  const tex = join(staging, `${stem}.tex`);
  const pdf = join(staging, `${stem}.pdf`);
  const png = join(staging, `${stem}.png`);
  const colors = tokenStyle ?? { paper: "FFFFFF", ink: "000000", accent: "6B2737" };
  writeFileSync(tex, `\\documentclass[tikz,border=4pt]{standalone}\n\\usepackage{xcolor}\n\\definecolor{bone}{HTML}{${colors.paper ?? "FFFFFF"}}\n\\definecolor{ink}{HTML}{${colors.ink}}\n\\definecolor{witness}{HTML}{${colors.accent}}\n\\begin{document}\n\\begin{tikzpicture}\n${readFileSync(asset.path, "utf8").trim()}\n\\end{tikzpicture}\n\\end{document}\n`, "utf8");
  await run("xelatex", ["-interaction=nonstopmode", "-halt-on-error", "-output-directory", staging, tex], { env: { ...process.env, SOURCE_DATE_EPOCH: String(epochSeconds) } });
  await run("pdftoppm", ["-png", "-singlefile", "-r", "180", pdf, png.replace(/\.png$/u, "")]);
  return { pdf, png };
}

function replaceAssetTargets(text, chapterPath, assets, projectedPaths) {
  const replacement = (target) => {
    const clean = target.replace(/^<|>$/gu, "");
    const asset = assets.find((candidate) => resolve(candidate.path) === resolve(dirname(chapterPath), clean));
    return asset ? projectedPaths.get(asset.path) : null;
  };
  return text
    .replace(/!\[([^\]]*)\]\((<[^>]+>|[^\s)]+)([^)]*)\)/gu, (whole, alt, target, tail) => {
      const path = replacement(target);
      return path ? `![${alt}](${path}${tail})` : whole;
    })
    .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)(.*)$/gmu, (whole, prefix, target, tail) => {
      const path = replacement(target);
      return path ? `${prefix}${path}${tail}` : whole;
    });
}

function replaceBodyRules(text, imageMarkdown) {
  let fences = 0;
  return text.split("\n").map((line) => {
    if (/^---\s*$/u.test(line) && fences < 2 && (fences > 0 || text.startsWith("---\n"))) { fences += 1; return line; }
    return /^\s*---\s*$/u.test(line) ? imageMarkdown : line;
  }).join("\n");
}

function projectedChapters(chapters, assets, tokenStyle, format, staging, projectedPaths) {
  const book = tokenStyle?.book;
  return chapters.map((chapter, index) => {
    const original = readFileSync(chapter, "utf8");
    const frontmatter = readMarkdownFrontmatter(original, { absentFrontmatter: "empty" }).frontmatter;
    let text = replaceAssetTargets(original, chapter, assets, projectedPaths);
    let opener = null;
    if (book?.chapterArt === "chapter") {
      if (typeof frontmatter.art !== "string") throw new Error(`${chapter} requires frontmatter art: because the theme uses per-chapter art`);
      opener = assetNamed(assets, dirname(chapter), frontmatter.art);
      if (!opener || opener.role !== "chapter-art") throw new Error(`${chapter} frontmatter art must name a declared chapter-art asset`);
    } else if (book?.chapterArt && book.chapterArt !== "none") {
      opener = assetNamed(assets, parsedBookDirOf(chapter, chapters), book.chapterArt);
      if (!opener || opener.role !== "ornament") throw new Error(`book theme chapterArt must name a declared ornament asset: ${book.chapterArt}`);
    }
    if (opener) {
      const art = `![${opener.alt}](${projectedPaths.get(opener.path)}){.chapter-art}<!-- -->`;
      text = text.replace(/^(# .+)$/mu, `$1\n\n${art}`);
    }
    if (book?.sceneBreak && !["rule", "space"].includes(book.sceneBreak)) {
      const ornament = assetNamed(assets, parsedBookDirOf(chapter, chapters), book.sceneBreak);
      if (ornament) {
        if (ornament.role !== "ornament") throw new Error(`book theme sceneBreak asset must have ornament role: ${book.sceneBreak}`);
        text = replaceBodyRules(text, `![${ornament.alt}](${projectedPaths.get(ornament.path)}){.scene-break-ornament}<!-- -->`);
      }
    }
    const path = join(staging, `${format}-${String(index + 1).padStart(3, "0")}.md`);
    writeFileSync(path, text, "utf8");
    return path;
  });
}

function parsedBookDirOf(_chapter, chapters) { return dirname(chapters[0]); }

async function finishEpubPackage(epubPath, summary, series, epochSeconds) {
  const opfEntry = "EPUB/content.opf", navEntry = "EPUB/nav.xhtml";
  const opf = await run("unzip", ["-p", epubPath, opfEntry]);
  const nav = await run("unzip", ["-p", epubPath, navEntry]);
  const documents = new Map();
  for (const [, href] of opf.matchAll(/<item\b[^>]*\bhref="([^"]+\.xhtml)"/gu)) documents.set(href, await run("unzip", ["-p", epubPath, `EPUB/${href}`]));
  // The package and the navigation document both live in EPUB/, so a package href is also a nav href.
  const bodymatter = firstBodymatterHref(opf, (href) => documents.get(href) ?? "");
  const entries = [[opfEntry, withEpubAccessibilityMetadata(opf, { ...(summary === undefined ? {} : { summary }), ...(series ? { series } : {}) })], [navEntry, bodymatter ? withBodymatterLandmark(nav, bodymatter) : nav]];
  const staging = mkdtempSync(join(tmpdir(), "ebook-opf-"));
  try {
    mkdirSync(join(staging, "EPUB"));
    for (const [entry, text] of entries) {
      const staged = join(staging, entry);
      writeFileSync(staged, text, "utf8");
      // A replaced entry carries the build epoch, a fixed mode, and a UTC
      // time (zip writes DOS times in local time), like the entries pandoc wrote.
      chmodSync(staged, 0o644);
      utimesSync(staged, epochSeconds, epochSeconds);
    }
    await run("zip", ["-X", "-q", resolve(epubPath), ...entries.map(([entry]) => entry)], { cwd: staging, env: { ...process.env, TZ: "UTC" } });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "ui-monospace", "ui-serif", "ui-sans-serif", "system-ui"]);

/**
 * The first family of a CSS-style font stack that this box can set, as a
 * design-token stack would load on the web: a named family when fc-list
 * reports it, or, on reaching a generic keyword (serif, sans-serif,
 * monospace), the family fontconfig itself matches for that keyword.
 * @param {string[]} stack ordered family names ending, usually, in a generic
 * @param {Set<string>} families lowercased installed families (installedFontFamilies)
 * @returns {{family: string, requested: string}} the family to set and the stack entry it answers
 * @throws {Error} naming the stack when no entry resolves
 */
async function installedFamilyOf(stack, families) {
  for (const requested of stack) {
    if (families.has(requested.trim().toLowerCase())) return { family: requested, requested };
    if (GENERIC_FAMILIES.has(requested)) {
      const generic = requested.replace(/^ui-/u, "").replace("system-ui", "sans-serif");
      const family = (await run("fc-match", ["-f", "%{family[0]}", generic])).trim();
      if (family) return { family, requested };
    }
  }
  throw new Error(`no family in the stack ${JSON.stringify(stack)} is installed on this box (checked via fc-list and fc-match)`);
}

/**
 * The file of family's italic face that XeTeX can embed (TrueType or OpenType,
 * never a web font), preferring the smallest optical size, which is the face
 * cut for display italics at a distance.
 * @returns {Promise<({file: string, directory: string}|null)>}
 */
export async function italicFaceFileOf(family) {
  const files = (await run("fc-list", [`${family}:style=Italic`, "file"])).split("\n").map((line) => line.replace(/:\s*$/u, "").trim()).filter((file) => /\.(ttf|otf)$/iu.test(file)).sort();
  return files.length ? { file: basename(files[0]), directory: dirname(files[0]) } : null;
}

/** @returns {boolean} whether fc-list reports an italic or oblique face for family */
async function hasItalicFace(family) {
  const output = await run("fc-list", [`${family}:style=Italic`, "family"])
    + await run("fc-list", [`${family}:style=Oblique`, "family"]);
  return output.trim() !== "";
}

function draftedStamp(isoDate) {
  return isoDate.replaceAll("-", " · ");
}

// The ni: URI digest carries "_" (base64url), which LaTeX reads as a
// subscript outside math mode; escape it before passing -V build-record-hash.
function texEscapeDigest(value) {
  return value.replace(/_/gu, "\\_");
}

/**
 * Everything a book's renditions share, read and resolved once: the manifest,
 * its chapters and assets, the design tokens resolved to installed families,
 * the stylesheet, the references, the source hash that names the edition,
 * the build epoch, and pandoc's metadata arguments. The EPUB, the screen PDF
 * and the print interior are all set from one preparation.
 * @param {object} manifest as produceEbook takes it
 * @returns {Promise<object>} the prepared book
 */
export async function prepareBook(manifest) {
  const parsed = parseManifest(manifest);
  const chapters = listChapters(parsed.bookDir);
  const assets = parsed.assets;
  mkdirSync(parsed.distDir, { recursive: true });

  // A manifest that names design tokens takes its fonts, ink and accent from
  // them; the stacks resolve to installed families here, since what a box can
  // set is an effect, and resolveStyle stays pure. An explicit style field
  // still wins over a token-derived one.
  const tokenStyle = parsed.tokens ? designTokenStyle(JSON.parse(readFileSync(parsed.tokens, "utf8"))) : null;
  let tokenFonts = null;
  if (tokenStyle !== null) {
    const families = await installedFontFamilies();
    tokenFonts = {
      body: await installedFamilyOf(tokenStyle.stacks.body, families),
      display: await installedFamilyOf(tokenStyle.stacks.display, families),
      mono: await installedFamilyOf(tokenStyle.stacks.mono, families),
      byline: await installedFamilyOf(tokenStyle.stacks.byline, families),
    };
  }
  const style = resolveStyle(tokenStyle === null ? manifest.style : { fontFamily: tokenFonts.body.family, accent: tokenStyle.accent, ...manifest.style });
  await assertFontFamilyInstalled(style.fontFamily);

  const references = collectReferences(chapters);
  let citeprocArgs = [];
  if (references.items.length > 0) {
    const referencesPath = join(parsed.distDir, `${parsed.slug}-references.json`);
    writeFileSync(referencesPath, JSON.stringify(references.items, null, 2), "utf8");
    // --bibliography takes a bare CSL-JSON array file directly; --metadata-file
    // would require wrapping it under a top-level {references: [...]} object
    // for no benefit, since citeproc reads either form identically.
    citeprocArgs = ["--citeproc", "--bibliography", referencesPath, "-M", "reference-section-title=References"];
  }

  const templatePath = parsed.template ?? DEFAULT_TEMPLATE;
  const templateHash = sha256File(templatePath);
  let cssPath = manifest.css ?? DEFAULT_CSS;
  if (tokenStyle !== null && manifest.css === undefined) {
    cssPath = join(parsed.distDir, `${parsed.slug}.css`);
    writeFileSync(cssPath, bookStylesheet(readFileSync(DEFAULT_CSS, "utf8"), tokenStyle), "utf8");
  }
  // A book with a copyright page dates its edition there, so its title page carries no
  // date; the page itself is set small, flush left, with an identifier that may break anywhere.
  if (manifest.rights !== undefined) {
    const stylesheet = readFileSync(cssPath, "utf8");
    cssPath = join(parsed.distDir, `${parsed.slug}.css`);
    writeFileSync(cssPath, `${stylesheet}\n${COPYRIGHT_PAGE_CSS}`, "utf8");
  }
  const cssHash = sha256File(cssPath);
  const pandocVersion = await pandocVersionOf(parsed.pandocBin);
  const xelatexVersion = await xelatexVersionOf();
  // The layout filter shapes the PDF as the template does, so the build record's
  // source hash, printed in the colophon, covers it too.
  const sourceHash = sha256SourceHash(chapters, `${templateHash}+${sha256File(BOOK_LAYOUT_FILTER)}`, cssHash, assets.map((asset) => sha256File(asset.path)));

  // Deterministic identifier/date instead of pandoc's default random UUID
  // and wall-clock stamp, so an unchanged source set reproduces byte-
  // identical EPUB output (see sourceEpochSeconds's JSDoc).
  // An edition that states its date builds with that date's epoch on any
  // checkout; one that does not falls back to its sources' mtimes, which
  // reproduce only on the machine that built it.
  const epoch = parsed.date
    ? { seconds: editionEpochSeconds(parsed.date), source: "edition-date" }
    : { seconds: sourceEpochSeconds([...chapters, templatePath, ...assets.map((asset) => asset.path), ...(tokenStyle === null ? [cssPath] : [DEFAULT_CSS, parsed.tokens])]), source: "source-mtime" };
  const epochSeconds = epoch.seconds;
  const isoDate = new Date(epochSeconds * 1000).toISOString().slice(0, 10);

  const metadataArgs = [
    "--metadata", `title=${parsed.title}`,
    "--metadata", `author=${parsed.author}`,
    "--metadata", `identifier=${sourceHash}`,
    "--metadata", `date=${isoDate}`,
    // A BCP 47 language tag; without one pandoc takes the shell's locale (LANG=C gives "C").
    "--metadata", `lang=${manifest.language ?? "en-US"}`,
  ];
  if (parsed.subtitle) metadataArgs.push("--metadata", `subtitle=${parsed.subtitle}`);
  // The publisher of record (dc:publisher), stated only by a book that names one.
  if (parsed.publisher) metadataArgs.push("--metadata", `publisher=${parsed.publisher}`);

  const italicFace = tokenFonts === null ? false : await hasItalicFace(tokenFonts.body.family);
  return {
    manifest, parsed, chapters, assets, tokenStyle, tokenFonts, style, references, citeprocArgs,
    templatePath, templateHash, cssPath, cssHash, pandocVersion, xelatexVersion, sourceHash,
    epoch, epochSeconds, isoDate, metadataArgs, italicFace,
  };
}

/**
 * Run fn with the book's chapters as each format sets them (a TikZ asset
 * rendered to PNG for the EPUB and PDF for the PDF), in a staging directory
 * removed afterwards.
 * @template T
 * @param {object} book from prepareBook
 * @param {(projected: {staging: string, epubChapters: string[], pdfChapters: string[]}) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withProjectedChapters(book, fn) {
  const { assets, chapters, tokenStyle, epochSeconds } = book;
  const staging = mkdtempSync(join(tmpdir(), "ebook-assets-"));
  try {
    const epubAssets = new Map();
    const pdfAssets = new Map();
    for (const asset of assets) {
      if (/\.tikz$/iu.test(asset.path)) {
        const rendered = await renderTikzAsset(asset, staging, tokenStyle, epochSeconds);
        epubAssets.set(asset.path, rendered.png);
        pdfAssets.set(asset.path, rendered.pdf);
      } else {
        epubAssets.set(asset.path, asset.path);
        pdfAssets.set(asset.path, asset.path);
      }
    }
    const epubChapters = assets.length === 0 ? chapters : projectedChapters(chapters, assets, tokenStyle, "epub", staging, epubAssets);
    const pdfChapters = assets.length === 0 ? chapters : projectedChapters(chapters, assets, tokenStyle, "pdf", staging, pdfAssets);
    return await fn({ staging, epubChapters, pdfChapters });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * The copyright page a book that states its rights carries, as copyrightPageText
 * takes it; null for a book without rights. A rendition adds what only it says
 * (a print edition's ISBN, what its typefaces set).
 * @param {object} book from prepareBook
 * @param {object} [rendition] fields that override the page's
 */
export function copyrightPageOf({ manifest, parsed, style, tokenFonts, isoDate, sourceHash }, rendition = {}) {
  if (manifest.rights === undefined) return null;
  return {
    title: parsed.title, subtitle: parsed.subtitle, series: manifest.series, rights: manifest.rights, imprint: style.imprint,
    coverDisclosure: manifest.cover === "illustrated" && manifest.coverArtProvenance ? illustratedCoverDisclosure(manifest.coverArtProvenance) : undefined,
    typefaces: tokenFonts === null ? [style.fontFamily] : [tokenFonts.body.family, tokenFonts.display.family],
    date: parsed.date ?? isoDate, edition: sourceHash,
    ...rendition,
  };
}

/** The copyright page as the PDF templates' copyright-page variable, in a metadata file in staging. */
export function copyrightPageArgs(page, staging) {
  if (page === null) return [];
  const metadata = join(staging, "copyright.yaml");
  writeFileSync(metadata, `copyright-page: |\n${copyrightPageText(page).replace(/^/gmu, "  ")}\n`, "utf8");
  return ["--metadata-file", metadata];
}

/**
 * pandoc's arguments for one of the book's PDFs: the chapters, metadata and
 * theme, through a LaTeX template and the layout filter. The screen PDF and
 * the print interior differ only in the template and the page geometry.
 * @param {object} book from prepareBook
 * @param {{chapters: string[], copyrightArgs: string[], template: string, geometry: string, variables?: string[]}} rendition
 * @returns {string[]}
 */
export function bookPdfArgs(book, { chapters, copyrightArgs, template, geometry, variables = [] }) {
  const { metadataArgs, citeprocArgs, tokenStyle, tokenFonts, style, sourceHash, italicFace, isoDate } = book;
  return [
    ...chapters,
    ...metadataArgs,
    ...copyrightArgs,
    "--toc",
    ...citeprocArgs,
    "--pdf-engine=xelatex",
    "--top-level-division=chapter",
    "--template", template,
    "--lua-filter", BOOK_LAYOUT_FILTER,
    "-V", "fontsize=11pt",
    "-V", `geometry=${geometry}`,
    "-V", `linestretch=${tokenStyle?.bodyLineHeight ? (tokenStyle.bodyLineHeight / 1.2).toFixed(2) : "1.15"}`,
    "-V", `build-record-hash=${texEscapeDigest(sourceHash)}`,
    "-V", `fontfamily=${style.fontFamily}`,
    "-V", `accent=${style.accent}`,
    "-V", `imprint=${style.imprint}`,
    "-V", `colophon=${style.colophon}`,
    ...(tokenFonts === null ? [] : [
      "-V", `displayfont=${tokenFonts.display.family}`,
      "-V", `monofont=${tokenFonts.mono.family}`,
      "-V", `mainfontoptions=Numbers={Lining,Monospaced}${italicFace ? "" : ",ItalicFont=*,ItalicFeatures={FakeSlant=0.2},BoldItalicFont={* Bold},BoldItalicFeatures={FakeSlant=0.2}"}`,
      "-V", "mathtextfont=DejaVu Serif",
      ...(tokenStyle.book.paragraphs === "indented" ? [] : ["-V", "parskip=true"]),
      ...bookThemeArgs(tokenStyle),
      "-V", `inkcolor=${tokenStyle.ink}`,
      ...(tokenStyle.paper === null ? [] : ["-V", `papercolor=${tokenStyle.paper}`]),
      ...(tokenStyle.displayWeight !== null && tokenStyle.displayWeight < 600 ? [] : ["-V", "displaybold=true"]),
      "-V", `drafted=${draftedStamp(isoDate)}`,
    ]),
    ...variables,
  ];
}

/**
 * Run pandoc and XeLaTeX to one PDF, dated by the build epoch and with a
 * content-derived trailer identifier, so the same sources give the same bytes.
 * @returns {Promise<{path: string, bytes: number, sha256: string}>}
 */
export async function renderBookPdf(book, args, pdfPath) {
  await run(
    book.parsed.pandocBin,
    [...args, "-o", pdfPath],
    // SOURCE_DATE_EPOCH pins xelatex's embedded CreationDate/ModDate to the build epoch.
    { env: { ...process.env, SOURCE_DATE_EPOCH: String(book.epochSeconds) } },
  );
  // xdvipdfmx seeds the trailer /ID partly from the output path; derive it from the content instead.
  writeFileSync(pdfPath, withDeterministicPdfIdentifier(readFileSync(pdfPath)));
  return { path: pdfPath, bytes: statSync(pdfPath).size, sha256: sha256File(pdfPath) };
}

/**
 * Produce one ebook's EPUB and PDF artifacts, and return the assembled
 * build record. Generating cover art is out of scope here: it calls out to
 * an inference application, which this section (a substrate document
 * producer) does not depend on. A book that wants an illustrated cover
 * brings its illustration as coverArt, with its provenance as
 * coverArtProvenance, and this section sets the type over it.
 * @param {{
 *   slug: string, title: string, subtitle?: string, author: string,
 *   bookDir: string, distDir: string,
 *   template?: string, css?: string, pandocBin?: string,
 *   style?: {brand?: string, division?: (string|null), colophon?: (string|null), fontFamily?: string, accent?: string, parent?: string},
 * }} manifest
 * @returns {Promise<object>} the build record from buildRecord()
 * @throws {Error} on an invalid manifest, missing chapters, an uninstalled style.fontFamily, or a failed pandoc run
 */
export async function produceEbook(manifest) {
  const book = await prepareBook(manifest);
  const { parsed, chapters, assets, tokenStyle, tokenFonts, style, references, citeprocArgs, cssPath, epochSeconds, metadataArgs } = book;

  // A typographic cover, set from the design tokens by XeLaTeX and rasterized
  // for the EPUB by pdftoppm: no inference, no imagery, reproducible from its sources.
  // An illustrated cover sets the same tokens' type over the book's own illustration.
  let cover = null;
  if (manifest.cover === "typographic") {
    if (tokenStyle === null) throw new Error("a typographic cover needs the manifest's design tokens");
    cover = await renderTypographicCover({ parsed, manifest, style, tokenStyle, tokenFonts, epochSeconds });
  } else if (manifest.cover === "illustrated") {
    if (tokenStyle?.cover == null) throw new Error("an illustrated cover needs design tokens with a cover ground and ink");
    if (!/\.(jpe?g|png)$/iu.test(manifest.coverArt ?? "")) throw new Error("an illustrated cover needs coverArt: the book's JPEG or PNG illustration");
    cover = await renderIllustratedCover({ parsed, manifest, tokenStyle, tokenFonts, epochSeconds });
  } else if (manifest.cover !== undefined) {
    throw new Error(`manifest cover must be "typographic" or "illustrated", not ${JSON.stringify(manifest.cover)}`);
  }

  return withProjectedChapters(book, async ({ staging, epubChapters, pdfChapters }) => {
    // A book that states its rights gets a copyright page generated from them: an EPUB
    // front-matter section after the title page, and the PDF's colophon page.
    const page = copyrightPageOf(book);
    const epubFront = [];
    if (page !== null) {
      const section = join(staging, "copyright.md");
      writeFileSync(section, copyrightPageMarkdown(page), "utf8");
      epubFront.push(section);
    }
    const copyrightArgs = copyrightPageArgs(page, staging);

    const epubPath = join(parsed.distDir, `${parsed.slug}.epub`);
    await run(
      parsed.pandocBin,
      // EPUB 3 carries formulas as MathML, which reading systems render natively.
      [...epubFront, ...epubChapters, ...metadataArgs, ...(tokenStyle?.book.contents === false ? [] : ["--toc"]), "--mathml", ...citeprocArgs, "--css", cssPath, ...(cover === null ? [] : ["--epub-cover-image", cover.path]), "-o", epubPath],
      // pandoc takes the EPUB's entry times and dcterms:modified from SOURCE_DATE_EPOCH.
      { env: { ...process.env, SOURCE_DATE_EPOCH: String(epochSeconds) } },
    );

    await finishEpubPackage(epubPath, manifest.accessibilitySummary ?? (assets.length ? "This book contains text and described images, with a table of contents, navigable headings, and a reading order that follows the chapters." : undefined), manifest.series, epochSeconds);

    const pdf = await renderBookPdf(book, bookPdfArgs(book, { chapters: pdfChapters, copyrightArgs, template: book.templatePath, geometry: "1.1in" }), join(parsed.distDir, `${parsed.slug}.pdf`));
    return buildRecord({
      manifest: parsed,
      chapters,
      epub: { path: epubPath, bytes: statSync(epubPath).size, sha256: sha256File(epubPath) },
      pdf,
      cover,
      assets: assets.map((asset) => ({ ...asset, bytes: statSync(asset.path).size, sha256: sha256File(asset.path) })),
      references,
      pandocVersion: book.pandocVersion,
      xelatexVersion: book.xelatexVersion,
      templateHash: book.templateHash,
      cssPath,
      cssHash: book.cssHash,
      style,
      designTokens: tokenStyle === null ? null : {
        path: parsed.tokens,
        sha256: sha256File(parsed.tokens),
        fonts: Object.fromEntries(Object.entries(tokenFonts).map(([role, { family, requested }]) => [role, { family, requested }])),
      },
      epoch: book.epoch,
      generatedAt: new Date().toISOString(),
    });
  });
}

export const operation = Object.freeze({ name: "produce-ebook", description: "Produce one ebook's EPUB and PDF artifacts, and return the assembled build record.", operation: produceEbook });
