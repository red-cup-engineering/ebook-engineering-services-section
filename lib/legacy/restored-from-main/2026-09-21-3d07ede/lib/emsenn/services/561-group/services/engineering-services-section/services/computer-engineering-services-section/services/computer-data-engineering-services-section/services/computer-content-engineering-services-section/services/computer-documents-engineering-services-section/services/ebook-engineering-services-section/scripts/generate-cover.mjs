/**
 * @module generate-cover
 * Thin file-writing wrapper over @red-cup-engineering/image-generation-inference-team's
 * public src face (generateImageWithFallback + buildProvenance): the
 * package's own file-writing script is not in its public exports map, so
 * this section writes its own equivalent against the exported functions.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  generateImageWithFallback,
  buildProvenance,
  DEFAULT_PROVIDERS,
} from "@red-cup-engineering/image-generation-inference-team";
import { sha256Buffer } from "../src/ebook-production.mjs";

/**
 * Generate a cover PNG for a book and write it, plus its provenance
 * sidecar, into distDir.
 * @param {string} prompt
 * @param {{
 *   distDir: string,
 *   slug: string,
 *   targetWidth?: number,
 *   providers?: Array<Function>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => string,
 * }} opts
 * @returns {Promise<{path: string, bytes: number, sha256: string, provenance: object}>}
 * @throws {Error} when distDir or slug is missing, or every provider fails
 */
export async function generateCover(
  prompt,
  { distDir, slug, targetWidth, providers = DEFAULT_PROVIDERS, fetchImpl, now = () => new Date().toISOString() }
) {
  if (!distDir) throw new Error("generateCover requires distDir");
  if (!slug) throw new Error("generateCover requires slug");

  const generated = await generateImageWithFallback(prompt, { providers, fetchImpl, targetWidth });

  await mkdir(distDir, { recursive: true });
  const coverPath = join(distDir, `${slug}-cover.png`);
  await writeFile(coverPath, generated.buffer);

  const provenance = buildProvenance({
    provider: generated.provider,
    model: generated.model,
    promptUsed: prompt,
    generatedAt: now(),
    sourceWidthPx: generated.sourceWidthPx,
    targetWidthPx: generated.targetWidthPx,
    upscaled: generated.upscaled,
    upscaleNote: generated.upscaleNote,
    outputPath: coverPath,
  });
  const provenancePath = join(distDir, `${slug}-cover.provenance.json`);
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2), "utf8");

  return {
    path: coverPath,
    bytes: generated.buffer.length,
    sha256: sha256Buffer(generated.buffer),
    provenance,
  };
}
