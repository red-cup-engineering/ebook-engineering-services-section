#!/usr/bin/env node
/**
 * Validate one edition's EPUB and cover for Kindle, printing the validation
 * SignCell, signed when a key is given. A failing one is printed unsigned
 * with its failing checks named on stderr, and nothing is written. Given the
 * edition's fabrication and editorial acceptance records and --release-out, a
 * passing validation also writes the Kindle release acceptance that the retail
 * channels admit it on.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { acceptKindleRelease, validateKindleEdition, signKindleValidationReceipt } from "../src/kindle-validation.mjs";

const usage = "usage: validate-kindle-edition --book <slug> --epub <file> --cover <file> [--evidence-root <dir>] [--out <receipt.json>] [--private-key <pem> --key-id <id>] [--fabrication <edition.json> --acceptance <acceptance.json> --release-out <release-acceptance.json>]";
const { values } = parseArgs({ options: Object.fromEntries(["book", "epub", "cover", "out", "evidence-root", "private-key", "key-id", "fabrication", "acceptance", "release-out"].map((name) => [name, { type: "string" }])) });
if (!values.book || !values.epub || !values.cover) throw new Error(usage);
const release = ["fabrication", "acceptance", "release-out"].filter((name) => values[name]);
if (release.length && release.length !== 3) throw new Error(`--fabrication, --acceptance and --release-out are required together\n${usage}`);
const cell = await validateKindleEdition({ book: values.book, epubPath: resolve(values.epub), coverPath: resolve(values.cover), ...(values["evidence-root"] ? { evidenceRoot: resolve(values["evidence-root"]) } : {}) });
if ((values["private-key"] || values["key-id"]) && !(values["private-key"] && values["key-id"])) throw new Error("--private-key and --key-id are required together");
if (!cell.content.passed) {
  // A failing cell is printed unsigned and nothing is written: only a passing validation is a receipt.
  const failing = [];
  const walk = (node, path) => { if (!node || typeof node !== "object") return; if (node.passed === false && path) failing.push(path); for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key); };
  walk(cell.content, "");
  process.stdout.write(`${JSON.stringify(cell, null, 2)}\n`);
  process.stderr.write(`Kindle validation failed: ${failing.join(", ") || "see the printed cell"}\n`);
  process.exitCode = 1;
} else {
  const result = values["private-key"] ? signKindleValidationReceipt(cell, await readFile(resolve(values["private-key"]), "utf8"), values["key-id"]) : cell;
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (values.out) await writeFile(resolve(values.out), text, { flag: "wx", mode: 0o600 });
  process.stdout.write(text);
  if (release.length) {
    const json = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));
    const acceptance = acceptKindleRelease({ book: values.book, fabrication: await json(values.fabrication), editorialAcceptance: await json(values.acceptance), validation: cell });
    await writeFile(resolve(values["release-out"]), `${JSON.stringify(acceptance, null, 2)}\n`, { flag: "wx" });
  }
}
