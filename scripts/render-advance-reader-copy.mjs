#!/usr/bin/env node
/**
 * Render one advance-reader (or review) copy of a release-accepted EPUB, validate it with the release EPUBCheck
 * profile, and print its AdvanceReaderRendition SignCell. With --prepared-for and --grant the copy is stamped for
 * one reader; the record carries the grant, never the name. Refuses EPUB bytes the acceptance does not name.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { renderAdvanceReaderCopy } from "../src/advance-reader-rendition.mjs";
import { validateEpub } from "../src/kindle-validation.mjs";

const usage = "usage: render-advance-reader-copy --book <slug> --epub <accepted.epub> --release-acceptance <json> --on-sale <YYYY-MM-DD> --status advance|review --contact <text> --out <copy.epub> [--uncorrected] [--prepared-for <name> --grant <id>] [--record-out <json>] [--evidence-root <dir>]";
const { values } = parseArgs({ options: { ...Object.fromEntries(["book", "epub", "release-acceptance", "on-sale", "status", "contact", "out", "prepared-for", "grant", "record-out", "evidence-root"].map((name) => [name, { type: "string" }])), uncorrected: { type: "boolean", default: false } } });
for (const name of ["book", "epub", "release-acceptance", "on-sale", "status", "contact", "out"]) if (!values[name]) throw new Error(`--${name} is required\n${usage}`);
if (Boolean(values["prepared-for"]) !== Boolean(values.grant)) throw new Error(`--prepared-for and --grant are required together\n${usage}`);
const cell = await renderAdvanceReaderCopy({
  book: values.book, acceptedEpub: resolve(values.epub), outPath: resolve(values.out),
  releaseAcceptance: JSON.parse(await readFile(resolve(values["release-acceptance"]), "utf8")),
  notice: { status: values.status, onSale: values["on-sale"], contact: values.contact, uncorrected: values.uncorrected },
  stamp: values.grant ? { preparedFor: values["prepared-for"], grant: values.grant } : null,
}, { validate: (path) => validateEpub(path, values["evidence-root"] ? { evidenceRoot: resolve(values["evidence-root"]) } : {}) });
const text = `${JSON.stringify(cell, null, 2)}\n`;
if (values["record-out"]) await writeFile(resolve(values["record-out"]), text, { flag: "wx" });
process.stdout.write(text);
