/**
 * @module derive-ebook-chapters-from-corpus
 * Reads named section roots off the live corpus through the house
 * Markdown and vault-bundling readers, and writes one
 * ordered chapters directory of frontmatter-carrying Markdown plus a
 * partial ebook-production manifest. Never authors chapter prose by hand:
 * every fact in a chapter comes from a carrier this operation reads
 * (README, package.json, a seated character record, a scripts/apps
 * listing, a notes listing, glossary counts, a data/records listing).
 */
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { validateJsonSchema } from "@red-cup-engineering/json-schema-services-section/validation";
import { readMarkdownFile } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-file";
import { bundleMarkdownVaultCarriers } from "@red-cup-engineering/markdown-vault-bundle-services-section";
import { walkPosixPaths } from "@red-cup-engineering/computer-filepath-engineering-services-section/walk-posix-paths";
import { readFileText } from "@red-cup-engineering/computer-file-engineering-services-section/read-file";
import { writeMarkdownFile } from "@red-cup-engineering/markdown-engineering-services-section/write-markdown-file";
import { slugify } from "@red-cup-engineering/computer-text-content-engineering-services-section/slugify-text";

const CARRIER_KINDS = Object.freeze(["readme", "package", "characters", "code", "notes", "glossary", "data"]);
const SERVICES_PRUNE = /^services\/[^/]+\/./;

/** JSON Schema for deriveSetOfChaptersFromCorpus's input parameter object. */
const INPUT_SCHEMA = Object.freeze({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["parts", "title", "author", "chaptersDir"],
  properties: {
    roots: {
      type: "array",
      items: { type: "string" },
    },
    parts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["title", "roots"],
        properties: {
          title: { type: "string", minLength: 1 },
          roots: { type: "array", minItems: 1, items: { type: "string" } },
        },
      },
    },
    carriers: {
      type: "array",
      items: { type: "string", enum: [...CARRIER_KINDS] },
    },
    ordering: { type: "string", enum: ["as-given"] },
    style: { type: "object" },
    title: { type: "string", minLength: 1 },
    subtitle: { type: "string" },
    author: { type: "string", minLength: 1 },
    chaptersDir: { type: "string", minLength: 1 },
    frontMatterNotePaths: { type: "array", items: { type: "string" } },
    appendixNotePaths: { type: "array", items: { type: "string" } },
  },
});

/** JSON Schema for deriveSetOfChaptersFromCorpus's return value. */
const OUTPUT_SCHEMA = Object.freeze({
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["type", "chaptersDir", "chapterFiles", "manifest"],
  properties: {
    type: { type: "string", enum: ["DerivedChapterSet"] },
    version: { type: "integer" },
    chaptersDir: { type: "string" },
    chapterFiles: { type: "array", items: { type: "string" } },
    manifest: {
      type: "object",
      required: ["slug", "title", "author", "bookDir"],
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        subtitle: { type: "string" },
        author: { type: "string" },
        bookDir: { type: "string" },
        style: { type: "object" },
      },
    },
  },
});


