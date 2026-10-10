#!/usr/bin/env node
/**
 * Lint one manuscript before design: reads the chapters an ebook.json names
 * (and, for fiction, the story bible its `storyBible` field names),
 * prints the findings as JSON, and exits non-zero on an error finding.
 *   node scripts/lint-manuscript.mjs <ebook.json> [--serial-in-progress]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { listChapters } from "../src/ebook-production.mjs";
import { lintManuscript } from "../src/lint-manuscript.mjs";

if (import.meta.main) {
  const manifestPath = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) throw new Error("usage: lint-manuscript.mjs <ebook.json> [--serial-in-progress]");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const chapters = listChapters(resolve(dirname(manifestPath), manifest.bookDir ?? ".")).map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const storyBible = manifest.storyBible ? JSON.parse(readFileSync(resolve(dirname(manifestPath), manifest.storyBible), "utf8")) : undefined;
  const result = lintManuscript(chapters, { profile: manifest.profile ?? "book", storyBible, serialInProgress: process.argv.includes("--serial-in-progress") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
