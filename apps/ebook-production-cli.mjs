#!/usr/bin/env node
/**
 * @module ebook-production-cli
 * The composed face: single-manifest or directory-batch ebook production
 * from the command line, printing the resulting build record(s) as JSON.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { produceEbook } from "../scripts/produce-ebook.mjs";
import { produceSetOfEbooks } from "../scripts/produce-set-of-ebooks.mjs";

const HELP = `usage: ebook-production-cli --manifest <path.json>
       ebook-production-cli --manifest <dir-of-manifest.json>
       ebook-production-cli --help

--manifest <path>  a single manifest JSON file, or a directory of them
                   (batch mode: every *.json file in the directory)
--help             print this message
`;

/**
 * @param {string} dirPath
 * @returns {object[]} parsed manifest objects from every *.json file, sorted by filename
 */
export function readManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const key of ["bookDir", "distDir", "template", "css", "tokens", "coverArt"]) {
    if (manifest[key]) manifest[key] = resolve(dirname(resolve(manifestPath)), manifest[key]);
  }
  if (Array.isArray(manifest.assets)) manifest.assets = manifest.assets.map((asset) => ({ ...asset, path: resolve(dirname(resolve(manifestPath)), asset.path) }));
  return manifest;
}

function readManifestDirectory(dirPath) {
  return readdirSync(dirPath)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readManifest(join(dirPath, name)));
}

/**
 * Parse argv into a CLI action.
 * @param {string[]} argv
 * @returns {{help: boolean, manifestPath: (string|undefined)}}
 */
export function parseArgs(argv) {
  const help = argv.includes("--help") || argv.includes("-h");
  const flagIndex = argv.indexOf("--manifest");
  const manifestPath = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  return { help, manifestPath };
}

async function main() {
  const { help, manifestPath } = parseArgs(process.argv.slice(2));
  if (help || !manifestPath) {
    console.log(HELP);
    process.exitCode = help ? 0 : 1;
    return;
  }

  const resolved = resolve(manifestPath);
  const isDirectory = statSync(resolved).isDirectory();

  if (isDirectory) {
    const manifests = readManifestDirectory(resolved);
    const { results, failures } = await produceSetOfEbooks(manifests);
    console.log(JSON.stringify({ results, failures }, null, 2));
    process.exitCode = failures.length > 0 ? 1 : 0;
    return;
  }

  const manifest = readManifest(resolved);
  try {
    const record = await produceEbook(manifest);
    console.log(JSON.stringify(record, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
