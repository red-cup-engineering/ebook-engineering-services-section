import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fabricateEbookEdition } from "../src/fabricate-ebook-edition.mjs";

export { describeEbookEditionSource, fabricateEbookEdition } from "../src/fabricate-ebook-edition.mjs";

async function main() {
  const [specificationPath, sourcePath] = process.argv.slice(2);
  if (!specificationPath || !sourcePath) {
    throw new Error("usage: fabricate-ebook-edition.mjs <specification.json> <source.json> (trusted Group-controlled manuscripts only)");
  }
  const specification = JSON.parse(readFileSync(resolve(specificationPath), "utf8"));
  const source = JSON.parse(readFileSync(resolve(sourcePath), "utf8"));
  const result = await fabricateEbookEdition(specification, source);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "refused" || result.status === "failed") process.exitCode = 1;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
