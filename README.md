# Ebook production services section

Takes chapter Markdown files in, produces a publishable ebook out: EPUB and
PDF release artifacts and a build record that links the supported source
inputs to the generated output bytes. A book may also be derived from named
corpus sections (`scripts/derive-ebook-chapters-from-corpus.mjs`).

## Why this section exists

`pandoc-services-section`'s own README states its scope is document codec
conversion, explicitly not "release to an audience surface." Ebook
production — multi-chapter assembly, a deterministic build record, EPUB+PDF
release artifacts — is the natural sibling "book" document-genre package. It
shells to the same `pandoc` binary directly. That is a second pandoc
invocation owner beside `pandoc-engineering-services-section`'s
`project-document-through-pandoc-service`, and spawning processes is a
systems concern; the 2026-09-27 note on the book and specification publishing
systems (engineering-services-section notes) places the effect under
`computer-systems-publishing-engineering-services-section` and leaves the
algebra here. No cover is generated: image generation lives in
`@red-cup-engineering/computer-inference-engine/image/image-generation`, and a
typographic cover derived from the design tokens is the planned default.

## What lives here

- `src/ebook-production.mjs` — the production algebra: manifest validation,
  chapter listing, hashing, build-record assembly. Exported at the
  package's `"."` entry.
- `src/narration-script.mjs` — the pure sound-score narration projection.
  It emits sentence primitives anchored by chapter path, paragraph index,
  sentence index, and sentence digest, plus chapter, scene-break, room-tone,
  and credit cues as data. Provider request limits belong to the systems
  renderer and cannot change this projection.
- `scripts/produce-ebook.mjs` — the effect: runs pandoc twice (EPUB, PDF via
  `templates/book.latex`) and assembles the build record. Exported at `./scripts/produce-ebook.mjs` so a consumer
  section can call `produceEbook` directly rather than reimplementing the
  pandoc invocation contract this package exists to own.
- `scripts/produce-set-of-ebooks.mjs` — batch lift over `produceEbook`,
  exported at `./scripts/produce-set-of-ebooks.mjs` for the same reason.
- `scripts/derive-ebook-chapters-from-corpus.mjs` — derives one ordered
  chapters directory from named corpus section roots, plus the partial
  manifest `produceEbook` consumes. The former
  `derive-set-of-chapters-from-corpus-service` package was a second copy
  whose code file had gone missing; it was dissolved into this script on
  2026-09-27.
- `scripts/specify-ebook-edition.mjs` and `scripts/fabricate-ebook-edition.mjs`
  — write a digest-bound edition specification beside a manuscript, and admit
  and render it (see "Trusted-manuscript boundary").
- `apps/ebook-production-cli.mjs` — the composed CLI face: single-manifest
  or directory-batch production, JSON build record(s) on stdout.
- `templates/book.latex` — the house LaTeX template: chapter openers
  (accent-colored number, `titlesec`), running heads (`fancyhdr`), a title
  page with subtitle and imprint, and a colophon page, all parameterized
  by the `style` fields below plus TOC and the `build-record-hash` variable.
- `templates/book.css` — the house EPUB stylesheet, passed to pandoc via
  `--css`: chapter openers, headings, blockquotes, and link/accent color for
  EPUB readers. Pandoc does not template-substitute `--css` files, so a book
  styled from design tokens gets a derived stylesheet instead (below).

### House style

A manifest's optional `tokens` field names a Design Tokens Community Group
document (Format Module 2025.10), such as the 561 Group Design Bible's
`561-group-services-section/services/561-group-content-design-services-section/data/records/design-tokens/561-group.tokens.json`,
resolved relative to the manifest. `designTokenStyle()` reads the book roles
out of it: the body, display and metadata font stacks (`type.body-1`,
`type.display-1`, `type.metadata`), ink (`color.ink`) and the accent
(`color.witness`, the Design Bible's evidence color, which is what links and
citations are). `produceEbook` then:

- resolves each stack to the first family this box can set, as the web would:
  a named family `fc-list` reports, or, on reaching a generic keyword, the
  family `fc-match` gives for it;
