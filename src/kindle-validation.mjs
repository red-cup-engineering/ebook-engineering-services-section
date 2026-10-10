import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, sign as signBytes, verify as verifyBytes } from "node:crypto";
import { basename, dirname, join, posix, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defineSchemaType } from "@red-cup-engineering/computer-data-engineering-services-section/type-system/schema-type";
import { createTypedMark } from "@red-cup-engineering/signcell/typed-mark";

const MAX_COVER_BYTES = 50 * 1024 * 1024;
const IDEAL_WIDTH = 1600;
const IDEAL_HEIGHT = 2560;
const IDEAL_RATIO = 1.6;

export const EPUB_VALIDATOR_PROFILES = Object.freeze({
  release: Object.freeze({ id: "epub-3.3-epubcheck-5.3.0", standard: "EPUB 3.3", tool: "epubcheck", toolVersion: "5.3.0", warningPolicy: "record", blocking: true }),
  observation: Object.freeze({ id: "epub-3.4-epubcheck-5.4.0", standard: "EPUB 3.4", tool: "epubcheck", toolVersion: "5.4.0", warningPolicy: "record", blocking: false }),
});

export const RETAILER_PORTABILITY_PROFILES = Object.freeze({
  "kindle-reflowable-2026-09": Object.freeze({ scriptedContent: "unsupported", remoteResources: "unsupported", mediaOverlays: "degraded", mathml: "degraded", embeddedFonts: "degraded", svg: "supported", fixedLayout: "unsupported", toc: "supported", landmarks: "supported", pageList: "supported" }),
  "apple-books-2026-09": Object.freeze({ scriptedContent: "supported", remoteResources: "degraded", mediaOverlays: "supported", mathml: "supported", embeddedFonts: "supported", svg: "supported", fixedLayout: "supported", toc: "supported", landmarks: "supported", pageList: "supported" }),
  "google-play-books-2026-09": Object.freeze({ scriptedContent: "unsupported", remoteResources: "degraded", mediaOverlays: "untested", mathml: "unsupported", embeddedFonts: "supported", svg: "supported", fixedLayout: "degraded", toc: "supported", landmarks: "supported", pageList: "supported" }),
  "kobo-writing-life-2026-09": Object.freeze({ scriptedContent: "untested", remoteResources: "degraded", mediaOverlays: "untested", mathml: "untested", embeddedFonts: "supported", svg: "supported", fixedLayout: "degraded", toc: "supported", landmarks: "supported", pageList: "supported" }),
});

export const kindleValidationReceiptType = defineSchemaType({
  $id: "org.561-group.ebook.kindle-validation-receipt.v2",
  title: "Kindle validation receipt",
  description: "Content-addressed evidence that exact EPUB and cover bytes passed the pinned Kindle release gate, with compatibility observations kept separate.",
  type: "object", additionalProperties: false,
  required: ["type", "version", "book", "validatedAt", "validatorProfile", "artifacts", "checks", "passed"],
  properties: {
    type: { const: "KindleValidationReceipt" }, version: { const: 2 }, book: { type: "string", minLength: 1 },
    validatedAt: { type: "string", format: "date-time" }, passed: { type: "boolean" }, validatorProfile: { type: "object" },
    artifacts: { type: "object", additionalProperties: false, required: ["epub", "cover"], properties: { epub: { $ref: "#/$defs/artifact" }, cover: { $ref: "#/$defs/artifact" } } },
    checks: { type: "object", additionalProperties: false, required: ["conformance", "accessibility", "features", "navigation", "portability", "readingSystems", "cover"], properties: {
      conformance: { type: "object" }, accessibility: { type: "object" }, features: { type: "object" }, navigation: { type: "object" }, portability: { type: "object" }, readingSystems: { type: "array" }, cover: { type: "object" },
    } },
  },
  $defs: { artifact: { type: "object", additionalProperties: false, required: ["name", "bytes", "sha256"], properties: { name: { type: "string", minLength: 1 }, bytes: { type: "integer", minimum: 1 }, sha256: { type: "string", pattern: "^[0-9a-f]{64}$" } } } },
});

