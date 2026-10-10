/**
 * @module produce-set-of-ebooks
 * Collection lift over produceEbook: maps a manifest array through the
 * single-book effect, isolating one bad manifest from the rest of the batch.
 */

import { produceEbook } from "./produce-ebook.mjs";

/**
 * Produce every manifest in a batch, collecting per-manifest failures
 * instead of aborting the whole run.
 * @param {object[]} manifests
 * @returns {Promise<{results: object[], failures: {slug: (string|undefined), error: string}[]}>}
 */
export async function produceSetOfEbooks(manifests) {
  const results = [];
  const failures = [];
  for (const manifest of manifests) {
    try {
      results.push(await produceEbook(manifest));
    } catch (error) {
      failures.push({ slug: manifest?.slug, error: error.message });
    }
  }
  return { results, failures };
}