- hands the Unicode math blocks to DejaVu Serif when the body family lacks
  them, and slants the body family for emphasis when it has no italic face
  (Roboto Slab has neither);
- applies the Design Bible's type-pairing rules (no first-line indent, space
  between paragraphs, lining tabular figures);
- writes `<distDir>/<slug>.css`, the base stylesheet followed by the
  token-derived rules (`bookStylesheet()`), and uses it for the EPUB;
- records the tokens file's digest and the families chosen in the build
  record's `designTokens` field, and binds the tokens' bytes into the edition
  digest.

A manifest's optional `style` field — `{brand, division, colophon,
fontFamily, accent, parent}` — parameterizes the PDF template, and wins over
a token-derived value. `resolveStyle()` (`src/ebook-production.mjs`) fills
in house defaults (`brand: "561 Group"`, `division: null`, `fontFamily:
"DejaVu Serif"`, `accent: "6B2737"`) for a book without tokens, and computes
the colophon line (the "Three Marks" rule, generalized to books 2026-09-04; the
note that first stated it is not in the tree, and the Design Bible's colophon
stamp element is its living source) when `colophon` is not given directly:
`"A <brand> book · <division> · a division of <parent>"`, defaulting
`parent` to "the 561 Group" and omitting the "a division of" clause
entirely when `brand` names the 561 Group's own household.
The same computed line is used both as the title page's imprint and the
colophon page's quiet line. `produceEbook` refuses to run
(`assertFontFamilyInstalled`, `scripts/produce-ebook.mjs`) when
`style.fontFamily` names a family `fc-list` does not report installed on
this box, rather than letting xelatex silently substitute a different font.

## What this section does not own

- Markdown admission (`markdown-file-services-section`'s concern).
- Release-to-audience-surface composition — publishing the produced
  artifacts to a storefront, feed, or channel is a downstream concern.
- Payment/checkout — see "Market face" below; this section only specs the
  priced endpoint shape, it does not implement billing.

## Trusted-manuscript boundary

`fabricateEbookEdition()` admits a digest-bound edition specification, runs the
fixed local Pandoc/XeLaTeX renderer, and verifies the output bytes it reports.
It only accepts trusted, Group-controlled manuscript paths. Pandoc and TeX can
read local files through document features, so this is not a safe processor for
customer uploads. A future commissioned-publication runner must provide an
isolated filesystem and toolchain. Renderer success proves only that the EPUB
and screen PDF bytes were produced; EPUB conformance, accessibility,
print-readiness, editorial proof acceptance, payment, and public listing
remain separate evidence and decisions.

Published version `0.2.0` binds the manuscript digest to the generic work-order
provenance field and is unsupported for admitted jobs. The corrected adapter
keeps work-order provenance intact and requires its fixed projection profile to
carry the separate `editionInputDigest` from `describeEbookEditionSource()`.

The edition-input digest covers only the ordered Markdown chapter bytes, this
package's fixed LaTeX template and CSS stylesheet, and the edition metadata
(`slug`, title, subtitle, author). The adapter rejects inline Markdown image links and LaTeX
`\\includegraphics` directives because it does not yet admit and digest assets;
this is not a complete asset parser. It reports Pandoc and
XeLaTeX versions, but does not claim a complete toolchain/font closure or full
reproducibility.

## The build record

`buildRecord()` assembles: the ordered chapter set (each chapter hashed,
then the ordered digests joined and hashed again — see
`sha256ChapterSet`'s JSDoc), the template's own sha256 and the stylesheet's
own sha256 (so a template or CSS edit is visible in the record, not just
inferred), a `sourceHash` (chapter set hash + template hash + stylesheet
hash, hashed together — see `sha256SourceHash`'s JSDoc) that is also the
value stamped into the PDF's own colophon via `build-record-hash` — so a
reader can compare the hash printed inside the delivered PDF against the
same field in the delivered build record and confirm they share one source —
pandoc's version, the resolved `style` object, per-artifact `{path, bytes,
sha256}`, cover provenance when a cover was generated, and `generatedAt`.

## Citations

A chapter cites sources by giving its YAML frontmatter a `references` map,
keyed by citation id, whose values are CSL-JSON items (`id`, `type`,
`title`, `author`, `container-title`, `issued`, `DOI`/`PMID`/`URL`, …);
in-text citations use pandoc's `[@id]` / `[@id1; @id2]` syntax. `produceEbook`
merges every chapter's `references` map via `collectReferences()` (first-seen
id order across the sorted chapter set; a duplicate id across chapters must
carry byte-identical CSL-JSON or the build throws naming the id and both
files), writes the merged CSL-JSON array to `<distDir>/<slug>-references.json`,
and passes it to pandoc as `--citeproc --bibliography <that file>` so `[@id]`
renders inline and a "References" section is emitted for both EPUB and PDF.
A book with no `references` in any chapter builds exactly as before — no
citeproc flags, no References section. The build record carries
`referencesCount` and `referenceIds`.

## Reproducibility

When the ebook toolchain changes, carry accepted editions forward with this
command. It re-specifies from the existing request and acceptance statement,
fabricates into staging, carries the proof only when EPUB and PDF extracted
text is unchanged, then accepts and verifies the next edition before replacing
the book's state. A refusal leaves the current edition and records untouched.

```sh
node scripts/carry-editions-forward.mjs \
  path/to/ebook.json path/to/latest-proof.json path/to/latest-acceptance.json
