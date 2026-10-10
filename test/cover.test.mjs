import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { latexText, renderCoverLatex } from "../src/ebook-production.mjs";

const template = readFileSync(new URL("../templates/cover.latex", import.meta.url), "utf8");
const book = (author) => ({ title: "Cost & Scope: 100% of it", subtitle: "A #1 guide", author, fonts: { display: "Noto Sans", body: "Roboto Slab", mono: "DejaVu Sans Mono" }, colors: { paper: "F2EAD8", ink: "0A0A0A", accent: "3D5588" } });

test("the cover fills every field and escapes LaTeX specials", () => {
  const latex = renderCoverLatex(template, book("Jane Writer"));
  assert.doesNotMatch(latex, /@@[A-Z]+@@/u);
  assert.match(latex, /Cost \\& Scope: 100\\% of it/u);
  assert.match(latex, /JANE WRITER/u);
  assert.match(latex, /\\definecolor\{bone\}\{HTML\}\{F2EAD8\}/u);
});

test("a book the Group authors does not repeat the Group above its own mark", () => {
  assert.doesNotMatch(renderCoverLatex(template, book("561 Group")), /561 GROUP/u);
  assert.equal(latexText("a_b~c"), "a\\_b\\textasciitilde{}c");
});

test("another brand's book carries that brand in the foot lockup", () => {
  const latex = renderCoverLatex(template, { ...book("Binding Generations"), brand: "Binding Generations" });
  assert.match(latex, /\\selectfont Binding Generations\\par/u);
  assert.doesNotMatch(latex, /BINDING GENERATIONS/u);
});

test("a series book names its series on the cover and in the EPUB package", async () => {
  const series = { name: "561 Group Study Companions", number: 2 };
  assert.match(renderCoverLatex(template, { ...book("561 Group"), series }), /561 GROUP STUDY COMPANIONS · 2/u);
  assert.doesNotMatch(renderCoverLatex(template, book("561 Group")), /STUDY COMPANIONS/u);
  const { withEpubAccessibilityMetadata } = await import("../src/ebook-production.mjs");
  const opf = withEpubAccessibilityMetadata("<package><metadata>\n  </metadata></package>", { series });
  assert.match(opf, /property="belongs-to-collection" id="collection-1">561 Group Study Companions</u);
  assert.match(opf, /property="group-position">2</u);
});

test("an EPUB whose items carry MathML declares the MathML accessibility feature", async () => {
  const { withEpubAccessibilityMetadata } = await import("../src/ebook-production.mjs");
  const withMath = withEpubAccessibilityMetadata('<package><manifest><item id="c" href="c.xhtml" properties="mathml svg"/></manifest><metadata>\n  </metadata></package>');
  assert.match(withMath, /accessibilityFeature">MathML</u);
  assert.doesNotMatch(withEpubAccessibilityMetadata("<package><metadata>\n  </metadata></package>"), /MathML/u);
});

test("a book's theme can center its cover and bring its own art, drawn in code", () => {
  const plain = renderCoverLatex(template, book("561 Group"));
  assert.match(plain, /\\raggedright/u);
  assert.doesNotMatch(plain, /\\begin\{tikzpicture\}/u);
  const themed = renderCoverLatex(template, { ...book("561 Group"), align: "center", art: "\\draw[ink] (0,0) -- (1,1);\n" });
  assert.match(themed, /\\centering\n/u);
  assert.match(themed, /\\begin\{tikzpicture\}\n\\draw\[ink\] \(0,0\) -- \(1,1\);\n\\end\{tikzpicture\}/u);
});
