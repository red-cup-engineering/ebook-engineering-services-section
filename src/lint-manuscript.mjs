/**
 * The manuscript check a book passes before design starts: the hand-off
 * record from writing to design carries its result. Pure over chapter texts,
 * so the same findings come back for the same bytes.
 *
 * Hard findings (severity "error") stop the build:
 * - a chapter without exactly one top-level heading (each file is one chapter
 *   under --top-level-division=chapter);
 * - a citation key used in a chapter that no chapter's `references` defines;
 * - a reference whose author list ends in a literal "et al.", which citeproc
 *   renders as "Beck and et al.": list the authors, and the style abbreviates.
 * Soft findings ("warning") are for the editor's judgment:
 * - a defined reference no chapter cites;
 * - a paragraph that states a dollar amount or a percentage without a citation;
 * - prophecy: a sentence asserting what "will" happen beyond the book's own
 *   forward references;
 * - a chapter outside the length bounds.
 *
 * The `study-guide` profile (a companion to a credential; the education
 * science section's 2026-09-27 note on how a study companion should teach)
 * adds errors for a numbered chapter without "What you will be able to do",
 * "Check yourself" or "Answers" sections, for a "Check yourself" whose
 * questions outnumber its answers, and for front matter that does not say the
 * book is independent of the credential's owner. It also exempts the worked
 * examples, self-checks and answers from the uncited-figure warning: their
 * numbers are the book's own invented cases and arithmetic, not claims.
 *
 * The `fiction` profile drops the prophecy and uncited-figure rules (a
 * character may say "will", and a story's numbers are not claims) and checks
 * the manuscript against its story bible, the book's world as a reproducible
 * paracosm (media science's Reproducible Paracosm Specification, RPS v0.1).
 * Each numbered chapter's frontmatter declares its `pov`, its in-story date
 * `when`, its arc `beat`, and the secrets it `reveals`. The checks are the
 * standard's finite verifications, read for a novel:
 * - signature (S): the point-of-view character is one the bible names; a
 *   retired name (a character renamed in an earlier draft) is an error, and a
 *   capitalized name mid-sentence that the bible does not know is a warning;
 * - coherence (Θ): no passage matches one of the bible's refusals, the
 *   design rules the evidence packet derived (no wrist grab, no forced kiss);
 * - descent (J): chapters glue in time (`when` never goes back except in a
 *   chapter marked `flashback`) and, when the bible says so, point of view
 *   alternates, so each chapter is a local view that agrees with its neighbours;
 * - normalization (N): beats follow the bible's arc in order and the last
 *   numbered chapter reaches the arc's final beat, so the story terminates
 *   where its genre promises;
 * - knowledge (□_K): every secret one character keeps from another is
 *   revealed exactly once, in a numbered chapter.
 */
import { readMarkdownFrontmatter } from "@red-cup-engineering/read-markdown-frontmatter-service";
import { projectMarkdownBlocks } from "@red-cup-engineering/markdown-engineering-services-section/project-markdown-blocks";

