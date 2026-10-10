---
name: producing-a-book-edition
description: "Carry a book from research to a fabricated edition: an evidence packet in the owning science section, a manuscript beside it, the manuscript lint, the Design Bible's tokens, a digest-bound edition specification answering the founder's request, and a fabricated edition in the MetroPlat library awaiting its proof. Offer and announcement wait for the accepted edition."
closure-kind: process
requires-capabilities:
  - read
  - write
  - path-corpus
  - markdown-search-workbench
  - markdown-file-workbench
  - term-intension
  - lspace-vault-topic
  - lspace-vault-search
  - lspace-vault-readings
  - lspace-vault-divergences
---

# Producing a book edition

The phases and the record each hands to the next are set out in the engineering
note on the book and specification publishing systems
(`engineering-services-section/content/text/documents/articles/notes/2026/09/27/2026-09-27-note-on-the-book-and-specification-publishing-systems.md`).
*The x402 Economy* (economics science section, 2026-09-27) is the reference run.
Paths below are relative to `lib/emsenn/services/561-group/services/`, and the
ebook section is
`engineering-services-section/services/computer-engineering-services-section/services/computer-data-engineering-services-section/services/computer-content-engineering-services-section/services/computer-documents-engineering-services-section/services/ebook-engineering-services-section`.

## 1. Research: the evidence packet

1. Read what the corpus holds on each topic: `lspace-vault-topic` for gaps,
   `lspace-vault-search`, and `lspace-vault-readings` or
   `lspace-vault-divergences` for disagreements. L-Space indexes the science
   section only, so search engineering, enterprise and protocol sections
   through the workspace tools, never a bare tree-wide grep.
2. Fill the gaps from primary sources, dated.
3. Write one evidence packet as a note in the science section that owns the
   topic, `notes/YYYY/MM/DD/YYYY-MM-DD-note-on-<topic>.md`:
   - every claim with its source and date;
   - every contested figure with each reading kept, marked supported, refuted,
     both or neither.
4. Correct any house note the research proves wrong, in the same commit.
5. Add the missing glossary terms the cluster's `requires` and `enables`
   frontmatter needs.

## 2. Write: the manuscript

1. Put the manuscript with the public services section that delivers its
   subject (a study companion with its public education section, a public
   book with its public subject section; the research it rests on stays in
   the science section):
   `content/books/<slug>/NN-<chapter>.md` and `ebook.json`, with `slug`,
   `title`, `subtitle`, `author`, `bookDir`, `distDir`, `tokens`, and
   the edition `date` (`YYYY-MM-DD`). The date sets every timestamp the
   build embeds, so the edition rebuilds byte for byte from any checkout.
   - Its public metadata goes in the same file: `description`, `keywords`,
     BISAC `subjects`, and the third-party `marks` it names. The shop and
     the retail listings read them from there.
   - A study companion to a credential sets `"profile": "study-guide"`; the
     lint then holds it to the education science section's 2026-09-27 note on
     how a study companion should teach (objectives, self-checks with answers,
     an independence notice).
   - A book in a series sets `"series": { "name", "number" }`; the cover
     and the EPUB's `belongs-to-collection` metadata carry it.
2. Structure the chapters:
   - one `#` heading per file;
   - front matter and glossary headings marked `{.unnumbered}`, so chapter
     numbers match the text's cross-references.
3. Put the sources as CSL-JSON in one chapter's frontmatter `references` map.
   - Write it in **block** YAML: the house codec refuses nested flow
     collections.
   - Wrap a lowercase brand in a title (`<span class="nocase">x402</span>`)
     so citeproc does not capitalize it.
4. Write for the book's register. A public book follows the plain technical
   general American English style guide
   (`science-services-section/services/information-science-services-section/services/communication-science-services-section/services/writing-services-section/services/plain-technical-general-american-english-services-section/content/text/documents/articles/notes/style-guide.md`).
   It forecasts nothing, and states conditions instead.
5. Run the lint until it reports no error:
   `node <ebook section>/scripts/lint-manuscript.mjs <ebook.json>`.
   Read every warning. Cite the uncited figures, and reword the forecasts.

## 3. Design: the tokens

1. Point `tokens` at the Design Bible's
   `561-group-services-section/services/561-group-content-design-services-section/data/records/design-tokens/561-group.tokens.json`,
   relative to `ebook.json`. The build then takes body, display and metadata
   families, ink and the witness accent from it.
2. Build once and look at the pages before specifying an edition:
   `node <ebook section>/apps/ebook-production-cli.mjs --manifest <ebook.json>`.

## 4. Publish: the edition

1. Find the address of the founder's request the edition answers, with the
   agent-harness `utterances.mjs` (`readTranscriptPrompts`, then
   `deriveUtterances`). It is `semanticId({ kind: "utterance", session, text })`.
2. Specify the edition into the MetroPlat library:
   `node <ebook section>/scripts/specify-ebook-edition.mjs <ebook.json> --request <ni> --dist <owning section>/data/state/editions/<slug> --source-out <scratch>/source.json --proof "<who proofs it>"`.