export const kindleReleaseAcceptanceType = defineSchemaType({
  $id: "org.561-group.ebook.kindle-release-acceptance.v1", title: "Kindle release acceptance",
  description: "The publish gate joining editorial acceptance, pinned EPUB conformance, accessibility evidence, navigation, portability, and exact rendition bytes without claiming retailer deployment.",
  type: "object", additionalProperties: false,
  required: ["type", "version", "status", "book", "editionInputDigest", "rendition", "closedObligationIds", "evidence"],
  properties: {
    type: { const: "KindleReleaseAcceptance" }, version: { const: 1 }, status: { const: "release-ready" }, book: { type: "string" }, editionInputDigest: { type: "string" },
    rendition: { type: "object", additionalProperties: false, required: ["kind", "artifactSha256"], properties: { kind: { const: "EPUB" }, artifactSha256: { type: "string", pattern: "^[0-9a-f]{64}$" } } },
    closedObligationIds: { type: "array", items: { type: "string" } }, evidence: { type: "object" },
  },
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifact = async (path) => { const bytes = await readFile(path); return Object.freeze({ name: basename(path), bytes: bytes.byteLength, sha256: sha256(bytes) }); };
const bounded = (value) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").slice(-16_000);

async function commandExists(command, env = process.env) {
  if (command.includes("/")) { try { await access(command); return true; } catch { return false; } }
  for (const directory of String(env.PATH ?? "").split(":")) {
    if (!directory) continue;
    try { await access(resolve(directory, command)); return true; } catch { /* continue */ }
  }
  return false;
}

function run(command, args, { spawnImpl = spawn, env = process.env, timeoutMs = 120_000 } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawnImpl(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (value, error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolveRun(value); };
    const timer = setTimeout(() => { child.kill?.("SIGKILL"); finish({ status: null, signal: "timeout", stdout: bounded(stdout), stderr: bounded(stderr) }); }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (chunk) => { stdout += chunk; }); child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => finish(null, error)); child.once("close", (status, signal) => finish({ status, signal, stdout: bounded(stdout), stderr: bounded(stderr) }));
  });
}

function epubcheckLocation(profile, env) {
  const key = profile.toolVersion === "5.3.0" ? "EPUBCHECK_5_3_JAR" : "EPUBCHECK_5_4_JAR";
  return env[key] ?? (profile.toolVersion === "5.3.0" ? env.EPUBCHECK_JAR : undefined);
}

/** Locate an EPUBCheck candidate. Its reported version is verified before it can satisfy a profile. */
export async function detectEpubcheck({ profile = EPUB_VALIDATOR_PROFILES.release, env = process.env, exists = commandExists } = {}) {
  const jar = epubcheckLocation(profile, env);
  if (jar && await exists(jar, env) && await exists("java", env)) return Object.freeze({ available: true, command: "java", prefix: ["-jar", resolve(jar)], source: profile.toolVersion === "5.3.0" && !env.EPUBCHECK_5_3_JAR ? "EPUBCHECK_JAR" : `EPUBCHECK_${profile.toolVersion.replaceAll(".", "_")}_JAR` });
  if (profile.toolVersion === "5.3.0" && await exists("epubcheck", env)) return Object.freeze({ available: true, command: "epubcheck", prefix: [], source: "PATH" });
  return Object.freeze({ available: false, source: "none", reason: `Install EPUBCheck ${profile.toolVersion} or configure its versioned jar.` });
}

