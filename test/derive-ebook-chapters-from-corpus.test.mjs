import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { deriveSetOfChaptersFromCorpus } from "../scripts/derive-ebook-chapters-from-corpus.mjs";

test("chapter derivation lists admitted notes without changing its source vault", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "ebook-corpus-chapters-"));
  t.after(() => rm(workspace, { force: true, recursive: true }));
  const root = join(workspace, "science-section");
  const notePath = "content/text/documents/articles/notes";
  const notes = Array.from({ length: 23 }, (_, index) => [
    notePath + "/note-" + String(index).padStart(2, "0") + ".md",
    "---\ntitle: A source note\n---\n\nOriginal source.\n",
  ]);
  const nested = "services/child/" + notePath + "/subject.md";
  const records = new Map([
    ...notes,
    [nested, "# Nested source\n"],
    [notePath + "/recovered/history/received.md", "# Restored canonical note\n"],
    [notePath + "/malformed.md", "---\ntitle: [unclosed\n---\n\nNo.\n"],
    [notePath + "/note--archive-2024.md", "# Old version\n"],
    ["lib/legacy/" + notePath + "/retired.md", "# Retired\n"],
    ["content/text/documents/articles/essays/beyond.md", "# Different kind of article\n"],
  ]);
  await Promise.all([...records].map(async ([path, text]) => {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, text);
  }));
  const was = (await readdir(root, { recursive: true })).sort();
  const derive = (chaptersDir) => deriveSetOfChaptersFromCorpus({
    title: "Research sources", author: "Fixture",
    parts: [{ title: "Science", roots: [root] }], chaptersDir, carriers: ["notes"],
  });
  const result = await derive(join(workspace, "chapters"));
  assert.equal(result.chapterFiles.length, 2);
  const chapter = await readFile(join(result.chaptersDir, result.chapterFiles[1]), "utf8");
  assert.deepEqual([...chapter.matchAll(/^- `([^\x60]+)`$/gmu)].map((match) => match[1]), notes.slice(0, 20).map(([path]) => path));
  assert.match(chapter, /^- \.\.\.and 5 more$/mu);
  assert.deepEqual((await readdir(root, { recursive: true })).sort(), was);
  for (const [path, text] of records) assert.equal(await readFile(join(root, path), "utf8"), text);
});