3. Fabricate it, and keep the receipt as the owning section's record:
   `node <ebook section>/scripts/fabricate-ebook-edition.mjs <book>/edition-specification.json <scratch>/source.json > <owner>/data/records/editions/YYYY-MM-DD-<slug>-<ordinal>-edition.json`.
   The status is `fabricated-awaiting-acceptance`. The edition's bytes stay
   out of version control; ops serves them at `/library`.

## 5. Accept: an independent proof

1. Set `"cover": "typographic"` in `ebook.json` before the final build.
2. Have a reader other than the writer proof the edition against the evidence
   packet and the primary sources, and return findings as an
   `EbookEditionProof` (id, file, severity, claim, source, fix, resolution).
   The proof names the edition input digest and the `sha256` of the EPUB and
   PDF it read, from the fabrication record’s `artifacts`.
   A finding the writer declines keeps its explanation in a `reason` field;
   acceptance refuses a declined error or correction without one.
3. Fix every error and correction, then re-specify and re-fabricate.
4. Have the same proofreader verify the fixes on the new edition's digest. A
   fix can introduce a new inconsistency, which is another finding.
5. Accept the edition, and keep the proof and the acceptance as the owner's
   records:
   `node <ebook section>/scripts/accept-ebook-edition.mjs <fabrication.json> <proof.json> > <owner>/data/records/editions/<date>-<slug>-<ordinal>-edition-acceptance.json`.
   It refuses a proof of another digest, a proofer who is the writer, and any
   error left open.
6. Check the accepted edition reproduces:
   `node <ebook section>/scripts/verify-ebook-edition.mjs <book>/ebook.json <acceptance.json>`
   rebuilds it in a scratch directory and must report `"reproduced": true`.
   An edition without a `date` cannot pass from another checkout.
7. When the build pipeline changes (template, layout filter), or an edition
   gains its date, every accepted edition is re-rendered into a scratch
   directory and re-accepted:
   - If its text is unchanged, carry the proof:
     `node <ebook section>/scripts/carry-ebook-proof.mjs <prior-proof.json> <prior-acceptance.json> <owner>/data/state/editions/<slug> <fabrication.json> <scratch dist>`.
     This compares every XHTML document of the two EPUBs, and the two PDFs'
     text with the colophon's build digest set aside. It refuses when
     anything a reader reads changed. Accept on the carried proof, and move
     the files into `<owner>/data/state/editions/<slug>`.
   - If the text changed, the proofer re-verifies.

   Then restage with `--dir <owner>/data/state/editions/<slug>`: the release
   pointer moves, and earlier buyers keep their bundle.

## 6. Sell: one offer, one delivery

Paths in this section are under
`lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/`.

1. Stage the release. With `WRANGLER` naming the wrangler entry script, run
   `node <storefront>/scripts/stage-paid-release.mjs <acceptance.json> --offering <slug> --out <scratch> --upload`.
   It stages only an accepted edition, and only if the EPUB and PDF on disk
   are the bytes the proof accepted.
   `<storefront>` is
   `computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-platform-services-section/services/web2-platform-services-section/services/web2-financial-platform-services-section/services/web2-payment-platform-services-section/services/digital-goods-storefront-services-section`.
2. Declare one offer in
   `computer-networking-engineering-services-section/services/x402-services-section/data/market-561-group/records/catalog.json`.
   - Gateway `publications`, route `/v1/publications/<slug>`, operation `<slug>`.
   - Compute `readPaidRelease` and validation `admitPaidRelease` from the
     storefront's `./paid-release`, with args `["offer.operation", "env"]`.
   - A framing description of at most 500 characters.
3. Run the market's `scripts/compile-catalog.mjs` and commit.
4. Deploy the market Worker from a clean worktree at that commit
   (`pnpm --filter "@red-cup-engineering/x402-services-section..." install --offline --frozen-lockfile`,
   then wrangler deploy). Never deploy from the shared checkout, whose peers'
   uncommitted code would ship.
5. Check the route answers 402 with the right `PAYMENT-REQUIRED` amount.
6. Add a shop row
   (`public-services-section/services/public-resources-services-section/services/public-consumer-resources-services-section/sites/shop.561.group/catalog.json`,
   relative to `lib/emsenn/services/561-group/services/`) linking to
   `https://market.561.group/#publications-<slug>`, and deploy the shop.
7. Write a launch record in the seller's `data/records/launches/`: the price
   and its evidence, the channels, and what stays open.

## 7. Promote: the house's own properties

1. Add a creative to the house ad engine's
   `computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-advertising-system-engineering-services-section/data/records/house-creatives.json`.
   - `live` only once the shop page is live.
   - `contexts` are the Koios desks and tags whose readers the book serves.
2. Deploy the `sites/house-ads-server` Worker the same clean way.
3. Koios articles carry an `afterArticle` house slot with the article's desk
   and tags as context, so a fitting book is preferred there without tracking
   anyone.

Never sell, advertise or announce an edition before it is accepted.