const CITATION = /\[(?:[^\]]*?)@([A-Za-z0-9_:.#$%&+?<>~/-]+)[^\]]*\]/gu;
const CITATION_KEYS = /@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*)/gu;
const FIGURE = /(\$\s?\d|\d(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s(?:million|billion))/u;
const PROPHECY = /\b(will|is going to|are going to)\b(?![^.]*\b(?:chapter|section|appendix|below|next)\b)/iu;

function words(text) {
  return (text.match(/\b[\w'’-]+\b/gu) ?? []).length;
}

function paragraphs(blocks) {
  return blocks.flatMap((block) => {
    if (block.kind === "paragraph") return [block.text];
    if (block.kind === "list") return block.items.flatMap((item) => paragraphs(item.blocks));
    if (block.kind === "quote" || block.kind === "callout") return paragraphs(block.blocks);
    return [];
  });
}

const INVENTED_NUMBERS = /^(worked example|the running example|check yourself|answers)\b/iu;

/** The blocks outside any level-2 section whose heading matches `exempt`. */
function blocksOutside(blocks, exempt) {
  let skipping = false;
  return blocks.filter((block) => {
    if (block.kind === "heading" && block.level <= 2) skipping = block.level === 2 && exempt.test(block.text.trim());
    return !skipping;
  });
}

// A heading whose attributes carry the `.unnumbered` class, alone or beside
// others such as `epub:type=afterword`, opens front or back matter, not a chapter.
const UNNUMBERED = /\{[^}]*\.unnumbered\b[^}]*\}\s*$/u;
const INDEPENDENCE = /\b(not (affiliated|endorsed|sponsored)|independent (study )?(companion|guide|publication))\b/iu;

function sectionBlocks(blocks, heading) {
  const start = blocks.findIndex((block) => block.kind === "heading" && block.level === 2 && block.text.trim().toLowerCase() === heading);
  if (start < 0) return null;
  const end = blocks.findIndex((block, index) => index > start && block.kind === "heading" && block.level <= 2);
  return blocks.slice(start + 1, end < 0 ? undefined : end);
}

function countItems(blocks) {
  return (blocks ?? []).filter((block) => block.kind === "list" && block.ordered).reduce((sum, list) => sum + list.items.length, 0);
}

// A capitalized word after a lowercase word, a comma or a semicolon; a camel-cased brand ("QuickBooks") is
// one word. A colon starts a sentence ("Dad: Hot one today"), so a capital after it is not a name.
const MID_SENTENCE_NAME = /(?<=[a-z,;]\s)[A-Z][\p{Ll}’'-]+(?:[A-Z][\p{Ll}’'-]+)*(?:\s[A-Z][\p{Ll}’'-]+(?:[A-Z][\p{Ll}’'-]+)*)*/gu;

function prose(blocks) {
  return paragraphs(blocks).join("\n");
}

// A name as the bible spells it: no possessive, no trailing period or hyphen ("June's", "Mr.", "I-35").
const bare = (word) => word.replace(/['’]s?$/u, "").replace(/[.-]+$/u, "");
// "I'm", "I'll" and the other contractions of I are not names; a plural ("the Tams") is its singular.
const knownTo = (known, word) => /^I['’]/u.test(word) || known.has(word) || (word.endsWith("s") && known.has(word.slice(0, -1)));

/** The proper nouns a story bible knows: every word of every name, alias and lexicon entry. */
function knownNames(bible) {
  const names = [
    ...(bible.signature?.characters ?? []).flatMap((c) => [c.name, ...(c.aliases ?? [])]),
    ...(bible.signature?.places ?? []).flatMap((p) => [p.name, ...(p.aliases ?? [])]),
    ...(bible.signature?.lexicon ?? []).map((entry) => typeof entry === "string" ? entry : entry?.term),
  ];
  return new Set(names.filter(Boolean).flatMap((name) => String(name).split(/\s+/u).map(bare)));
}

function pronunciationFindings(bible) {
  const pronounced = new Set((bible.pronunciations ?? []).map((entry) => String(entry?.term ?? "").toLocaleLowerCase("en-US")));
  return (bible.signature?.lexicon ?? [])
    .filter((entry) => entry && typeof entry === "object" && entry.foreign === true)
    .filter((entry) => !pronounced.has(String(entry.term ?? "").toLocaleLowerCase("en-US")))
    .map((entry) => ({ severity: "warning", rule: "foreign-pronunciation", path: null, message: `${entry.term} is marked foreign in the story-bible lexicon but has no pronunciation` }));
}

function fictionFindings(parsed, bible, { serialInProgress = false } = {}) {
  if (bible?.type !== "StoryBible" || bible.version !== 1) {
    return [{ severity: "error", rule: "story-bible", path: null, message: "the fiction profile needs a StoryBible version 1 record (ebook.json storyBible)" }];
  }
  const findings = [];
  findings.push(...pronunciationFindings(bible));
  const characters = new Map((bible.signature?.characters ?? []).map((c) => [c.id, c]));
  const arc = bible.arc ?? [];
  const secrets = new Map((bible.knowledge ?? []).map((s) => [s.id, []]));
  const refusals = (bible.refusals ?? []).map((r) => ({ ...r, regex: new RegExp(r.pattern, r.flags ?? "iu") }));
  const retired = (bible.retired ?? []).map((name) => ({ name, regex: new RegExp(`\\b${name}\\b`, "u") }));
  const known = knownNames(bible);
  const unknown = new Map();
  const numbered = parsed.filter((chapter) => chapter.numbered);
  let previous = null;
  for (const chapter of parsed) {
    const { path, frontmatter } = chapter;
    const text = prose(chapter.blocks);
    for (const refusal of refusals) {
      const match = text.match(refusal.regex);
      if (match) findings.push({ severity: "error", rule: "refusal", path, message: `${refusal.id}: "${match[0]}" (${refusal.reason})` });
    }
    for (const { name, regex } of retired) if (regex.test(text)) findings.push({ severity: "error", rule: "retired-name", path, message: `${name} is a retired name` });
    // Within each paragraph: a paragraph break is a sentence break.
    for (const match of paragraphs(chapter.blocks).flatMap((paragraph) => [...paragraph.matchAll(MID_SENTENCE_NAME)])) {
      for (const word of match[0].split(/\s+/u)) {
        if (bare(word) && !knownTo(known, bare(word))) unknown.set(bare(word), unknown.get(bare(word)) ?? path);
      }
    }
    if (!chapter.numbered) continue;
    const { pov, when, beat } = frontmatter;
    if (!characters.get(pov)?.pov) findings.push({ severity: "error", rule: "pov", path, message: `pov ${pov ?? "(none)"} is not a point-of-view character in the story bible` });
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(when ?? ""))) findings.push({ severity: "error", rule: "when", path, message: "a chapter needs an in-story date, when: YYYY-MM-DD" });
    if (!arc.includes(beat)) findings.push({ severity: "error", rule: "beat", path, message: `beat ${beat ?? "(none)"} is not in the story bible's arc` });
    for (const id of frontmatter.reveals ?? []) {
      if (!secrets.has(id)) findings.push({ severity: "error", rule: "knowledge", path, message: `reveals ${id}, which the story bible does not keep` });
      else secrets.get(id).push(path);
    }
    if (previous) {
      if (!frontmatter.flashback && String(when) < String(previous.frontmatter.when)) findings.push({ severity: "error", rule: "chronology", path, message: `${when} comes before the previous chapter's ${previous.frontmatter.when}; mark a flashback` });
      if (arc.indexOf(beat) < arc.indexOf(previous.frontmatter.beat)) findings.push({ severity: "error", rule: "arc-order", path, message: `beat ${beat} comes before the previous chapter's ${previous.frontmatter.beat} in the arc` });
      if (bible.locales?.povAlternates && pov === previous.frontmatter.pov) findings.push({ severity: "warning", rule: "pov-alternation", path, message: `two chapters in a row from ${pov}'s point of view` });
    }
    previous = chapter;
  }
  const last = numbered.at(-1);
  if (last && arc.length && last.frontmatter.beat !== arc.at(-1)) findings.push({ severity: serialInProgress ? "warning" : "error", rule: "arc-termination", path: last.path, message: `the last chapter's beat is ${last.frontmatter.beat}, not the arc's end, ${arc.at(-1)}` });
  for (const [id, paths] of secrets) {
    if (paths.length !== 1) findings.push({ severity: serialInProgress && paths.length === 0 ? "warning" : "error", rule: "knowledge", path: paths[1] ?? null, message: `secret ${id} is revealed ${paths.length} times; it must be revealed exactly once` });
  }
  for (const [word, path] of unknown) findings.push({ severity: "warning", rule: "unknown-name", path, message: `${word} is capitalized mid-sentence but the story bible does not know it` });
  return findings;
}

function studyGuideFindings(path, blocks, body) {
  const heading = blocks.find((block) => block.kind === "heading" && block.level === 1)?.text ?? "";
  const unnumbered = UNNUMBERED.test(heading);
  if (unnumbered) {
    // The front matter carries the independence notice.
    return /^00-/u.test(path.split("/").pop()) && !INDEPENDENCE.test(body)
      ? [{ severity: "error", rule: "independence-notice", path, message: "a study companion's front matter must say it is independent of, and not endorsed by, the credential's owner" }]
      : [];
  }
  const findings = [];
  for (const required of ["what you will be able to do", "check yourself", "answers"]) {
    if (sectionBlocks(blocks, required) === null) findings.push({ severity: "error", rule: "study-guide-section", path, message: `a study-guide chapter needs a "${required}" section` });
  }
  const questions = countItems(sectionBlocks(blocks, "check yourself"));
  const answers = countItems(sectionBlocks(blocks, "answers"));
  if (questions === 0) findings.push({ severity: "error", rule: "study-guide-questions", path, message: "\"Check yourself\" needs a numbered list of questions" });
  else if (answers < questions) findings.push({ severity: "error", rule: "study-guide-answers", path, message: `${questions} questions but ${answers} answers` });
  return findings;
}

/**
 * @param {{path: string, text: string}[]} chapters the manuscript's chapter files in book order
 * @param {{minWords?: number, maxWords?: number, profile?: ("book"|"study-guide"|"fiction"), storyBible?: object, serialInProgress?: boolean}} [options] chapter length bounds (default 400 to 4000), the manuscript's profile, and, for fiction, its StoryBible record; serialInProgress softens only unfinished-end findings
 * @returns {{ok: boolean, words: number, chapters: object[], findings: object[]}}
 */
export function lintManuscript(chapters, { minWords = 400, maxWords = 4000, profile = "book", storyBible, serialInProgress = false } = {}) {
  const findings = [];
  const parsed = [];
  const defined = new Map();
  const cited = new Set();
  const summaries = [];
  for (const { path, text } of chapters) {
    const { frontmatter, body } = readMarkdownFrontmatter(text, { absentFrontmatter: "empty" });
    for (const [id, reference] of Object.entries(frontmatter.references ?? {})) {
      defined.set(id, path);
      const names = [...(reference?.author ?? []), ...(reference?.editor ?? [])];
      if (names.some((name) => /^et\.? al\.?$/iu.test(String(name?.literal ?? "").trim()))) {
        findings.push({ severity: "error", rule: "et-al-author", path, message: `${id} lists "et al." as an author; list the authors and let the citation style abbreviate` });
      }
    }
    const blocks = projectMarkdownBlocks(body);
    const headings = blocks.filter((block) => block.kind === "heading" && block.level === 1);
    if (headings.length !== 1) findings.push({ severity: "error", rule: "one-chapter-heading", path, message: `found ${headings.length} top-level headings; a chapter file has exactly one` });
    for (const match of body.matchAll(CITATION)) for (const key of match[0].matchAll(CITATION_KEYS)) cited.add(key[1]);
    const figureBlocks = profile === "study-guide" ? blocksOutside(blocks, INVENTED_NUMBERS) : blocks;
    const figureParagraphs = new Set(paragraphs(figureBlocks));
    const numbered = headings.length === 1 && !UNNUMBERED.test(headings[0].text);
    parsed.push({ path, frontmatter, blocks, numbered });
    for (const paragraph of profile === "fiction" ? [] : paragraphs(blocks)) {
      // Inline code (a formula such as `=B2/$C$1`) is not a figure.
      if (figureParagraphs.has(paragraph) && FIGURE.test(paragraph.replace(/`[^`]*`/gu, "")) && !CITATION.test(paragraph)) findings.push({ severity: "warning", rule: "figure-without-citation", path, message: paragraph.slice(0, 120) });
      CITATION.lastIndex = 0;
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/u)) {
        if (PROPHECY.test(sentence)) findings.push({ severity: "warning", rule: "prophecy", path, message: sentence.slice(0, 160) });
      }
    }
    if (profile === "study-guide") findings.push(...studyGuideFindings(path, blocks, body));
    const count = words(body);
    // Front and back matter (a copyright page, an epigraph, a glossary) is as long as it needs to be.
    if (numbered && (count < minWords || count > maxWords)) findings.push({ severity: "warning", rule: "chapter-length", path, message: `${count} words, outside ${minWords}–${maxWords}` });
    summaries.push({ path, words: count, title: headings[0]?.text ?? null });
  }
  if (profile === "fiction") findings.push(...fictionFindings(parsed, storyBible, { serialInProgress }));
  for (const key of cited) {
    if (!defined.has(key)) findings.push({ severity: "error", rule: "undefined-citation", path: null, message: `@${key} is cited but no chapter's references define it` });
  }
  for (const [key, path] of defined) {
    if (!cited.has(key)) findings.push({ severity: "warning", rule: "uncited-reference", path, message: `${key} is defined but never cited` });
  }
  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    words: summaries.reduce((sum, chapter) => sum + chapter.words, 0),
    chapters: summaries,
    findings,
  };
}