```

Pass more triples for several books. For a record directory, use
`--records-dir <dir> --book-root <root>`, where `<root>/<slug>/ebook.json` is
each manifest. `--catalog <shop catalog.json>` updates accepted book paths;
`--stage` explicitly requests paid-release staging with upload enabled on either carry-forward or changed-source acceptance. With `--catalog`, staging uses the book row’s `release` namespace (which can differ from its manuscript slug); a missing or ambiguous mapping is refused. `--offering` can name the namespace without a catalog and must agree when both are supplied. Acceptance alone never publishes a release. A staging failure reports incomplete publication while retaining the accepted edition.
Those release options are intentionally opt-in.

When a book's words or metadata change (a new byline, a retitled edition), its
proof cannot be carried; issue the next edition around a fresh proof instead:

```sh
node scripts/issue-ebook-edition.mjs stage path/to/ebook.json path/to/latest-acceptance.json <stage-dir>
# an independent proofreader reads <stage-dir>/text/ (both editions' text and
# their diffs) and the files in <stage-dir>/dist/, and writes the proof
node scripts/issue-ebook-edition.mjs accept path/to/ebook.json path/to/latest-acceptance.json <stage-dir> <proof.json> [--catalog <catalog.json>] [--stage] [--offering <release-id>]
```

`accept` refuses as carrying does, verifies the rebuild, then homes the
edition and its records under the next ordinal.

A book's first edition has no prior acceptance: pass `first` in its place. The
edition is homed at the manifest's `distDir`, with its records beside the other
editions' records, and `first` is refused once the book has an edition.

`scripts/validate-kindle-edition.mjs` validates an edition for Kindle. Given
`--fabrication`, `--acceptance` and `--release-out`, a passing validation also
writes the Kindle release acceptance the retail channels admit it on.

An edition that states its date in its manifest (`"date": "YYYY-MM-DD"`)
builds byte-identical EPUB and PDF files on any checkout: the same bytes
whatever the files' mtimes, whatever directory the manuscript or output
sits in, whenever it runs. The rules that make this so:

- **The epoch is the edition date.** Every timestamp the toolchain embeds
  comes from midnight UTC on that date (`editionEpochSeconds`):
  - pandoc's EPUB entry times and `dcterms:modified`, through
    `SOURCE_DATE_EPOCH`;
  - xelatex's CreationDate and ModDate;
  - the printed "drafted" stamp.

  The date is bound into the edition input digest like any other input that
  shapes the bytes. A manifest without a date falls back to its sources'
  newest mtime, which a fresh checkout resets. Such a build reproduces only
  on the machine that made it, and its build record says
  `epoch.source: "source-mtime"`.
- **The re-zipped package file is pinned.** The accessibility and series
  metadata is written into `content.opf` after pandoc, and re-zipped with
  the epoch as its time, mode 0644, and times in UTC.
- **The PDF's identifier comes from its content.** xdvipdfmx seeds the
  trailer `/ID` partly from the output path. `withDeterministicPdfIdentifier`
  replaces it with a prefix of the SHA-256 of the file with its `/ID` zeroed,
  at the same length, so no byte offset moves. This is the approach of qpdf's
  `--deterministic-id`.
- **The toolchain is part of the input.** Identical bytes need the same
  pandoc, TeX Live and fonts. The build record names the pandoc and xelatex
  versions, and the design-token fonts it resolved.

`scripts/verify-ebook-edition.mjs <ebook.json> <acceptance.json>` rebuilds
an accepted edition in a scratch directory and reports whether both files
match the digests its acceptance record names. Checked on 2026-09-27:
*Data Analytics, Course by Course*, dated, was built three times into three
directories, the third from a copy of the manuscript after every file's
mtime changed. It gave one EPUB and one PDF digest. Before these rules, two
builds a minute apart differed in the EPUB's entry times and
`dcterms:modified`, and in the PDF's `/ID`.

## Deferred: typst

Typst is not installed on this box. `templates/book.latex` is the only
template this pass ships; typst template support is queued, not faked.

## Market face (spec, not deployed)

The product hypothesis is that a public build record linking supported source
inputs to delivered artifacts will help publishers assess provenance. The
capabilities and provenance claims of Reedsy, Draft2Digital, Vellum, Atticus,
KDP, IngramSpark, and Pressbooks have not been measured here.

An x402-priced `POST /produce` endpoint remains an intended downstream surface:

- **Request**: `{ manifest, files: [{ name, contentBase64 }] }` — `files`
  are the chapter Markdown, base64-encoded (or multipart); `manifest`
  matches the shape `parseManifest()` validates, with `bookDir`/`distDir`
  resolved server-side rather than taken from the caller.
- **Pricing**: gated by x402 (per-request USDC payment) before production
  runs.
- **Response**: `{ artifacts: { epub, pdf, cover? }, buildRecord }` where
  `artifacts` carries download references (not raw bytes) and
  `buildRecord` is exactly the object `buildRecord()` returns.

Its implementation requires isolated manuscript processing, x402 wiring, and
artifact storage/serving before it can accept customer bytes.

Manifest paths (`bookDir`, `distDir`, `template`, and `css`) are resolved relative to the JSON manifest, independently of the calling directory. Public education supplies these manifests and manuscripts; it contains no ebook build program.

## Book themes

Every book can look like itself. A book's look comes from the design tokens its manifest
names (`tokens`), and a book may have a tokens record of its own beside its manuscript's
owner, as Binding Generations' books and *Ice Out* do; the Group's tokens are only the
default. From the tokens the build takes:

- the body, display and metadata families, the ink, the accent and the page paper;
- the cover's own ground and type (`color.cover-ground`, `color.cover-ink`), so a cover
  can be dark over light pages;
- the book's theme, the `book` block of the tokens' `$extensions["org.561.group"]`
  (`BOOK_THEME` in `src/ebook-production.mjs` lists each setting and its allowed values;
  the first is the default, and an unknown setting or value is refused, not guessed):

| setting | values | what it sets |
|---|---|---|
| `paragraphs` | `spaced`, `indented` | spaced paragraphs with no indent (the Design Bible), or continuous prose: indented, no space between, flush after a heading or scene break (Bringhurst 2.3.1–2.3.2) |
| `sceneBreak` | `rule`, `space`, or a mark such as `⁂` | what a Markdown `---` becomes between scenes, in the PDF and the EPUB |
| `chapterLabel` | `chapter`, `number`, `none` | "Chapter 3", "3", or no label over a chapter's title |
| `chapterAlign` | `left`, `center` | the chapter opener's alignment |
| `chapterWeight` | `bold`, `display` | bold chapter titles, or the display family's own weight |
| `titleGround` | `accent`, `cover` | the PDF title page's band: the accent, or the cover's ground and ink |
| `contents` | `true`, `false` | whether the PDF prints contents and the EPUB a contents page |
| `runningHeads` | `italic`, `small-caps` | the running heads' face |
| `rectoHead` | `section`, `chapter` | the recto running head: the current section, or (for a book without sections, such as a novel) the chapter's title |
| `colophon` | `build-record`, `plain` | the colophon page: the Group's stamp (imprint, drafting date, build-record digest), or the drafting date alone, the digest staying in the build and verification records |
| `coverAlign` | `left`, `center` | the cover's alignment |
| `chapterArt` | `none`, `chapter`, or a declared ornament path | no opener art; the declared `art:` asset in each chapter's frontmatter; or one declared ornament at every opener |
| `dropCaps` | `false`, `true` | whether the first prose paragraph after each chapter heading begins with a drop cap |

`sceneBreak` may also be the path of a declared `ornament` asset. The EPUB uses
the ornament's raster projection and the PDF uses its print projection instead
of the ordinary rule or text mark.

A manifest's `cover` is `typographic` or `illustrated`, and `coverArt` names the art.

- A typographic cover (`templates/cover.latex`) is set from the tokens alone. Its
  `coverArt`, if any, is a TikZ drawing: the body of a `tikzpicture`, in the cover's
  colors `bone`, `ink` and `witness`, set between the subtitle and the foot. It is art in
  code, reproducible and inference-free.
- An illustrated cover (`templates/cover-illustrated.latex`) sets the tokens' type over
  the book's own JPEG or PNG illustration: the title in the display family, and the
  byline in `type.cover-byline` if the tokens set one, else the metadata family. The
  edition's cover is then a JPEG. `coverArtProvenance` (`model`, `modelName`,
  `provider`, `references`) says how the illustration was made. The build record
  carries it, and `illustratedCoverDisclosure()` turns it into the one sentence that the
  copyright page, the shop and the retail listings all print.

The art's bytes and the cover template's bytes join the edition's input digest, as the
tokens' do. A book with none of these gets the look every book had before themes.

### Rights and the copyright page

A manifest may state its `rights`:

```json
{ "rights": { "holder": "Causeway Services", "year": 2026, "reservation": "…", "authorship": "…", "notices": ["…"], "contact": "…" } }
```

The build then generates a copyright page (`copyrightPageText()`), which carries:

- the title, and the series if the book is in one;
- the notice, "Copyright © year holder", with the reservation, which defaults to "All
  rights reserved.";
- the authorship statement, the cover disclosure and the typefaces;
- any further notices;
- the imprint and the contact.

The EPUB gets the page as a front-matter section (`epub:type=copyright-page`). In the PDF
it takes the colophon page's place, through `book.latex`'s `copyright-page` slot.
Since the page dates the edition, the title page then carries no date. The rights are
bound into the edition's input digest like its text.

### Declared book images

A chapter may use an image only when `ebook.json` declares it. Paths are relative
to `ebook.json`; every asset needs non-empty alternative text and one role:

```json
{
  "assets": [
    { "path": "art/june-at-the-window.png", "alt": "June looks through a frosted restaurant window.", "role": "illustration", "provenance": { "provider": "cloudflare-workers-ai", "model": "@cf/black-forest-labs/flux-1-schnell" } },
    { "path": "art/snowflake.tikz", "alt": "A six-point snowflake ornament.", "role": "chapter-art" }
  ]
}
```

Allowed source formats are PNG, JPEG and a TikZ body. Raster files are embedded
in both editions. TikZ is rendered to PNG for EPUB and included as vector PDF in
the screen PDF. Asset bytes, alt text, role and any provenance are bound into the
edition input digest. Markdown image targets and chapter-frontmatter `art:` values
which do not resolve to declared assets are refused with
`UNDECLARED_EXTERNAL_ASSET`; Markdown alt text must be non-empty and match the
manifest's authoritative alt text.

Generate and declare an illustration through the inference engine without making
a second image client. Generating is an effect, so the command lives in the systems
layer, in `computer-systems-publishing-engineering-services-section`:

```sh
generate-book-illustration path/to/ebook.json \
  --prompt "June at the restaurant window during lake-effect snow" \
  --path art/june-at-the-window.png \
  --alt "June looks through a frosted restaurant window." \
  --role illustration