async function storeJsonEvidence(root, label, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`), digest = sha256(bytes);
  await mkdir(root, { recursive: true }); const name = `${label}-${digest}.json`, path = join(root, name);
  try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); } catch (error) { if (error?.code !== "EEXIST") throw error; }
  return Object.freeze({ name, bytes: bytes.byteLength, sha256: digest });
}

function versionFrom(output) { return String(output).match(/(?:EPUBCheck|v(?:ersion)?\s*)\s*([0-9]+\.[0-9]+\.[0-9]+)/iu)?.[1] ?? null; }
function reportCounts(report) {
  const messages = Array.isArray(report?.messages) ? report.messages : Array.isArray(report?.items) ? report.items : [];
  const severity = (message) => String(message?.severity ?? message?.level ?? message?.type ?? "").toLowerCase();
  return { errors: Number.isInteger(report?.errors) ? report.errors : messages.filter((message) => /fatal|error/u.test(severity(message))).length, warnings: Number.isInteger(report?.warnings) ? report.warnings : messages.filter((message) => /warn/u.test(severity(message))).length };
}

/** Run one immutable validator profile and retain the complete JSON report as a digest-named artifact. */
export async function validateEpub(epubPath, { profile = EPUB_VALIDATOR_PROFILES.release, evidenceRoot = join(dirname(resolve(epubPath)), "validation-evidence"), ...capabilities } = {}) {
  const tool = capabilities.tool ?? await detectEpubcheck({ profile, ...capabilities });
  if (!tool?.available) return Object.freeze({ outcome: "untested", passed: false, profile, tool, obstruction: "epubcheck-unavailable" });
  const runCommand = capabilities.runCommand ?? ((command, args) => run(command, args, capabilities));
  const versionResult = await runCommand(tool.command, [...tool.prefix, "--version"]), observedVersion = capabilities.toolVersion ?? versionFrom(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (versionResult.status !== 0 || observedVersion !== profile.toolVersion) return Object.freeze({ outcome: "refused", passed: false, profile, tool: { ...tool, observedVersion }, obstruction: "validator-version-mismatch", stdout: versionResult.stdout, stderr: versionResult.stderr });
  const scratch = await mkdtemp(join(tmpdir(), "epubcheck-report-"));
  try {
    const reportPath = join(scratch, "report.json"), result = await runCommand(tool.command, [...tool.prefix, resolve(epubPath), "--json", reportPath]);
    let report;
    try { report = JSON.parse(await readFile(reportPath, "utf8")); } catch { report = { type: "EpubcheckProcessReport", version: 1, stdout: result.stdout, stderr: result.stderr, exitStatus: result.status, signal: result.signal }; }
    const counts = reportCounts(report), reportArtifact = await storeJsonEvidence(evidenceRoot, profile.id, report);
    return Object.freeze({ outcome: result.status === 0 ? "pass" : "fail", passed: result.status === 0, profile, tool: { ...tool, observedVersion }, errors: counts.errors, warnings: counts.warnings, report: reportArtifact, exitStatus: result.status, signal: result.signal });
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

async function readZipEntries(epubPath, capabilities = {}) {
  const runCommand = capabilities.runCommand ?? ((command, args) => run(command, args, capabilities));
  if (!(await (capabilities.exists ?? commandExists)("unzip", capabilities.env ?? process.env))) throw new Error("unzip-unavailable");
  const listed = await runCommand("unzip", ["-Z1", resolve(epubPath)]); if (listed.status !== 0) throw new Error("epub-zip-unreadable");
  const names = listed.stdout.split(/\r?\n/u).filter(Boolean), entries = new Map();
  await Promise.all(names.filter((name) => /\.(?:opf|xhtml|html|css|js)$/iu.test(name)).map(async (name) => { const result = await runCommand("unzip", ["-p", resolve(epubPath), name]); if (result.status === 0) entries.set(name, result.stdout); }));
  return { names, entries };
}

// EPUB 3 remote resources are the ones a reading system fetches to render; a hyperlink (<a href>) is not one.
const remoteResource = /\b(?:src|poster|data)=["']https?:|<(?:link|item|image|use)\b[^>]*\bhref=["']https?:|url\(\s*["']?https?:|@import\s+["']https?:/iu;
const relativeEntry = (from, target) => posix.normalize(posix.join(posix.dirname(from), target.split("#")[0]));
function navigationAndFeatures({ names, entries }) {
  const documents = [...entries.entries()].filter(([name]) => /\.(?:xhtml|html)$/iu.test(name)), opf = [...entries.entries()].find(([name]) => /\.opf$/iu.test(name));
  const all = [...entries.values()].join("\n"), navs = documents.filter(([, source]) => /<nav\b/iu.test(source));
  const tocNavs = navs.flatMap(([name, source]) => [...source.matchAll(/<nav\b[^>]*(?:epub:type|role)=["'][^"']*(?:toc|doc-toc)[^"']*["'][^>]*>([\s\S]*?)<\/nav>/giu)].map((match) => ({ name, body: match[1] })));
  const landmarks = navs.flatMap(([name, source]) => [...source.matchAll(/<nav\b[^>]*epub:type=["'][^"']*landmarks[^"']*["'][^>]*>([\s\S]*?)<\/nav>/giu)].map((match) => ({ name, body: match[1] })));
  const pageLists = navs.flatMap(([name, source]) => [...source.matchAll(/<nav\b[^>]*epub:type=["'][^"']*page-list[^"']*["'][^>]*>([\s\S]*?)<\/nav>/giu)].map((match) => ({ name, body: match[1] })));
  const tocTargets = tocNavs.flatMap(({ name, body }) => [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["']/giu)].map((match) => relativeEntry(name, match[1]))), existing = new Set(names), unresolved = tocTargets.filter((target) => !existing.has(target));
  const hierarchyFindings = [];
  for (const [name, source] of documents) { let previous = null; for (const match of source.matchAll(/<h([1-6])\b/giu)) { const level = Number(match[1]); if (previous !== null && level > previous + 1) hierarchyFindings.push({ file: name, from: previous, to: level }); previous = level; } }
  const landmarkText = landmarks.map(({ body }) => body).join("\n"), pageMarkers = /epub:type=["'][^"']*(?:pagebreak|page-list)[^"']*["']/iu.test(all);
  const checks = { exactlyOneToc: tocNavs.length === 1, tocTargetsResolve: unresolved.length === 0, tocOrderAgreesWithReadingOrder: tocTargets.every((target, index) => index === 0 || names.indexOf(target) >= names.indexOf(tocTargets[index - 1])), landmarksPresent: landmarks.length > 0, landmarksIdentifyTocAndBody: /\btoc\b/iu.test(landmarkText) && /bodymatter|body matter|start/iu.test(landmarkText), pageListHasPaginationSource: pageLists.length === 0 || pageMarkers, headingHierarchyConsistent: hierarchyFindings.length === 0 };
  const features = Object.freeze({ type: "EpubFeatureManifest", version: 1, mathml: /<math\b|properties=["'][^"']*mathml/iu.test(all), scriptedContent: /<script\b|\.js(?:[?#"']|$)/iu.test(all), remoteResources: remoteResource.test(all), mediaOverlays: /media-overlay|media:duration/iu.test(all), embeddedFonts: names.some((name) => /\.(?:woff2?|otf|ttf)$/iu.test(name)), svg: /<svg\b|\.svg(?:[?#"']|$)/iu.test(all), fixedLayout: /rendition:layout[^<]*(?:pre-paginated|fixed)/iu.test(opf?.[1] ?? ""), navigation: Object.freeze([...(tocNavs.length ? ["toc"] : []), ...(landmarks.length ? ["landmarks"] : []), ...(pageLists.length ? ["page-list"] : [])]) });
  return Object.freeze({ features, navigation: Object.freeze({ type: "EpubNavigationAssay", version: 1, passed: Object.values(checks).every(Boolean), checks: Object.freeze(checks), findings: Object.freeze({ unresolvedTargets: unresolved, headingHierarchy: hierarchyFindings }) }) });
}

export async function inspectEpub(epubPath, capabilities = {}) {
  try { return navigationAndFeatures(await readZipEntries(epubPath, capabilities)); }
  catch (error) { return Object.freeze({ features: Object.freeze({ type: "EpubFeatureManifest", version: 1, outcome: "untested", obstruction: String(error?.message ?? error) }), navigation: Object.freeze({ type: "EpubNavigationAssay", version: 1, passed: false, outcome: "untested", obstruction: String(error?.message ?? error) }) }); }
}

export function assayRetailerPortability(features) {
  const assays = {};
  for (const [profile, capabilities] of Object.entries(RETAILER_PORTABILITY_PROFILES)) {
    const results = {};
    for (const [feature, channelOutcome] of Object.entries(capabilities)) {
      const present = feature === "toc" ? features.navigation?.includes("toc") : feature === "landmarks" ? features.navigation?.includes("landmarks") : feature === "pageList" ? features.navigation?.includes("page-list") : features[feature];
      results[feature] = present ? channelOutcome : "supported";
    }
    const blocking = Object.entries(results).filter(([, outcome]) => outcome === "unsupported").map(([feature]) => feature);
    assays[profile] = Object.freeze({ profile, features: Object.freeze(results), blocking: Object.freeze(blocking), passed: blocking.length === 0 });
  }
  return Object.freeze(assays);
}

async function accessibilityEvidence(epubPath, evidenceRoot, capabilities = {}) {
  const manual = capabilities.manualAccessibilityAssessment ?? { outcome: "untested", assessmentDigest: null, reason: "No manual accessibility assessment was supplied; no conformance claim is made." }, exists = capabilities.exists ?? commandExists;
  if (!(await exists("ace", capabilities.env ?? process.env))) return Object.freeze({ type: "EpubAccessibilityEvidence", version: 1, target: "EPUB Accessibility 1.1", automated: { outcome: "untested", obstruction: "ace-unavailable" }, manual, conformsTo: null });
  const runCommand = capabilities.runCommand ?? ((command, args) => run(command, args, capabilities)), version = await runCommand("ace", ["--version"]), observedVersion = versionFrom(`${version.stdout}\n${version.stderr}`), scratch = await mkdtemp(join(tmpdir(), "ace-report-"));
  try {
    const result = await runCommand("ace", ["--outdir", scratch, resolve(epubPath)]); let report;
    try { report = JSON.parse(await readFile(join(scratch, "report.json"), "utf8")); } catch { report = { stdout: result.stdout, stderr: result.stderr, exitStatus: result.status }; }
    const reportArtifact = await storeJsonEvidence(evidenceRoot, "ace", report);
    return Object.freeze({ type: "EpubAccessibilityEvidence", version: 1, target: "EPUB Accessibility 1.1", automated: { tool: "ace", toolVersion: observedVersion, report: reportArtifact, outcome: result.status === 0 ? "pass" : "fail" }, manual, conformsTo: manual.outcome === "pass" && result.status === 0 ? "EPUB Accessibility 1.1" : null });
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** Validate the KDP ebook-cover envelope. Unknown metadata is a failure, never a zero. */
export async function validateKindleCover(coverPath, { metadata } = {}) {
  const readMetadata = metadata ?? (async (path) => (await import("sharp")).default(path).metadata()), [info, file] = await Promise.all([readMetadata(resolve(coverPath)), stat(resolve(coverPath))]);
  const width = Number.isInteger(info.width) ? info.width : null, height = Number.isInteger(info.height) ? info.height : null, shortest = width === null || height === null ? null : Math.min(width, height), longest = width === null || height === null ? null : Math.max(width, height), ratio = shortest ? longest / shortest : null;
  const checks = Object.freeze({ dimensionsKnown: width !== null && height !== null, shortestSideAtLeast1600: shortest !== null && shortest >= IDEAL_WIDTH, portrait: width !== null && height !== null && height > width, ratio1Point6: ratio !== null && Math.abs(ratio - IDEAL_RATIO) <= 0.01, rgb: ["srgb", "rgb", "rgb16"].includes(String(info.space).toLowerCase()), jpegOrTiff: ["jpeg", "tiff"].includes(String(info.format).toLowerCase()), under50MiB: file.size <= MAX_COVER_BYTES });
  return Object.freeze({ passed: Object.values(checks).every(Boolean), width, height, ratio, colourSpace: info.space ?? null, format: info.format ?? null, bytes: file.size, ideal: Object.freeze({ width: IDEAL_WIDTH, height: IDEAL_HEIGHT, ratio: IDEAL_RATIO }), checks });
}

function readingSystemEvidence(artifactSha256, validatedAt, supplied = []) {
  const systems = supplied.length ? supplied : [{ system: "Kindle Previewer", systemVersion: null }, { system: "Apple Books", systemVersion: null }, { system: "Thorium Reader", systemVersion: null }, { system: "KDP processed copy", systemVersion: null }].map((system) => ({ ...system, outcome: "untested", findings: [] }));
  return Object.freeze(systems.map((item) => Object.freeze({ type: "ReadingSystemObservation", version: 1, artifactSha256, system: item.system, systemVersion: item.systemVersion ?? null, profile: item.profile ?? null, observedAt: item.observedAt ?? validatedAt, outcome: item.outcome ?? "untested", findings: Object.freeze(item.findings ?? []) })));
}

/** Produce the SignCell used by the publication gate. Compatibility and manual lanes never masquerade as release conformance. */
export async function validateKindleEdition({ book, epubPath, coverPath, evidenceRoot = join(dirname(resolve(epubPath)), "validation-evidence"), validatedAt = new Date().toISOString() }, capabilities = {}) {
  const epubArtifact = await artifact(epubPath), coverArtifact = await artifact(coverPath), inspect = capabilities.inspectEpub ? await capabilities.inspectEpub(epubPath) : await inspectEpub(epubPath, capabilities);
  const [release, observation, accessibility, coverCheck] = await Promise.all([
    validateEpub(epubPath, { ...capabilities, tool: capabilities.releaseTool, profile: EPUB_VALIDATOR_PROFILES.release, evidenceRoot }),
    capabilities.skipObservation === true ? { outcome: "untested", passed: false, profile: EPUB_VALIDATOR_PROFILES.observation, obstruction: "observation-disabled" } : validateEpub(epubPath, { ...capabilities, tool: capabilities.observationTool, profile: EPUB_VALIDATOR_PROFILES.observation, evidenceRoot }),
    accessibilityEvidence(epubPath, evidenceRoot, capabilities), validateKindleCover(coverPath, capabilities),
  ]);
  const portability = assayRetailerPortability(inspect.features), readingSystems = readingSystemEvidence(epubArtifact.sha256, validatedAt, capabilities.readingSystemObservations), passed = release.passed === true && coverCheck.passed === true && inspect.navigation.passed === true && portability["kindle-reflowable-2026-09"].passed === true;
  const content = { type: "KindleValidationReceipt", version: 2, book, validatedAt, validatorProfile: EPUB_VALIDATOR_PROFILES.release, artifacts: { epub: epubArtifact, cover: coverArtifact }, checks: { conformance: { release, observation }, accessibility, features: inspect.features, navigation: inspect.navigation, portability, readingSystems, cover: coverCheck }, passed };
  const admitted = createTypedMark(kindleValidationReceiptType, content); if (!admitted.ok) throw new TypeError(admitted.refusal.message); return admitted.value;
}

function niSha256Hex(value) {
  if (typeof value !== "string" || !value.startsWith("ni:///sha-256;")) return null;
  try { return Buffer.from(value.slice("ni:///sha-256;".length), "base64url").toString("hex"); } catch { return null; }
}

/** Join independently observed obligations into the content-addressed release gate consumed by retailer receivers. */
export function acceptKindleRelease({ book, fabrication, editorialAcceptance, validation }) {
  if (fabrication?.type !== "EbookEditionFabricationResult" || fabrication.status !== "fabricated-awaiting-acceptance") throw new TypeError("Kindle release acceptance requires the fabrication record");
  if (editorialAcceptance?.type !== "EbookEditionAcceptance" || !["accepted", "partially-accepted"].includes(editorialAcceptance.status) || !editorialAcceptance.closedObligationIds?.includes("editorial-proof")) throw new TypeError("Kindle release acceptance requires closed editorial proof");
  if (validation?.type !== kindleValidationReceiptType.id || validation.content?.passed !== true || validation.content?.book !== book) throw new TypeError("Kindle release acceptance requires a passing validation SignCell for this book");
  const built = niSha256Hex(fabrication.artifacts?.epub?.sha256), observed = validation.content.artifacts.epub.sha256;
  if (!built || built !== observed) throw new TypeError("validation evidence names different EPUB bytes from the fabrication");
  const release = validation.content.checks.conformance.release, accessibility = validation.content.checks.accessibility;
  if (release?.profile?.id !== EPUB_VALIDATOR_PROFILES.release.id || release.passed !== true) throw new TypeError("the pinned EPUB 3.3 conformance obligation is not closed");
  if (accessibility?.type !== "EpubAccessibilityEvidence") throw new TypeError("accessibility evidence is absent");
  const content = {
    type: "KindleReleaseAcceptance", version: 1, status: "release-ready", book,
    editionInputDigest: editorialAcceptance.editionInputDigest,
    rendition: { kind: "EPUB", artifactSha256: observed },
    closedObligationIds: ["editorial-proof", "epub-conformance", "accessibility-assessment"],
    evidence: { editorialProof: editorialAcceptance.proof?.digest ?? null, validation: validation.id, conformanceReport: release.report.sha256, accessibilityConformanceClaim: accessibility.conformsTo },
  };
  const admitted = createTypedMark(kindleReleaseAcceptanceType, content); if (!admitted.ok) throw new TypeError(admitted.refusal.message); return admitted.value;
}

/** Attribute an exact SignCell with an Ed25519 key held outside the repository. */
export function signKindleValidationReceipt(cell, privateKey, keyId) {
  if (cell?.type !== kindleValidationReceiptType.id || cell.content?.passed !== true) throw new TypeError("only a passing Kindle validation SignCell can be signed");
  if (typeof keyId !== "string" || !keyId) throw new TypeError("receipt signer keyId is required");
  const signature = signBytes(null, Buffer.from(cell.id), privateKey).toString("base64url");
  return Object.freeze({ type: "SignedSignCell", version: 1, cell, signature: Object.freeze({ algorithm: "Ed25519", keyId, value: signature }) });
}

export function verifyKindleValidationReceipt(envelope, publicKey) {
  const cell = envelope?.cell;
  if (cell?.type !== kindleValidationReceiptType.id || cell.content?.passed !== true || cell.content?.validatorProfile?.id !== EPUB_VALIDATOR_PROFILES.release.id || envelope.signature?.algorithm !== "Ed25519") return false;
  const admitted = createTypedMark(kindleValidationReceiptType, cell.content);
  return admitted.ok && admitted.value.id === cell.id && verifyBytes(null, Buffer.from(cell.id), publicKey, Buffer.from(envelope.signature.value ?? "", "base64url"));
}