function humanize(sectionDirName) {
  const stripped = sectionDirName.replace(/-services-section$/, "");
  return stripped
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function inBackticks(name) {
  return "`" + name + "`";
}

async function readOptionalMarkdown(path) {
  try {
    return await readMarkdownFile(path);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFileText(path));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Recursively list a section's own entries (relative POSIX paths, files
 * as-is, directories suffixed "/"), pruning below an immediate child
 * `services/<name>/` directory so a parent section's own form never
 * absorbs a child section's interior -- the same one-topic-per-section
 * boundary of the explicitly selected chapter source.
 * @param {string} sectionRoot - absolute path to one services-section directory
 * @returns {Promise<string[]>} sorted relative entries
 */
async function listSectionEntries(sectionRoot) {
  const directories = [];
  const walk = await walkPosixPaths({
    root: sectionRoot,
    excludes: ["node_modules", ".git", "package-lock.json"],
    inspectEntry: (entry) => {
      if (entry.kind === "directory") directories.push(entry.path + "/");
    },
  });
  const files = walk.files.map((file) => file.path);
  return [...files, ...directories].filter((path) => !SERVICES_PRUNE.test(path)).sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} sectionRoot
 * @returns {Promise<object[]>} parsed character records under lib/agency/characters/*.json, or [] when absent
 */
async function readLeaderCharacters(sectionRoot) {
  const charactersRoot = join(sectionRoot, "lib", "agency", "characters");
  const walk = await walkPosixPaths({ root: charactersRoot, missing: "empty" });
  const characters = [];
  for (const file of walk.files) {
    if (!file.path.endsWith(".json")) continue;
    const record = await readOptionalJson(join(charactersRoot, file.path));
    if (record) characters.push(record);
  }
  return characters;
}

/**
 * @param {string} sectionRoot
 * @returns {Promise<string[]>} sorted relative paths under data/records, or [] when absent
 */
async function listDataRecords(sectionRoot) {
  const recordsRoot = join(sectionRoot, "data", "records");
  const walk = await walkPosixPaths({ root: recordsRoot, missing: "empty" });
  return walk.files.map((file) => file.path).sort();
}

/**
 * List a section's own notes via the house vault bundler's own selection
 * (its manifest.carriers), rather than re-walking the filesystem by hand.
 * @param {string} sectionRoot
 * @returns {Promise<string[]>} sorted relative note paths
 */
async function listNotes(sectionRoot) {
  const bundle = await bundleMarkdownVaultCarriers({ root: sectionRoot, roles: ["articles"] });
  return bundle.manifest.carriers
    .map((carrier) => carrier.path)
    .filter((path) => path.includes("/notes/"))
    .sort();
}

/**
 * Render one section root into chapter Markdown, admitting only the named
 * carrier kinds. Every fact comes from a reader; no prose is authored here
 * beyond section headings and the fixed labels ("Package", "Leader", ...).
 * @param {string} sectionRoot - absolute path to one services-section directory
 * @param {string[]} carriers - which carrier kinds to admit
 * @returns {Promise<{title: string, text: string}>}
 */
async function renderSectionChapter(sectionRoot, carriers) {
  const packageJson = await readOptionalJson(join(sectionRoot, "package.json"));
  const entries = await listSectionEntries(sectionRoot);
  const title = humanize(basename(sectionRoot));
  const lines = ["# " + title, ""];

  if (carriers.includes("readme")) {
    const readme = await readOptionalMarkdown(join(sectionRoot, "README.md"));
    lines.push("## README", "", readme ? readme.trim() : "_(no README present)_", "");
  }

  if (carriers.includes("package")) {
    lines.push("## Package", "");
    if (packageJson !== null) {
      const versions = [...Object.values(packageJson.dependencies ?? {}), ...Object.values(packageJson.devDependencies ?? {})];
      const dependenciesExactPins = versions.every((version) => typeof version === "string" && /^\d/u.test(version));
      lines.push(
        "- name: " + inBackticks(packageJson.name),
        "- version: " + inBackticks(packageJson.version),
        "- dependency pins: " + (dependenciesExactPins ? "exact" : "not exact"),
        "",
      );
    } else {
      lines.push("_(no package.json present)_", "");
    }
  }

  if (carriers.includes("characters")) {
    const characters = await readLeaderCharacters(sectionRoot);
    lines.push("## Leader", "");
    if (characters.length > 0) {
      for (const character of characters) {
        const office = character.office ?? character.role;
        const disposition = typeof character.disposition === "string" ? character.disposition.split(/(?<=[.!?])\s/)[0] : null;
        const detail = office ?? disposition ?? "(no office or disposition recorded)";
        lines.push("- " + (character.name ?? "(unnamed)") + ", " + detail);
      }
      lines.push("");
    } else {
      lines.push("_(no character seated)_", "");
    }
  }

  if (carriers.includes("code")) {
    const scripts = entries.filter((path) => /^scripts\/[^/]+\.(?:mjs|mts)$/u.test(path)).map(inBackticks);
    const apps = entries.filter((path) => /^apps\/[^/]+\.(?:mjs|mts)$/u.test(path)).map(inBackticks);
    lines.push(
      "## Code",
      "",
      "- scripts: " + (scripts.length ? scripts.join(", ") : "(none)"),
      "- apps: " + (apps.length ? apps.join(", ") : "(none)"),
      "",
    );
  }

  if (carriers.includes("glossary")) {
    const count = (kind) => entries.filter((path) => path.startsWith(`content/text/glossary/${kind}/`) && !path.slice(`content/text/glossary/${kind}/`.length).includes("/") && path.endsWith(".md")).length;
    lines.push(
      "## Glossary",
      "",
      "- terms: " + count("terms"),
      "- topics: " + count("topics"),
      "- concepts: " + count("concepts"),
      "",
    );
  }

  if (carriers.includes("notes")) {
    const notes = await listNotes(sectionRoot);
    lines.push("## Notes", "");
    if (notes.length > 0) {
      for (const note of notes.slice(0, 20)) lines.push("- " + inBackticks(note));
      if (notes.length > 20) lines.push("- ...and " + (notes.length - 20) + " more");
      lines.push("");
    } else {
      lines.push("_(no notes present)_", "");
    }
  }

  if (carriers.includes("data")) {
    lines.push("## Data records", "");
    if (entries.includes("data/records/")) {
      const records = await listDataRecords(sectionRoot);
      if (records.length > 0) {
        for (const record of records) lines.push("- " + inBackticks(record));
      } else {
        lines.push("_(records/ present but empty)_");
      }
      lines.push("");
    } else {
      lines.push("_(no dated records present)_", "");
    }
  }

  return { title, text: lines.join("\n").trimEnd() + "\n" };
}

/**
 * Derives one ordered chapters directory from named corpus section roots, plus the partial ebook-production manifest produceEbook consumes.
 * @param {{
 *   roots?: string[],
 *   parts: Array<{title: string, roots: string[]}>,
 *   carriers?: string[],
 *   ordering?: string,
 *   style?: object,
 *   title: string,
 *   subtitle?: string,
 *   author: string,
 *   chaptersDir: string,
 *   frontMatterNotePaths?: string[],
 *   appendixNotePaths?: string[],
 * }} input
 * @returns {Promise<{type: string, version: number, chaptersDir: string, chapterFiles: string[], manifest: object}>}
 * @throws {TypeError} when input fails INPUT_SCHEMA
 * @throws {Error} when the produced output fails OUTPUT_SCHEMA
 */
export async function deriveSetOfChaptersFromCorpus(input) {
  const inputValidation = validateJsonSchema(input, INPUT_SCHEMA);
  if (!inputValidation.valid) {
    const detail = inputValidation.issues.map((item) => item.path + " " + item.keyword + ": " + item.message).join("; ");
    throw new TypeError("deriveSetOfChaptersFromCorpus: invalid input (" + detail + ")");
  }

  const carriers = input.carriers ?? [...CARRIER_KINDS];
  const chaptersDir = input.chaptersDir;
  await mkdir(chaptersDir, { recursive: true });

  const chapterFiles = [];
  let sequence = 0;
  async function writeChapter(slug, text, frontmatterTitle) {
    const filename = String(sequence).padStart(3, "0") + "-" + slug + ".md";
    sequence += 1;
    const escapedTitle = frontmatterTitle.replace(/"/g, '\\"');
    const frontmatter = '---\ntitle: "' + escapedTitle + '"\n---\n\n';
    // "preserve" (not the default "semantic") because a verbatim-embedded
    // note (frontMatterNotePaths/appendixNotePaths) may itself carry a YAML
    // frontmatter block or other line-break-significant content; semantic
    // reflow would join its lines as if they were wrapped prose.
    await writeMarkdownFile({ path: join(chaptersDir, filename), text: frontmatter + text, mode: "upsert", normalization: "preserve" });
    chapterFiles.push(filename);
  }

  if (input.frontMatterNotePaths?.length) {
    const texts = [];
    for (const notePath of input.frontMatterNotePaths) texts.push((await readMarkdownFile(notePath)).trim());
    await writeChapter("front-matter", texts.join("\n\n---\n\n") + "\n", "Front Matter");
  }

  for (const part of input.parts) {
    await writeChapter(slugify(part.title) + "-part-title", "# Part: " + part.title + "\n", part.title);
    for (const root of part.roots) {
      const chapter = await renderSectionChapter(root, carriers);
      await writeChapter(slugify(chapter.title), chapter.text, chapter.title);
    }
  }

  if (input.appendixNotePaths?.length) {
    const texts = [];
    for (const notePath of input.appendixNotePaths) texts.push((await readMarkdownFile(notePath)).trim());
    await writeChapter("appendix", texts.join("\n\n---\n\n") + "\n", "Appendix");
  }

  const manifest = {
    slug: slugify(input.title),
    title: input.title,
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    author: input.author,
    bookDir: chaptersDir,
    ...(input.style ? { style: input.style } : {}),
  };

  const output = { type: "DerivedChapterSet", version: 1, chaptersDir, chapterFiles, manifest };
  const outputValidation = validateJsonSchema(output, OUTPUT_SCHEMA);
  if (!outputValidation.valid) {
    const detail = outputValidation.issues.map((item) => item.path + " " + item.keyword + ": " + item.message).join("; ");
    throw new Error("deriveSetOfChaptersFromCorpus: produced output failed its own schema (" + detail + ")");
  }
  return output;
}

deriveSetOfChaptersFromCorpus.inputSchema = INPUT_SCHEMA;
deriveSetOfChaptersFromCorpus.outputSchema = OUTPUT_SCHEMA;

export const operation = Object.freeze({ name: "derive-ebook-chapters-from-corpus", description: "Derives one ordered chapters directory from named corpus section roots, plus the partial ebook-production manifest produceEbook consumes.", operation: deriveSetOfChaptersFromCorpus });