```

The command writes the PNG and its `.provenance.json` sidecar, then updates the
manifest declaration with the provider and image model. If the manifest names a
story bible whose `visualStyle` object carries such fields as `palette`, `medium`,
`motifs`, or `characterLooks`, the command prepends that canon style to the prompt.
Tests inject a stub generator and never call a live provider.

## Manuscript lint

`lintManuscript()` (`./lint-manuscript`, `scripts/lint-manuscript.mjs <ebook.json>`) is
the check a manuscript passes before design starts.

Errors, which stop the build:

- a chapter file without exactly one top-level heading;
- a citation key that no chapter's `references` defines.

Warnings, left to the editor's judgment:

- a defined reference never cited;
- a paragraph stating a dollar amount or percentage without a citation;
- a sentence forecasting what "will" happen;
- a chapter outside the length bounds.

A file whose one heading carries the `.unnumbered` class, alone or beside an
`epub:type` such as `afterword`, `appendix` or `glossary`, is front or back matter,
not a chapter. Matter is exempt from the length bounds and, under `fiction`, from the
chapter frontmatter rules below. It still has to have exactly one top-level heading.

The manifest's `profile` chooses extra rules. `study-guide` requires each chapter's
objectives, self-check questions and answers, and an independence notice.
`fiction` drops the forecast and uncited-figure warnings and checks the manuscript
against the story bible that the manifest's `storyBible` names. A story bible is a
`StoryBible` record: the book's world as a reproducible paracosm, after media science's
Reproducible Paracosm Specification. Each numbered chapter's frontmatter declares its
`pov`, its in-story date `when`, its arc `beat`, and the secrets it `reveals`. The lint
then checks, as errors:

- that the point-of-view character is one the bible names;
- that no retired name appears;
- that no passage matches one of the bible's `refusals` (patterns the book's evidence
  packet ruled out);
- that dates never go backward except in a chapter marked `flashback`;
- that beats follow the bible's `arc` in order and the last chapter reaches its end;
- that every secret in the bible's `knowledge` is revealed exactly once.

For an open serial, pass `serialInProgress: true` (CLI:
`--serial-in-progress`). Only the two conditions that require an ending change:
an arc not yet at its final beat and secrets not yet revealed become warnings.
Duplicate revelations and every continuity/coherence failure remain errors.

As warnings, it reports point of view that fails to alternate when the bible's
`locales.povAlternates` says it should, and any capitalized name mid-sentence that
the bible's signature does not know. A lexicon entry may be a string or
`{ "term": "jook", "foreign": true }`; every entry marked `foreign` warns unless
the bible's optional `pronunciations` array has `{ "term", "ipa"? ,
"respelling"? }` for it. A bible may also carry optional casting as
`voices: { narrator: { id, style? }, pointOfView?: { [characterId]: { id,
style? } }, characters?: { [characterId]: { id, style? } } }`. These are
edition inputs. `deriveSoundScoreNarrationLayer()` assigns ordinary sentences
to the chapter's point-of-view voice and attributes quoted dialogue when a
speech tag in that sentence or its neighbor names a bible character or alias;
unresolved dialogue falls back to the point-of-view narrator. Every narrate
event records its speaker id, voice, style, emphasis/dialogue markers, and
stable manuscript anchor. Editing a paragraph therefore changes only that
paragraph's sentence identities. The same layer carries scene breaks, chapter
heads, room tone, and credits as cues rather than pre-rendered audio. A chapter
file whose frontmatter says `narrate: false` is left out of the narration. Use it
for matter made for the page, such as a recipe, a glossary or a reading guide.

The house YAML codec reads chapter frontmatter, so `references` must be written in block style:
nested flow collections such as `{date-parts: [[2026]]}` are refused.
