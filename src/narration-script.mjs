/** Pure projection of an ordered Markdown manuscript into a sound-score narration layer. */
import { createHash } from "node:crypto";
import { readMarkdownFrontmatter } from "@red-cup-engineering/read-markdown-frontmatter-service";

const digest = (value) => `ni:///sha-256;${createHash("sha256").update(value).digest("base64url")}`;
const canonical = (value) => JSON.stringify(value);

function marks(markup) {
  const found = [];
  for (const match of markup.matchAll(/(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/gu)) found.push({ kind: "emphasis", text: match[1] ?? match[2] });
  for (const match of markup.matchAll(/[“"]([^”"\n]+)[”"]/gu)) found.push({ kind: "dialogue", text: match[1] });
  return found;
}

function spoken(markup) {
  return markup
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/gu, (_, a, b) => a ?? b)
    .replace(/[*_`]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function sentences(text) {
  if (!text) return [];
  return text.split(/(?<=[.!?…][”"']?)\s+(?=[“"']?[\p{Lu}\p{N}])/u).map((value) => value.trim()).filter(Boolean);
}

function manuscriptBlocks(body) {
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", markup: paragraph.join(" ").trim() });
    paragraph = [];
  };
  for (const line of body.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (/^---+$/u.test(trimmed)) { flush(); blocks.push({ kind: "scene-break" }); continue; }
    if (/^#\s+/u.test(trimmed)) { flush(); blocks.push({ kind: "title", markup: trimmed.replace(/^#\s+/u, "").replace(/\s*\{[^}]*\}\s*$/u, "") }); continue; }
    if (/^#{2,}\s+/u.test(trimmed)) { flush(); blocks.push({ kind: "heading", markup: trimmed.replace(/^#{2,}\s+/u, "") }); continue; }
    paragraph.push(trimmed.replace(/^>\s?/u, ""));
  }
  flush();
  return blocks;
}

function characters(storyBible) {
  return (storyBible?.signature?.characters ?? storyBible?.characters ?? []).map((character) => ({ ...character, names: [character.name, ...(character.aliases ?? [])].filter(Boolean) }));
}

const speechVerb = "(?:said|says|asked|asks|replied|replies|answered|answers|called|calls|whispered|whispers|shouted|shouts|murmured|murmurs|told|tells|added|adds|cried|cries)";
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function taggedSpeaker(sentenceIndex, allSentences, storyBible) {
  if (!/[“"][^”"\n]+[”"]/u.test(allSentences[sentenceIndex])) return null;
  const neighborhood = [allSentences[sentenceIndex], allSentences[sentenceIndex - 1], allSentences[sentenceIndex + 1]].filter(Boolean);
  for (const sentence of neighborhood) {
    for (const character of characters(storyBible)) {
      for (const name of character.names.sort((a, b) => b.length - a.length)) {
        const named = escapeRegex(name);
        if (new RegExp(`(?:${named}).{0,48}${speechVerb}|${speechVerb}.{0,48}(?:${named})`, "iu").test(sentence)) return character;
      }
    }
  }
  return null;
}

function voiceForSpeaker(speakerId, pointOfView, storyBible) {
  const configured = storyBible?.voices ?? {};
  return configured.characters?.[speakerId]
    ?? configured.character?.[speakerId]
    ?? configured.pointOfView?.[speakerId]
    ?? (speakerId === pointOfView ? configured.pointOfView?.[pointOfView] : null)
    ?? configured.narrator
    ?? { id: "default" };
}

function narratedEvent({ chapterPath, paragraphIndex, sentenceIndex, kind, text, markup, speakerId, voice, style }) {
  const anchor = Object.freeze({ chapter: chapterPath, paragraph: paragraphIndex, sentence: sentenceIndex, contentDigest: digest(text) });
  const id = digest(canonical(anchor));
  return Object.freeze({ type: "narrate", id, digest: digest(canonical({ anchor, speakerId, voice, style, text })), anchor, kind, text, markup, markers: marks(markup), speakerId, voice, style });
}

const cue = (kind, durationSeconds, fields = {}) => {
  const value = { type: "cue", cue: kind, durationSeconds, ...fields };
  const identity = digest(canonical(value));
  return Object.freeze({ ...value, id: identity, digest: identity });
};

/**
 * Derive the narration layer consumed by the sound-score grammar. Provider request
 * limits deliberately do not enter this derivation; renderers group these stable
 * sentence primitives when dispatching synthesis.
 *
 * @param {{slug:string,title:string,author:string,chapters:{path:string,text:string}[],storyBible?:object,language?:string}} source
 */
export function deriveSoundScoreNarrationLayer({ slug, title, author, chapters, storyBible, language = "en-US" }) {
  if (!slug || !title || !author || !Array.isArray(chapters) || chapters.length === 0) throw new TypeError("a narration layer needs slug, title, author, and ordered chapters");
  const disclosure = "This audiobook is narrated by a synthesized voice.";
  // Matter made for the page (a recipe, a glossary, a reading guide) says narrate: false.
  const narrated = chapters.filter((chapter) => readMarkdownFrontmatter(chapter.text, { absentFrontmatter: "empty" }).frontmatter.narrate !== false);
  const projected = narrated.map((chapter, chapterIndex) => {
    const { frontmatter, body } = readMarkdownFrontmatter(chapter.text, { absentFrontmatter: "empty" });
    const pointOfView = frontmatter.pov ?? null;
    const narratorVoice = voiceForSpeaker(pointOfView ?? "narrator", pointOfView, storyBible);
    const blocks = manuscriptBlocks(body);
    const titleBlock = blocks.find((block) => block.kind === "title");
    const events = [cue("room-tone", 0.75, { position: "chapter-head" }), cue("chapter-head", 0, { title: spoken(titleBlock?.markup ?? `Chapter ${chapterIndex + 1}`) })];
    if (chapterIndex === 0) events.push(cue("opening-credit", 0, { text: `${title}, by ${author}. ${disclosure}`, speakerId: pointOfView ?? "narrator", voice: narratorVoice, style: "credit" }));
    let paragraphIndex = 0;
    for (const block of blocks) {
      if (block.kind === "scene-break") { events.push(cue("scene-break", 2)); continue; }
      const parts = sentences(block.markup).map((markup) => ({ markup, text: spoken(markup) }));
      const spokenSentences = parts.map(({ text }) => text);
      for (let sentenceIndex = 0; sentenceIndex < parts.length; sentenceIndex++) {
        const character = taggedSpeaker(sentenceIndex, spokenSentences, storyBible);
        const speakerId = character?.id ?? pointOfView ?? "narrator";
        const voice = voiceForSpeaker(speakerId, pointOfView, storyBible);
        events.push(narratedEvent({ chapterPath: chapter.path, paragraphIndex, sentenceIndex, kind: block.kind === "title" ? "chapter-title" : block.kind, text: parts[sentenceIndex].text, markup: parts[sentenceIndex].markup, speakerId, voice, style: character ? (voice.style ?? "dialogue") : (voice.style ?? "narration") }));
      }
      paragraphIndex++;
    }
    if (chapterIndex === narrated.length - 1) events.push(cue("closing-credit", 0, { text: `You have been listening to ${title}, by ${author}. ${disclosure}`, speakerId: pointOfView ?? "narrator", voice: narratorVoice, style: "credit" }));
    events.push(cue("room-tone", 2, { position: "chapter-tail" }));
    return Object.freeze({ index: chapterIndex + 1, path: chapter.path, title: spoken(titleBlock?.markup ?? `Chapter ${chapterIndex + 1}`), pointOfView, events: Object.freeze(events) });
  });
  const value = { type: "SoundScoreNarrationLayer", version: 1, slug, title, author, language, disclosure, chapters: Object.freeze(projected) };
  return Object.freeze({ ...value, digest: digest(canonical(value)) });
}

/** Compatibility name for consumers migrating from the former narration script. */
export const deriveNarrationScript = deriveSoundScoreNarrationLayer;
