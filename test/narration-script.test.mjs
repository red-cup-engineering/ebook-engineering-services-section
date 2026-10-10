import assert from "node:assert/strict";
import test from "node:test";
import { deriveSoundScoreNarrationLayer } from "../src/narration-script.mjs";

const storyBible = {
  type: "StoryBible", version: 1,
  signature: { characters: [{ id: "lee", name: "Lee", pov: true }, { id: "mei", name: "Mei Lin", aliases: ["Mei"] }] },
  voices: { narrator: { id: "narrator" }, pointOfView: { lee: { id: "lee", style: "dry" } }, characters: { mei: { id: "mei-voice", style: "bright" } } },
};

const source = (firstParagraph = "Lee waited. The door stayed shut.") => ({
  slug: "fixture", title: "Fixture", author: "A. Writer", storyBible,
  chapters: [
    { path: "01.md", text: `---\npov: lee\n---\n# Arrival\n\n${firstParagraph}\n\n“Keep the *blue* door.” Mei Lin said.\n\n---\n\nThen Lee left.\n` },
    { path: "02.md", text: "# Home\n\nDone.\n" },
  ],
});

test("narration is a deterministic sentence-addressed sound-score layer", () => {
  const first = deriveSoundScoreNarrationLayer(source());
  assert.deepEqual(first, deriveSoundScoreNarrationLayer(source()));
  assert.equal(first.type, "SoundScoreNarrationLayer");
  const narration = first.chapters[0].events.filter(({ type }) => type === "narrate");
  assert.deepEqual(narration.slice(1, 3).map(({ anchor }) => [anchor.chapter, anchor.paragraph, anchor.sentence]), [["01.md", 1, 0], ["01.md", 1, 1]]);
  assert.match(narration[1].anchor.contentDigest, /^ni:\/\/\/sha-256;/u);
  assert.equal(narration[1].speakerId, "lee");
  assert.equal(narration[1].voice.id, "lee");
  const dialogue = narration.find(({ text }) => text.includes("Keep the blue door"));
  assert.equal(dialogue.speakerId, "mei");
  assert.equal(dialogue.voice.id, "mei-voice");
  assert.equal(dialogue.style, "bright");
  assert.deepEqual(dialogue.markers.map(({ kind }) => kind), ["emphasis", "dialogue"]);
  assert.ok(first.chapters[0].events.some((event) => event.type === "cue" && event.cue === "scene-break" && event.durationSeconds === 2));
  assert.equal(first.chapters[0].events[0].cue, "room-tone");
  assert.match(first.chapters[0].events[0].digest, /^ni:\/\/\/sha-256;/u);
  assert.equal(first.chapters[0].events.some((event) => event.cue === "opening-credit"), true);
  assert.equal(first.chapters[1].events.some((event) => event.cue === "closing-credit"), true);
});

test("editing one paragraph changes only that paragraph's sentence unit identities", () => {
  const before = deriveSoundScoreNarrationLayer(source());
  const after = deriveSoundScoreNarrationLayer(source("Lee listened. The door opened."));
  const units = (layer) => layer.chapters.flatMap(({ events }) => events.filter(({ type }) => type === "narrate"));
  const beforeBySpan = new Map(units(before).map((unit) => [`${unit.anchor.chapter}:${unit.anchor.paragraph}:${unit.anchor.sentence}`, unit]));
  const afterBySpan = new Map(units(after).map((unit) => [`${unit.anchor.chapter}:${unit.anchor.paragraph}:${unit.anchor.sentence}`, unit]));
  for (const [span, prior] of beforeBySpan) {
    const next = afterBySpan.get(span);
    if (span.startsWith("01.md:1:")) {
      assert.notEqual(next.id, prior.id);
      assert.notEqual(next.digest, prior.digest);
    } else {
      assert.equal(next.id, prior.id, span);
      assert.equal(next.digest, prior.digest, span);
    }
  }
});
