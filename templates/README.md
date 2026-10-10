# Templates

`book.latex` is a hand-written Pandoc LaTeX template (`\documentclass{book}`,
a title page, `\tableofcontents`, and a colophon printing the
`$build-record-hash$` variable) compiled for real against xelatex on this
box. It is the default PDF template `scripts/produce-ebook.mjs` uses when a
manifest does not name its own `template` path.

`cover.latex` and `cover-illustrated.latex` set an ebook's cover (typographic,
or the house type over the book's illustration), rasterized to 1600 x 2560.
Both, with `book.latex`, are bound into every edition's source digest:
changing one changes every edition's identity.

The paperback has its own two, which `scripts/produce-print-edition.mjs`
fills (the rules are in `src/print-edition.mjs`):

- `book-print.latex` sets the interior from the same chapters, theme and
  layout filter as `book.latex`, at the trim size with mirrored margins and
  KDP's gutter for the page count, in black ink, with a half title, title
  page, copyright page and contents in roman-numbered front matter and every
  chapter opening on a recto.
- `cover-wrap.latex` sets the one-page full-wrap cover: the illustrated
  ebook cover's front at the trim's scale (the same coordinates and type,
  the illustration grown into the bleed), the spine's title and byline, and
  the back's series, description, byline and imprint, leaving clear the box
  where KDP prints the barcode.

Typst output is deferred: typst is not installed on this box
(`bare-cedar-fog`), so no typst template exists here yet. Adding one is
queued, not faked.
