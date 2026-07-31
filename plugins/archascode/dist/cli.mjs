#!/usr/bin/env node

// src/cli.ts
import { spawn as spawn2 } from "node:child_process";
import { realpathSync } from "node:fs";
import { access as access3 } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

// ../../../packages/core/src/render.ts
import { readFile as readFile4, readdir as readdir2 } from "node:fs/promises";
import * as path6 from "node:path";

// ../../../packages/core/src/version.ts
var ARCHASCODE_VERSION = "0.3.2";

// ../../../packages/core/src/client.ts
var CloudRequestError = class extends Error {
  constructor(message, status, problem) {
    super(message);
    this.status = status;
    this.problem = problem;
    this.name = "CloudRequestError";
  }
};
async function postRender(cloudUrl, req, fetcher = fetch, authToken, clientSurface = "core") {
  const url = new URL("/render", cloudUrl);
  const res = await fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-archascode-client": `${clientSurface}/${ARCHASCODE_VERSION}`,
      ...authToken ? { authorization: `Bearer ${authToken}` } : {}
    },
    body: JSON.stringify(req)
  });
  if (!res.ok) {
    const detail = await safeReadText(res);
    const problem = parseProblem(detail);
    const messageDetail = problem ? `${problem.title ?? "problem"} \u2014 ${problem.detail ?? ""}` : detail ? `: ${detail}` : "";
    const message = problem ? `cloud /render returned ${res.status} ${res.statusText}: ${messageDetail}` : `cloud /render returned ${res.status} ${res.statusText}${messageDetail}`;
    throw new CloudRequestError(message, res.status, problem);
  }
  return await res.json();
}
function parseProblem(detail) {
  let parsed;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return void 0;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return void 0;
  }
  const obj = parsed;
  const hasTitle = typeof obj["title"] === "string";
  const hasDetail = typeof obj["detail"] === "string";
  if (!hasTitle && !hasDetail) {
    return void 0;
  }
  const problem = {};
  if (typeof obj["type"] === "string") problem.type = obj["type"];
  if (hasTitle) problem.title = obj["title"];
  if (typeof obj["status"] === "number") problem.status = obj["status"];
  if (hasDetail) problem.detail = obj["detail"];
  return problem;
}
async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

// ../../../packages/core/src/files.ts
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
function assertSafeRelativePath(p) {
  if (!p || p.trim() !== p) {
    throw new Error(`refusing empty/whitespace path: ${JSON.stringify(p)}`);
  }
  if (path.isAbsolute(p)) {
    throw new Error(`refusing absolute path from cloud: ${p}`);
  }
  const normalized = path.normalize(p);
  if (normalized.startsWith("..") || normalized.split(path.sep).includes("..")) {
    throw new Error(`refusing path traversal: ${p}`);
  }
}
async function writeFiles(outDir, files, tombstone = /* @__PURE__ */ new Set()) {
  const written = [];
  const skipped = [];
  const seededOnceEver = [];
  for (const file of files) {
    assertSafeRelativePath(file.path);
    const dest = path.join(outDir, file.path);
    if (file.policy === "once" && await pathExists(dest)) {
      skipped.push(file.path);
      continue;
    }
    if (file.policy === "once-ever" && (tombstone.has(file.path) || await pathExists(dest))) {
      continue;
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, file.content, "utf8");
    written.push(file.path);
    if (file.policy === "once-ever") {
      seededOnceEver.push(file.path);
    }
  }
  return { writtenPaths: written, skippedOncePaths: skipped, seededOnceEverPaths: seededOnceEver };
}
async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
async function deleteFiles(outDir, relPaths) {
  for (const rel of relPaths) {
    if (!rel) continue;
    try {
      assertSafeRelativePath(rel);
    } catch {
      continue;
    }
    const dest = path.join(outDir, rel);
    await rm(dest, { force: true });
  }
}

// ../../../packages/core/src/handoff.ts
import { access as access2, copyFile, mkdir as mkdir2, readFile } from "node:fs/promises";
import * as path2 from "node:path";

// ../../../packages/core/src/handoffMarker.ts
var ENTITY_METHOD_STUB_MARKER = "# archascode: entity-method body stub \u2014 remove this line when you implement";
var CUSTOM_PORT_ADAPTER_STUB_MARKER = "# archascode: custom-port adapter method stub \u2014 remove this line when you implement";
var CUSTOM_UC_WORKFLOW_STUB_MARKER = "# archascode: custom use-case workflow body stub \u2014 remove this line when you implement";
var DOMAIN_SERVICE_BODY_STUB_MARKER = "# archascode: domain-service function body stub \u2014 remove this line when you implement";
var ENTITY_ADAPTER_STUB_MARKER = "# archascode: entity-adapter method body stub \u2014 remove this line when you implement";
var STUB_MARKERS = [
  ENTITY_METHOD_STUB_MARKER,
  CUSTOM_PORT_ADAPTER_STUB_MARKER,
  CUSTOM_UC_WORKFLOW_STUB_MARKER,
  DOMAIN_SERVICE_BODY_STUB_MARKER,
  ENTITY_ADAPTER_STUB_MARKER
];

// ../../../packages/core/src/handoff.ts
function stripOverlayTreePrefix(implTargetFile) {
  const LOCKED_PREFIX = "spec/locked/";
  const SRC_PREFIX = "spec/src/";
  if (implTargetFile.startsWith(LOCKED_PREFIX)) {
    return { rel: implTargetFile.slice(LOCKED_PREFIX.length), hintTree: "locked" };
  }
  if (implTargetFile.startsWith(SRC_PREFIX)) {
    return { rel: implTargetFile.slice(SRC_PREFIX.length), hintTree: "src" };
  }
  return { rel: implTargetFile, hintTree: "src" };
}
async function probeOverlayTree(outDir, rel) {
  const lockedAbs = path2.join(outDir, "spec", "locked", rel);
  if (await pathExists2(lockedAbs)) {
    return { overlayAbs: lockedAbs, resolvedTree: "locked" };
  }
  const srcAbs = path2.join(outDir, "spec", "src", rel);
  if (await pathExists2(srcAbs)) {
    return { overlayAbs: srcAbs, resolvedTree: "src" };
  }
  return { overlayAbs: srcAbs, resolvedTree: null };
}
async function applyOverlay(outDir, handoff, previousContracts) {
  const resolved = [];
  const pending = [];
  const contracts = { ...previousContracts ?? {} };
  const treeInfo = /* @__PURE__ */ new Map();
  for (const item of handoff) {
    assertSafeRelativePath(item.impl_target_file);
    assertSafeRelativePath(item.contract_file);
    const { rel, hintTree } = stripOverlayTreePrefix(item.impl_target_file);
    const { overlayAbs, resolvedTree } = await probeOverlayTree(outDir, rel);
    const targetAbs = path2.join(outDir, item.contract_file);
    const stored = contracts[item.id];
    const overlayExists = resolvedTree !== null;
    treeInfo.set(item.id, { resolvedTree, hintTree, rel });
    if (stored === item.contract_hash && overlayExists) {
      const overlayText = await readFile(overlayAbs, "utf8");
      if (STUB_MARKERS.some((m) => overlayText.includes(m))) {
        delete contracts[item.id];
        pending.push({ item, reason: "stub-marker" });
        continue;
      }
      await mkdir2(path2.dirname(targetAbs), { recursive: true });
      await copyFile(overlayAbs, targetAbs);
      contracts[item.id] = item.contract_hash;
      resolved.push(item);
    } else {
      delete contracts[item.id];
      let reason;
      if (!overlayExists) {
        reason = "no-overlay";
      } else {
        const overlayText = await readFile(overlayAbs, "utf8");
        reason = STUB_MARKERS.some((m) => overlayText.includes(m)) ? "stub-marker" : "hash-drift";
      }
      pending.push({ item, reason });
    }
  }
  return { resolved, pending, contracts, treeInfo };
}
async function pathExists2(p) {
  try {
    await access2(p);
    return true;
  } catch {
    return false;
  }
}

// ../../../packages/core/src/interfaceLock.ts
import { mkdir as mkdir3, readFile as readFile2, writeFile as writeFile2 } from "node:fs/promises";
import * as path3 from "node:path";
var INTERFACES_LOCK_REL_PATH = path3.join("spec", "locked", "interfaces.lock");
async function readInterfaceLock(outDir) {
  const lockPath = path3.join(outDir, INTERFACES_LOCK_REL_PATH);
  let raw;
  try {
    raw = await readFile2(lockPath, "utf8");
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
  return JSON.parse(raw);
}
async function writeInterfaceLock(outDir, map) {
  const lockPath = path3.join(outDir, INTERFACES_LOCK_REL_PATH);
  await mkdir3(path3.dirname(lockPath), { recursive: true });
  await writeFile2(lockPath, JSON.stringify(map, null, 2) + "\n", "utf8");
}
function isNotFound(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

// ../../../packages/core/src/manifest.ts
import { mkdir as mkdir4, readFile as readFile3, writeFile as writeFile3 } from "node:fs/promises";
import * as path4 from "node:path";
var MANIFEST_REL_PATH = path4.join(".archascode", "manifest.json");
async function readManifest(outDir) {
  const manifestPath = path4.join(outDir, MANIFEST_REL_PATH);
  let raw;
  try {
    raw = await readFile3(manifestPath, "utf8");
  } catch (err) {
    if (isNotFound2(err)) return null;
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== 1) {
    throw new Error(
      `unexpected manifest schemaVersion=${parsed.schemaVersion} at ${manifestPath}`
    );
  }
  return parsed;
}
async function writeManifest(outDir, manifest) {
  const manifestPath = path4.join(outDir, MANIFEST_REL_PATH);
  await mkdir4(path4.dirname(manifestPath), { recursive: true });
  await writeFile3(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}
function isNotFound2(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

// ../../../packages/core/src/overlayMove.ts
import { mkdir as mkdir5, readdir, rename, rm as rm2, stat } from "node:fs/promises";
import * as path5 from "node:path";
async function pruneEmptyDirs(root) {
  let entries;
  try {
    entries = await readdir(root);
  } catch (err) {
    if (isNotFound3(err)) return;
    throw err;
  }
  for (const name of entries) {
    const abs = path5.join(root, name);
    let isDir;
    try {
      const s = await stat(abs);
      isDir = s.isDirectory();
    } catch (err) {
      if (isNotFound3(err)) continue;
      throw err;
    }
    if (!isDir) continue;
    await pruneEmptyDirs(abs);
    const remaining = await readdir(abs).catch((e) => {
      if (isNotFound3(e)) return [];
      throw e;
    });
    if (remaining.length === 0) {
      await rm2(abs, { recursive: true, force: true });
    }
  }
}
async function reconcileOverlayTree(outDir, treeInfo) {
  const reports = [];
  for (const [id, info] of treeInfo) {
    if (info.hintTree === "locked" && info.resolvedTree === "src") {
      assertSafeRelativePath(info.rel);
      const srcAbs = path5.join(outDir, "spec", "src", info.rel);
      const destAbs = path5.join(outDir, "spec", "locked", info.rel);
      await mkdir5(path5.dirname(destAbs), { recursive: true });
      await rename(srcAbs, destAbs);
      await pruneEmptyDirs(path5.join(outDir, "spec", "src"));
      reports.push(
        `moved body for hand-off \`${id}\` from spec/src/ \u2192 spec/locked/ to honor \`locked: true\``
      );
    } else if (info.hintTree === "src" && info.resolvedTree === "locked") {
      assertSafeRelativePath(info.rel);
      const srcAbs = path5.join(outDir, "spec", "locked", info.rel);
      const destAbs = path5.join(outDir, "spec", "src", info.rel);
      await mkdir5(path5.dirname(destAbs), { recursive: true });
      await rename(srcAbs, destAbs);
      await pruneEmptyDirs(path5.join(outDir, "spec", "locked"));
      reports.push(
        `moved body for hand-off \`${id}\` from spec/locked/ \u2192 spec/src/ \u2014 \`locked\` is no longer declared`
      );
    }
  }
  return reports;
}
function isNotFound3(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

// ../../../packages/core/src/render.ts
var SPEC_MIGRATIONS_REL_DIR = path6.join(
  "spec",
  "locked",
  "adapter",
  "persistence",
  "sqlserver",
  "schema",
  "migrations"
);
var INFLIGHT_FILENAME = "_inflight.sql";
async function render(opts) {
  const specYaml = await readFile4(opts.specPath, "utf8");
  const previous = await readManifest(opts.outDir);
  const priorMigrations = await readPriorMigrations(opts.outDir);
  const response = await postRender(
    opts.cloudUrl,
    {
      spec_yaml: specYaml,
      prior_migrations: priorMigrations
    },
    opts.fetcher,
    opts.authToken,
    opts.clientSurface
  );
  if (response.errors.length > 0) {
    return { ok: false, errors: response.errors };
  }
  const trackedPaths = response.files.filter((f) => (f.policy ?? "overwrite") === "overwrite").map((f) => f.path);
  const trackedPathSet = new Set(trackedPaths);
  const stalePaths = (previous?.files ?? []).filter(
    (p) => !trackedPathSet.has(p)
  );
  const priorTombstone = new Set(previous?.seededOnceEver ?? []);
  const { writtenPaths, seededOnceEverPaths } = await writeFiles(opts.outDir, response.files, priorTombstone);
  await deleteFiles(opts.outDir, stalePaths);
  const handoffItems = response.handoff ?? [];
  const previousLedger = await readInterfaceLock(opts.outDir);
  const overlay = await applyOverlay(
    opts.outDir,
    handoffItems,
    previousLedger
  );
  if (Object.keys(overlay.contracts).length > 0 || Object.keys(previousLedger).length > 0) {
    await writeInterfaceLock(opts.outDir, overlay.contracts);
  }
  const warnings = [];
  const handoffIdSet = new Set(handoffItems.map((h) => h.id));
  for (const p of overlay.pending) {
    if (p.reason === "hash-drift") {
      warnings.push(
        `warning: hand-off '${p.item.id}' has a stub-free overlay but no matching entry in spec/locked/interfaces.lock \u2014 did you forget to copy the lockfile? Re-run the apply/record flow or copy the prior lock entry to resolve.`
      );
    } else if (p.reason === "no-overlay" && previousLedger[p.item.id] !== void 0) {
      warnings.push(
        `warning: hand-off '${p.item.id}' has a lockfile entry but no overlay file on disk (spec/locked/interfaces.lock may be stale \u2014 the overlay was deleted or moved).`
      );
    }
  }
  const moveReports = await reconcileOverlayTree(opts.outDir, overlay.treeInfo);
  warnings.push(...moveReports);
  for (const item of handoffItems) {
    const info = overlay.treeInfo.get(item.id);
    if (info && info.hintTree === "locked" && info.resolvedTree === null) {
      warnings.push(
        `warning: \`locked: true\` on hand-off \`${item.id}\` but its body exists in neither spec/src/ nor spec/locked/ \u2014 the overlay was never seeded or was deleted.`
      );
    }
  }
  for (const key of Object.keys(previousLedger)) {
    if (!handoffIdSet.has(key)) {
      warnings.push(
        `warning: lockfile entry '${key}' has no corresponding hand-off in the current spec (spec/locked/interfaces.lock may have a dangling entry \u2014 was the hand-off removed?).`
      );
    }
  }
  if (compareSemverTuples(parseSemverLoose(ARCHASCODE_VERSION), parseSemverLoose(response.server_version)) < 0) {
    const remediation = opts.clientSurface === "plugin" ? "update: reinstall archascode-plugin.vsix from the updated invite kit (a marketplace update alone does not update the editor extension)." : "update: run `/plugin marketplace update archascode`, then `/reload-plugins`.";
    warnings.push(
      `archascode ${ARCHASCODE_VERSION} is behind the cloud service (${response.server_version}) \u2014 ${remediation}`
    );
  }
  const environments = buildEnvironments(response.environments);
  const defaultEnvironment = response.default_environment;
  const nextTombstone = [.../* @__PURE__ */ new Set([...priorTombstone, ...seededOnceEverPaths])];
  const now = opts.now ? opts.now() : /* @__PURE__ */ new Date();
  const inflightSlug = response.inflight_slug ?? null;
  const manifest = {
    schemaVersion: 1,
    renderedAt: now.toISOString(),
    specPath: path6.resolve(opts.specPath),
    files: trackedPaths,
    renderedBy: {
      client: ARCHASCODE_VERSION,
      ...response.server_version ? { server: response.server_version } : {}
    },
    ...nextTombstone.length > 0 ? { seededOnceEver: nextTombstone } : {},
    ...inflightSlug !== null ? {
      schema: {
        sqlserver: { inflightSlug }
      }
    } : {},
    ...environments ? { environments } : {},
    ...defaultEnvironment ? { defaultEnvironment } : {}
  };
  await writeManifest(opts.outDir, manifest);
  return {
    ok: true,
    filesWritten: writtenPaths,
    filesRemoved: stalePaths,
    // Map enriched PendingHandoff[] back to bare HandoffItem[] so the CLI/plugin
    // surface (RenderHandoffOutcome.pending: HandoffItem[]) stays unchanged.
    handoff: { resolved: overlay.resolved, pending: overlay.pending.map((p) => p.item) },
    ...warnings.length > 0 ? { warnings } : {}
  };
}
async function readPriorMigrations(outDir) {
  const dir = path6.join(outDir, SPEC_MIGRATIONS_REL_DIR);
  let entries;
  try {
    entries = await readdir2(dir);
  } catch (err) {
    if (isNotFound4(err)) return [];
    throw err;
  }
  const cuts = entries.filter(
    (name) => name.endsWith(".sql") && name !== INFLIGHT_FILENAME
  );
  const out = [];
  for (const filename of cuts.sort()) {
    const contents = await readFile4(path6.join(dir, filename), "utf8");
    out.push({ filename, contents });
  }
  return out;
}
function isNotFound4(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
function parseSemverLoose(s) {
  const match = s ? /^(\d+)\.(\d+)\.(\d+)$/.exec(s) : null;
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function compareSemverTuples(a, b) {
  for (let i = 0; i < 3; i++) {
    const diff = a[i] - b[i];
    if (diff !== 0) return diff;
  }
  return 0;
}
function buildEnvironments(entries) {
  if (!entries || entries.length === 0) return void 0;
  const out = {};
  for (const entry of entries) {
    const env = {
      portBinding: entry.port_binding,
      data: entry.data,
      needsSqlserver: entry.needs_sqlserver
    };
    if (entry.compute) {
      env.compute = entry.compute;
    }
    if (entry.app_adapters?.auth?.id) {
      env.appAdapters = { auth: { id: entry.app_adapters.auth.id } };
    }
    out[entry.name] = env;
  }
  return out;
}
async function recordHandoffResolution(outDir, itemId, hash) {
  const ledger = await readInterfaceLock(outDir);
  ledger[itemId] = hash;
  await writeInterfaceLock(outDir, ledger);
}

// ../../../packages/core/src/config.ts
var LOCAL_DEV_URL = "http://localhost:8100";
var HOSTED_CLOUD_URL = "https://api.archascode.com";
var COGNITO_REGION = "us-east-1";
var COGNITO_CLIENT_ID = "5bll6vjhs6ivlqlik4kllt1i5j";
var COGNITO_PASSWORD_REQUIREMENTS = "at least 8 characters, including an uppercase letter, a lowercase letter, a number, and a symbol";
var COGNITO_HOSTED_UI_DOMAIN = "https://archascode-auth.auth.us-east-1.amazoncognito.com";
function cognitoHostedUiDomain(env = process.env) {
  return env.ARCHASCODE_COGNITO_DOMAIN ?? COGNITO_HOSTED_UI_DOMAIN;
}
function cognitoClientId(env = process.env) {
  return env.ARCHASCODE_COGNITO_CLIENT_ID ?? COGNITO_CLIENT_ID;
}
function cognitoRegion(env = process.env) {
  return env.ARCHASCODE_COGNITO_REGION ?? COGNITO_REGION;
}
function isPresent(value) {
  return value !== void 0 && value.trim() !== "";
}
function resolveCloudUrl(input) {
  if (isPresent(input.explicit)) {
    return input.explicit;
  }
  if (isPresent(input.env)) {
    return input.env;
  }
  if (isPresent(input.credentials)) {
    return input.credentials;
  }
  return null;
}
function isLocalDevOrigin(url) {
  try {
    return new URL(url).origin === new URL(LOCAL_DEV_URL).origin;
  } catch {
    return false;
  }
}

// ../../../packages/core/src/cutSchemaMigration.ts
import { mkdir as mkdir6, readFile as readFile5, writeFile as writeFile4 } from "node:fs/promises";
import * as path7 from "node:path";
var MIGRATIONS_REL_DIR = path7.join(
  "src",
  "adapter",
  "persistence",
  "sqlserver",
  "schema",
  "migrations"
);
var SPEC_MIGRATIONS_REL_DIR2 = path7.join(
  "spec",
  "locked",
  "adapter",
  "persistence",
  "sqlserver",
  "schema",
  "migrations"
);
var INFLIGHT_FILENAME2 = "_inflight.sql";
var FALLBACK_SLUG = "update_schema";
var EMPTY_INFLIGHT_BODY = "-- Generated by archascode \u2014 no pending schema changes\n";
async function cutSchemaMigration(opts) {
  const migrationsDir = path7.join(opts.outDir, MIGRATIONS_REL_DIR);
  const inflightPath = path7.join(migrationsDir, INFLIGHT_FILENAME2);
  let inflightBody;
  try {
    inflightBody = await readFile5(inflightPath, "utf8");
  } catch (err) {
    if (isNotFound5(err)) {
      return {
        ok: false,
        reason: "missing-inflight-file",
        message: `no _inflight.sql at ${inflightPath}; run \`archascode render\` first`
      };
    }
    throw err;
  }
  if (!hasMeaningfulContent(inflightBody)) {
    return {
      ok: false,
      reason: "no-inflight",
      message: "no in-flight changes; nothing to cut. Run `archascode render` after editing the spec to populate."
    };
  }
  const slug = resolveSlug(opts.name, await readCachedSlug(opts.outDir));
  const timestamp = formatTimestamp(opts.now ? opts.now() : /* @__PURE__ */ new Date());
  const finalFilename = `${timestamp}_${slug}.sql`;
  const specMigrationsDir = path7.join(opts.outDir, SPEC_MIGRATIONS_REL_DIR2);
  const specCutPath = path7.join(specMigrationsDir, finalFilename);
  const projectedCutPath = path7.join(migrationsDir, finalFilename);
  await mkdir6(specMigrationsDir, { recursive: true });
  await writeFile4(specCutPath, inflightBody, "utf8");
  await writeFile4(projectedCutPath, inflightBody, "utf8");
  await writeFile4(inflightPath, EMPTY_INFLIGHT_BODY, "utf8");
  return { ok: true, producedFilename: finalFilename };
}
function hasMeaningfulContent(sql) {
  for (const rawLine of sql.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("--")) continue;
    return true;
  }
  return false;
}
async function readCachedSlug(outDir) {
  const manifest = await readManifest(outDir);
  return manifest?.schema?.sqlserver?.inflightSlug ?? null;
}
function resolveSlug(override, cached) {
  if (override !== void 0 && override.length > 0) {
    return normalizeSlug(override);
  }
  if (cached !== null && cached.length > 0) {
    return normalizeSlug(cached);
  }
  return FALLBACK_SLUG;
}
function normalizeSlug(raw) {
  const lowered = raw.trim().toLowerCase();
  const collapsed = lowered.replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_");
  const trimmed = collapsed.replace(/^_+|_+$/g, "");
  return trimmed.length > 0 ? trimmed : FALLBACK_SLUG;
}
function formatTimestamp(now) {
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const mo = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const h = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");
  const s = now.getUTCSeconds().toString().padStart(2, "0");
  return `${y}${mo}${d}${h}${mi}${s}`;
}
function isNotFound5(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

// ../../../packages/core/src/cleanProject.ts
import { readdir as readdir3, rm as rm3, stat as stat2 } from "node:fs/promises";
import * as path8 from "node:path";
var CLEAN_TARGETS = [
  "src",
  path8.join("spec", "src"),
  path8.join(".archascode", "manifest.json"),
  "aac.py",
  "docker-compose.yml"
];
var SPEC_MIGRATIONS_REL_DIR3 = path8.join(
  "spec",
  "locked",
  "adapter",
  "persistence",
  "sqlserver",
  "schema",
  "migrations"
);
var INFLIGHT_FILENAME3 = "_inflight.sql";
var CUT_FILENAME_RX = /^\d{14}_[a-z0-9_]+\.sql$/;
async function planClean(opts) {
  const hard = opts.hard ?? false;
  const targets = [];
  const warnings = [];
  if (hard) {
    const hardTargets = [
      ...CLEAN_TARGETS,
      path8.join("spec", "locked")
    ];
    for (const rel of hardTargets) {
      if (await pathExists3(path8.join(opts.outDir, rel))) {
        targets.push(rel);
      }
    }
    const sealedCuts = await listSealedCuts(opts.outDir);
    if (sealedCuts.length > 0) {
      warnings.push(
        `${sealedCuts.length} sealed schema migration(s) under ${SPEC_MIGRATIONS_REL_DIR3} will be deleted (${sealedCuts.join(", ")}). The next render re-derives schema from zero.`
      );
    }
    const deployedEnvs = await listDeployedEnvironments(opts.outDir);
    if (deployedEnvs.length > 0) {
      warnings.push(
        `the manifest records environment(s) ${deployedEnvs.join(", ")}; deleting the migration chain may desync a deployed target.`
      );
    }
  } else {
    const defaultTopTargets = [
      "src",
      path8.join(".archascode", "manifest.json"),
      "aac.py",
      "docker-compose.yml"
    ];
    for (const rel of defaultTopTargets) {
      if (await pathExists3(path8.join(opts.outDir, rel))) {
        targets.push(rel);
      }
    }
    if (await pathExists3(path8.join(opts.outDir, "spec", "src"))) {
      targets.push(path8.join("spec", "src"));
    }
  }
  return { targets, warnings };
}
async function cleanProject(opts) {
  const hard = opts.hard ?? false;
  const removed = [];
  if (hard) {
    const hardTargets = [
      ...CLEAN_TARGETS,
      path8.join("spec", "locked")
    ];
    for (const rel of hardTargets) {
      const dest = path8.join(opts.outDir, rel);
      if (!await pathExists3(dest)) continue;
      await rm3(dest, { recursive: true, force: true });
      removed.push(rel);
    }
  } else {
    for (const rel of CLEAN_TARGETS) {
      const dest = path8.join(opts.outDir, rel);
      if (!await pathExists3(dest)) continue;
      await rm3(dest, { recursive: true, force: true });
      removed.push(rel);
    }
  }
  return { removed };
}
async function listSealedCuts(outDir) {
  const dir = path8.join(outDir, SPEC_MIGRATIONS_REL_DIR3);
  let entries;
  try {
    entries = await readdir3(dir);
  } catch (err) {
    if (isNotFound6(err)) return [];
    throw err;
  }
  return entries.filter((name) => name !== INFLIGHT_FILENAME3 && CUT_FILENAME_RX.test(name)).sort();
}
async function listDeployedEnvironments(outDir) {
  const manifest = await readManifest(outDir);
  if (!manifest?.environments) return [];
  return Object.entries(manifest.environments).filter(([, env]) => env.needsSqlserver).map(([name]) => name).sort();
}
async function pathExists3(p) {
  try {
    await stat2(p);
    return true;
  } catch (err) {
    if (isNotFound6(err)) return false;
    throw err;
  }
}
function isNotFound6(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

// ../../../packages/core/src/auth.ts
import { chmod, mkdir as mkdir7, readFile as readFile6, rm as rm4, writeFile as writeFile5 } from "node:fs/promises";
import * as os from "node:os";
import * as path9 from "node:path";

// ../../../packages/core/src/oauth/callbackServer.ts
import { createServer } from "node:http";

// ../../../packages/core/src/oauth/errors.ts
var AuthCancelledError = class extends Error {
  kind = "cancelled";
  constructor(message = "Sign-in cancelled") {
    super(message);
    this.name = "AuthCancelledError";
  }
};
var AuthTimeoutError = class extends Error {
  kind = "timeout";
  constructor(message = "Sign-in timed out") {
    super(message);
    this.name = "AuthTimeoutError";
  }
};
var AuthIdpError = class extends Error {
  constructor(message, errorCode) {
    super(message);
    this.errorCode = errorCode;
    this.name = "AuthIdpError";
  }
  kind = "idp";
};
var AuthStateMismatchError = class extends Error {
  kind = "stateMismatch";
  constructor() {
    super("OAuth state parameter mismatch (possible CSRF)");
    this.name = "AuthStateMismatchError";
  }
};

// ../../../packages/core/src/oauth/callbackServer.ts
var DEFAULT_SUCCESS_MESSAGE = "You can close this tab.";
function successPage(successMessage) {
  return `<!doctype html><meta charset="utf-8"><title>Signed in</title>
<h2>Signed in</h2>
<p>${successMessage}</p>
<script>window.close()</script>`;
}
var CALLBACK_PORT = 53682;
var REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
function startCallbackServer(opts = {}) {
  const port = opts.port ?? CALLBACK_PORT;
  const successMessage = opts.successMessage ?? DEFAULT_SUCCESS_MESSAGE;
  return new Promise((resolve2, reject) => {
    let pendingResolve = null;
    let pendingReject = null;
    let timer = null;
    let closed = false;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const params = url.searchParams;
      const errCode = params.get("error");
      if (errCode) {
        const desc = params.get("error_description") ?? errCode;
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(`Sign-in failed: ${desc}`);
        pendingReject?.(new AuthIdpError(`IdP returned error: ${desc}`, errCode));
        pendingResolve = null;
        pendingReject = null;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return;
      }
      const code = params.get("code");
      const state = params.get("state");
      if (!code || !state) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Sign-in failed: missing code or state");
        pendingReject?.(new AuthIdpError("Callback missing code or state"));
        pendingResolve = null;
        pendingReject = null;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(successPage(successMessage));
      pendingResolve?.({ code, state });
      pendingResolve = null;
      pendingReject = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    });
    server.on("error", (err) => {
      if (!closed) reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to determine callback server port"));
        return;
      }
      const boundPort = addr.port;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (pendingReject) {
          const rej = pendingReject;
          pendingResolve = null;
          pendingReject = null;
          rej(new AuthCancelledError("Callback server closed before callback received"));
        }
        server.close();
      };
      resolve2({
        port: boundPort,
        close,
        waitForCallback(timeoutMs) {
          return new Promise((res2, rej2) => {
            pendingResolve = res2;
            pendingReject = rej2;
            timer = setTimeout(() => {
              pendingResolve = null;
              pendingReject = null;
              timer = null;
              close();
              rej2(new AuthTimeoutError());
            }, timeoutMs);
          });
        }
      });
    });
  });
}

// ../../../packages/core/src/oauth/pkce.ts
import { createHash, randomBytes } from "node:crypto";
function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generateVerifier() {
  return base64url(randomBytes(64));
}
function verifierToChallenge(verifier) {
  return base64url(createHash("sha256").update(verifier).digest());
}
function generateState() {
  return base64url(randomBytes(32));
}

// ../../../packages/core/src/oauth/flow.ts
var DEFAULT_FLOW_TIMEOUT_MS = 5 * 60 * 1e3;
function toTokenBundle(body, now = Date.now()) {
  if (!body.access_token || !body.id_token) {
    throw new AuthIdpError("Token endpoint response missing access_token or id_token");
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    access_token: body.access_token,
    id_token: body.id_token,
    refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expires_at: now + expiresIn * 1e3
  };
}
async function postForm(url, body, fetcher = fetch) {
  const form = new URLSearchParams(body).toString();
  const res = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const text = await res.text();
  if (!res.ok) {
    throw new AuthIdpError(`Token endpoint returned ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthIdpError(`Token endpoint returned non-JSON body: ${text.slice(0, 200)}`);
  }
}
async function runAuthorizationCodeFlow(config, options) {
  const { openExternal, onOpenFailure } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS;
  const verifier = generateVerifier();
  const challenge = verifierToChallenge(verifier);
  const state = generateState();
  const serverOpts = {};
  if (options.port !== void 0) serverOpts.port = options.port;
  if (options.successMessage !== void 0) serverOpts.successMessage = options.successMessage;
  const server = await startCallbackServer(serverOpts);
  try {
    const redirectUri = options.port === void 0 ? REDIRECT_URI : `http://127.0.0.1:${server.port}/callback`;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: config.scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    const authorizeUrl = `${config.authorizeUrl}?${params.toString()}`;
    let launched = false;
    let openError;
    try {
      launched = await openExternal(authorizeUrl);
    } catch (err) {
      openError = err;
    }
    if (onOpenFailure === "abort") {
      if (openError !== void 0) throw openError;
      if (!launched) {
        throw new AuthCancelledError("Could not open external browser for sign-in");
      }
    }
    const cb = await server.waitForCallback(timeoutMs);
    if (cb.state !== state) {
      throw new AuthStateMismatchError();
    }
    const tokenBody = await postForm(
      config.tokenUrl,
      {
        grant_type: "authorization_code",
        code: cb.code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: verifier
      },
      options.fetcher
    );
    return toTokenBundle(tokenBody);
  } finally {
    server.close();
  }
}

// ../../../packages/core/src/auth.ts
function defaultCredentialsPath() {
  const override = process.env.ARCHASCODE_CREDENTIALS_PATH;
  if (override) {
    return override;
  }
  return path9.join(os.homedir(), ".archascode", "credentials.json");
}
var CREDENTIALS_FILE_MODE = 384;
async function cognitoRequest(region, target, body, fetcher) {
  const res = await fetcher(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${target}`
    },
    body: JSON.stringify(body)
  });
  return res;
}
async function cognitoErrorDetail(res) {
  try {
    const body = await res.json();
    return {
      type: body.__type ?? "",
      message: body.message ?? body.__type ?? `HTTP ${res.status}`
    };
  } catch {
    return { type: "", message: `HTTP ${res.status}` };
  }
}
async function writeCredentials(credentialsPath, creds) {
  await mkdir7(path9.dirname(credentialsPath), { recursive: true });
  await writeFile5(credentialsPath, JSON.stringify(creds, null, 2) + "\n", {
    mode: CREDENTIALS_FILE_MODE
  });
  await chmod(credentialsPath, CREDENTIALS_FILE_MODE);
}
async function login(opts) {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  const region = opts.region ?? cognitoRegion();
  const clientId = opts.clientId ?? cognitoClientId();
  const credentialsPath = opts.credentialsPath ?? defaultCredentialsPath();
  const cloudUrl = opts.cloudUrl ?? HOSTED_CLOUD_URL;
  if (!clientId) {
    throw new Error(
      "archascode cloud auth is not yet provisioned: ARCHASCODE_COGNITO_CLIENT_ID is unset and no client id has been baked in \u2014 see infra/README.md"
    );
  }
  const initRes = await cognitoRequest(
    region,
    "InitiateAuth",
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: clientId,
      AuthParameters: { USERNAME: opts.username, PASSWORD: opts.password }
    },
    fetcher
  );
  if (!initRes.ok) {
    const err = await cognitoErrorDetail(initRes);
    throw new Error(`Cognito login failed: ${err.message}`);
  }
  const initJson = await initRes.json();
  let authResult = initJson.AuthenticationResult;
  if (initJson.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    if (!opts.promptNewPassword) {
      throw new Error(
        "Cognito requires a new password on first login (NEW_PASSWORD_REQUIRED) but no promptNewPassword callback was provided"
      );
    }
    const newPassword = await opts.promptNewPassword();
    const challengeRes = await cognitoRequest(
      region,
      "RespondToAuthChallenge",
      {
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        ClientId: clientId,
        Session: initJson.Session,
        ChallengeResponses: {
          USERNAME: opts.username,
          NEW_PASSWORD: newPassword
        }
      },
      fetcher
    );
    if (!challengeRes.ok) {
      const err = await cognitoErrorDetail(challengeRes);
      if (err.type === "InvalidPasswordException") {
        throw new Error(
          `Cognito rejected the new password: ${err.message} (passwords must be ${COGNITO_PASSWORD_REQUIREMENTS})`
        );
      }
      throw new Error(`Cognito new-password challenge failed: ${err.message}`);
    }
    const challengeJson = await challengeRes.json();
    authResult = challengeJson.AuthenticationResult;
  }
  if (!authResult) {
    throw new Error(
      initJson.ChallengeName && initJson.ChallengeName !== "NEW_PASSWORD_REQUIRED" ? `Cognito returned an unsupported challenge: ${initJson.ChallengeName}` : "Cognito login did not return an AuthenticationResult"
    );
  }
  const accessTokenExpiresAt = new Date(
    now().getTime() + authResult.ExpiresIn * 1e3
  ).toISOString();
  const creds = {
    username: opts.username,
    refreshToken: authResult.RefreshToken ?? "",
    accessToken: authResult.AccessToken,
    accessTokenExpiresAt,
    clientId,
    region,
    cloudUrl
  };
  await writeCredentials(credentialsPath, creds);
  return creds;
}
function usernameFromAccessToken(token) {
  try {
    const parts = token.split(".");
    const payloadSegment = parts[1];
    if (parts.length !== 3 || !payloadSegment) {
      return "";
    }
    const padded = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return typeof payload.username === "string" ? payload.username : "";
  } catch {
    return "";
  }
}
async function loginWithBrowser(opts) {
  const region = opts.region ?? cognitoRegion();
  const clientId = opts.clientId ?? cognitoClientId();
  const credentialsPath = opts.credentialsPath ?? defaultCredentialsPath();
  const cloudUrl = opts.cloudUrl ?? HOSTED_CLOUD_URL;
  if (!clientId) {
    throw new Error(
      "archascode cloud auth is not yet provisioned: ARCHASCODE_COGNITO_CLIENT_ID is unset and no client id has been baked in \u2014 see infra/README.md"
    );
  }
  let authorizeUrl = opts.authorizeUrl;
  let tokenUrl = opts.tokenUrl;
  if (authorizeUrl === void 0 && tokenUrl === void 0) {
    const domain = cognitoHostedUiDomain();
    if (!domain) {
      throw new Error(
        "archascode browser login is not yet provisioned: ARCHASCODE_COGNITO_DOMAIN is unset and no Hosted UI domain has been baked in \u2014 see infra/README.md"
      );
    }
    authorizeUrl = `${domain}/oauth2/authorize`;
    tokenUrl = `${domain}/oauth2/token`;
  } else {
    authorizeUrl = authorizeUrl ?? `${cognitoHostedUiDomain()}/oauth2/authorize`;
    tokenUrl = tokenUrl ?? `${cognitoHostedUiDomain()}/oauth2/token`;
  }
  let bundle;
  try {
    bundle = await runAuthorizationCodeFlow(
      { authorizeUrl, tokenUrl, clientId, scopes: ["openid"] },
      {
        openExternal: opts.openExternal,
        onOpenFailure: "wait",
        successMessage: "You can close this tab and return to your terminal.",
        ...opts.fetcher !== void 0 ? { fetcher: opts.fetcher } : {},
        ...opts.port !== void 0 ? { port: opts.port } : {},
        ...opts.timeoutMs !== void 0 ? { timeoutMs: opts.timeoutMs } : {}
      }
    );
  } catch (err) {
    if (err && typeof err === "object" && err.code === "EADDRINUSE") {
      throw new Error(
        "another login is already in progress (port 53682 is busy) \u2014 finish or cancel it, then retry"
      );
    }
    throw err;
  }
  const creds = {
    username: usernameFromAccessToken(bundle.access_token),
    refreshToken: bundle.refresh_token ?? "",
    accessToken: bundle.access_token,
    accessTokenExpiresAt: new Date(bundle.expires_at).toISOString(),
    clientId,
    region,
    cloudUrl
  };
  await writeCredentials(credentialsPath, creds);
  return creds;
}
var EXPIRY_SKEW_MS = 6e4;
async function getAuthToken(opts = {}) {
  const credentialsPath = opts.credentialsPath ?? defaultCredentialsPath();
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  const creds = await readCredentials(credentialsPath);
  if (!creds) {
    return null;
  }
  const expiresAt = Date.parse(creds.accessTokenExpiresAt);
  if (!Number.isNaN(expiresAt) && expiresAt - now().getTime() > EXPIRY_SKEW_MS) {
    return creds.accessToken;
  }
  try {
    const res = await cognitoRequest(
      creds.region,
      "InitiateAuth",
      {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: creds.clientId,
        AuthParameters: { REFRESH_TOKEN: creds.refreshToken }
      },
      fetcher
    );
    if (!res.ok) {
      return null;
    }
    const json = await res.json();
    const authResult = json.AuthenticationResult;
    if (!authResult) {
      return null;
    }
    const accessTokenExpiresAt = new Date(
      now().getTime() + authResult.ExpiresIn * 1e3
    ).toISOString();
    const refreshed = {
      ...creds,
      accessToken: authResult.AccessToken,
      // Cognito's refresh response typically omits RefreshToken; keep the
      // existing one when so.
      refreshToken: authResult.RefreshToken ?? creds.refreshToken,
      accessTokenExpiresAt
    };
    await writeCredentials(credentialsPath, refreshed);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}
async function readCredentials(credentialsPath) {
  const resolvedPath = credentialsPath ?? defaultCredentialsPath();
  try {
    const raw = await readFile6(resolvedPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function logout(credentialsPath) {
  const resolvedPath = credentialsPath ?? defaultCredentialsPath();
  try {
    await rm4(resolvedPath);
    return true;
  } catch {
    return false;
  }
}

// src/clean.ts
async function runClean(input, io) {
  const plan = await planClean({ outDir: input.outDir, hard: input.hard ?? false });
  if (plan.targets.length === 0) {
    if (input.json) {
      io.stdout(JSON.stringify({ ok: true, removed: [], warnings: plan.warnings }) + "\n");
    } else {
      io.stderr("nothing to clean \u2014 no render output found.\n");
    }
    return { ok: true, removed: [], warnings: plan.warnings };
  }
  if (!input.json) {
    io.stderr("clean will delete:\n");
    for (const t of plan.targets) io.stderr(`  - ${t}
`);
    if (plan.warnings.length > 0) {
      io.stderr("\nwarnings:\n");
      for (const w of plan.warnings) io.stderr(`  ! ${w}
`);
    }
    if (input.hard ?? false) {
      io.stderr(
        "\n--hard: deletes the whole render surface incl. spec/locked/ + migrations.\nspec/architecture.yml and positions.json are kept. git can recover the rest.\n"
      );
    } else {
      io.stderr(
        "\nresets the regenerable surface; spec/locked/ (hand-owned bodies + migrations)\nand the lockfile are kept. spec/architecture.yml and positions.json are kept.\n"
      );
    }
  }
  if (!input.assumeYes) {
    const ok = await io.confirm("Delete the render output? [y/N] ");
    if (!ok) {
      if (input.json) {
        io.stdout(JSON.stringify({ ok: false, reason: "aborted" }) + "\n");
      } else {
        io.stderr("aborted; nothing deleted.\n");
      }
      return { ok: false, reason: "aborted" };
    }
  }
  const result = await cleanProject({ outDir: input.outDir, hard: input.hard ?? false });
  if (input.json) {
    io.stdout(
      JSON.stringify({ ok: true, removed: result.removed, warnings: plan.warnings }) + "\n"
    );
  } else {
    io.stdout(`cleaned ${result.removed.length} target(s)
`);
  }
  return { ok: true, removed: result.removed, warnings: plan.warnings };
}

// src/deploy.ts
import { spawn } from "node:child_process";
import { readFile as readFile7, readdir as readdir4 } from "node:fs/promises";
import * as path10 from "node:path";
var INFLIGHT_REL_PATH = path10.join(
  "src",
  "adapter",
  "persistence",
  "sqlserver",
  "schema",
  "migrations",
  "_inflight.sql"
);
var SPEC_MIGRATIONS_REL_DIR4 = path10.join(
  "spec",
  "locked",
  "adapter",
  "persistence",
  "sqlserver",
  "schema",
  "migrations"
);
var CUT_FILENAME_RE = /^\d{14}_[a-z0-9_]+\.sql$/;
async function runDeploy(input, io) {
  const { outDir, envName, baselineExisting, mode, planOut, upTo } = input;
  const readManifestFn = io.readManifest ?? readManifest;
  const manifest = await readManifestFn(outDir);
  const env = manifest?.environments?.[envName] ?? null;
  if (env === null) {
    io.stderr(`deploy: env ${envName} not found in manifest
`);
    return 2;
  }
  if (env.data === "ephemeral") {
    io.stderr(
      `archascode: env ${envName} is data: ephemeral \u2014 for quicker dev iteration, use 'aac up'
`
    );
  }
  const inflightPath = path10.join(outDir, INFLIGHT_REL_PATH);
  if (await inflightHasDelta(inflightPath)) {
    io.stderr(
      "archascode: uncommitted schema changes in _inflight.sql. Run 'aac cut-schema-migration' first.\n"
    );
    return 1;
  }
  const uncommitted = await uncommittedCuts(outDir);
  if (uncommitted.length > 0) {
    io.stderr(
      `archascode: the following cut files are not committed to git:
`
    );
    for (const f of uncommitted) io.stderr(`  ${f}
`);
    io.stderr("Commit them before deploying.\n");
    return 1;
  }
  return await io.invokeMigrate({ outDir, envName, baselineExisting, mode, planOut, upTo });
}
async function inflightHasDelta(inflightPath) {
  let body;
  try {
    body = await readFile7(inflightPath, "utf8");
  } catch (err) {
    if (isNotFound7(err)) return false;
    throw err;
  }
  return hasMeaningfulContent(body);
}
async function uncommittedCuts(outDir) {
  const cutsDir = path10.join(outDir, SPEC_MIGRATIONS_REL_DIR4);
  let entries;
  try {
    entries = await readdir4(cutsDir);
  } catch (err) {
    if (isNotFound7(err)) return [];
    throw err;
  }
  const cutFiles = entries.filter((name) => CUT_FILENAME_RE.test(name)).sort();
  const offending = [];
  for (const name of cutFiles) {
    const rel = path10.join(SPEC_MIGRATIONS_REL_DIR4, name);
    if (!await isPathClean(outDir, rel)) {
      offending.push(rel);
    }
  }
  return offending;
}
async function isPathClean(outDir, relPath) {
  const result = await runCommand(
    "git",
    ["status", "--porcelain", "--", relPath],
    outDir
  );
  if (result.code !== 0) {
    return false;
  }
  return result.stdout.trim().length === 0;
}
function buildMigrateCommand(envName) {
  return {
    cmd: "uv",
    args: ["run", "python", "aac.py", "--env", envName, "migrate"]
  };
}
function buildMigrateEnv(input) {
  const env = {};
  if (input.baselineExisting) {
    env.ARCHASCODE_BASELINE_EXISTING = "1";
  }
  if (input.mode === "plan") {
    env.ARCHASCODE_DRY_RUN = "1";
  }
  if (input.planOut) {
    env.ARCHASCODE_PLAN_OUT = input.planOut;
  }
  if (input.upTo) {
    env.ARCHASCODE_UP_TO = input.upTo;
  }
  return env;
}
var defaultInvokeMigrate = async (input) => {
  const env = { ...process.env, ...buildMigrateEnv(input) };
  const { cmd, args } = buildMigrateCommand(input.envName);
  return new Promise((resolve2, reject) => {
    const child = spawn(cmd, args, {
      cwd: input.outDir,
      stdio: "inherit",
      env
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal !== null) {
        resolve2(128);
        return;
      }
      resolve2(code ?? 0);
    });
  });
};
async function runCommand(cmd, args, cwd) {
  return new Promise((resolve2, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => stdout += chunk.toString());
    child.stderr?.on("data", (chunk) => stderr += chunk.toString());
    child.on("error", reject);
    child.on("exit", (code) => resolve2({ code: code ?? 0, stdout, stderr }));
  });
}
function isNotFound7(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

// src/cli.ts
var DEFAULT_SPEC_PATH = "./spec/architecture.yml";
var USAGE = `archascode \u2014 local CLI

Usage:
  archascode render [<spec-path>] [--out <dir>] [--cloud-url <url>] [--json]
  archascode login [--cloud-url <url>] [--password] [--username <name>]
  archascode logout
  archascode record-handoff --id <handoff-id> --hash <contract-hash> [--out <dir>]
  archascode cut-schema-migration [--name <slug>] [--out <dir>] [--json]
  archascode db plan  --env <name> [--out <dir>] [--plan-out <file>] [--up-to <bound>]
  archascode db apply --env <name> [--out <dir>] [--baseline-existing-target] [--up-to <bound>]
  archascode clean [--out <dir>] [--yes] [--json] [--hard]
  archascode --version

Arguments:
  <spec-path>         Path to architecture.yml (default ${DEFAULT_SPEC_PATH})

Options:
  --out <dir>         Output directory (default \`.\`, the current working
                      directory). Rendered files land at the project root
                      alongside spec/, so aac.py and the dual-tree layout
                      (src/, spec/src/) sit where downstream tooling expects.
                      Run from a git tree so accidental overwrites can be
                      rolled back.
  --cloud-url <url>   archascode cloud base URL. Resolved by precedence:
                      this flag > $ARCHASCODE_DEV_CLOUD_URL > the
                      credentials-file cloudUrl (written by
                      \`archascode login\`). When none is set, render fails:
                      not logged in (run \`archascode login\`). Internal dev:
                      export ARCHASCODE_DEV_CLOUD_URL to target a
                      local/alternate cloud service.
  --username <name>   Username for \`archascode login\` (prompted if omitted).
  --json              Emit a machine-readable summary on stdout.
                      render schema:  { ok, filesWritten, filesRemoved,
                                        handoff: { resolved, pending } } |
                                      { ok: false, errors }.
                      cut-schema-migration schema:
                                      { ok: true, producedFilename } |
                                      { ok: false, reason, message }.
                      clean schema:   { ok: true, removed, warnings } |
                                      { ok: false, reason: "aborted" }.
  --id <handoff-id>   HandoffItem.id to record (record-handoff).
  --hash <hash>       Contract hash to persist (record-handoff).
  --name <slug>       Override the auto-inferred slug for the cut migration
                      file. Normalized to lowercase snake_case.
  --env <name>        Environment name (from architecture.yml) to target.
                      Required for db plan and db apply.
  --plan-out <file>   Preview destination for \`db plan\` (default stdout).
                      Distinct from the global --out <dir> (render root).
                      When set, stdout carries only a one-line summary pointer
                      and the file carries the SQL plan script.
  --baseline-existing-target
                      One-shot: record cuts on disk as applied in
                      schema_version *without* running their DDL. For
                      protected targets that pre-date ADR 021. Use once
                      per target, then drop the flag. (db apply and db plan)
  --up-to <bound>     Bound the pending cut selection to versions <= bound
                      (inclusive). Accepts a 1-14 digit version prefix
                      (right-padded with 9s to 14 digits, so --up-to 20260701
                      means "through the end of July 1") or a full cut
                      filename (20260701123045_add_x.sql, with or without the
                      .sql extension). The divergence checks still run
                      against the full disk cut set; the bound only narrows
                      the unapplied selection. Cannot be combined with
                      --baseline-existing-target (bounded baselining is
                      deferred; see ADR 069). (db apply and db plan)
  -y, --yes           Skip the confirmation prompt (clean). For scripted
                      and skill-driven use.
  -h, --help          Show this message
  -V, --version       Print the archascode version and exit

login / logout \u2014 archascode cloud accounts are invite-only: an operator
           creates your user via \`admin-create-user\`. By default, \`login\`
           opens the Cognito Hosted UI in your system browser (and always
           prints the sign-in URL, in case the browser doesn't launch) \u2014
           no TTY needed, so this works inside a Claude Code Bash tool call.
           Your first login asks you to choose a new password there
           (Cognito's NEW_PASSWORD_REQUIRED challenge, rendered as a normal
           web page). \`--password\` (implied by --username) instead runs
           the classic TTY username/password prompt flow, for SSH/headless
           machines the browser flow can't reach. Either route caches
           tokens + the cloud URL at ~/.archascode/credentials.json (mode
           0600). \`logout\` deletes that file. Passwords are never accepted
           on the command line \u2014 \`login\` rejects stray positional
           arguments loudly rather than silently ignoring them.

db plan  \u2014 read-only preview: connects to the target, computes the true
           pending cut set, runs divergence checks, and emits the exact SQL
           db apply would execute. Applies nothing. Refuses on divergence
           identically to db apply. Output goes to stdout by default.

db apply \u2014 execute verb (formerly \`archascode deploy\`): behaviorally
           identical to the old deploy command in every respect.

clean (default): resets the regenerable surface (src/, aac.py,
docker-compose.yml, .archascode/manifest.json, and spec/src/ wholesale).
Preserves spec/locked/ (hand-authored bodies + sealed migrations + the
interfaces.lock ledger). Safe to run without losing irreplaceable work;
git can recover the deleted regenerable content.

clean --hard: total reset \u2014 deletes everything incl. spec/locked/ and
sealed migrations, leaving only spec/architecture.yml and positions.json.
Use only to rebuild from zero (e.g. a corrupted migration chain).
Destructive and named explicitly; no short alias.
`;
async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        out: { type: "string", default: "." },
        "cloud-url": { type: "string" },
        username: { type: "string" },
        password: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        id: { type: "string" },
        hash: { type: "string" },
        name: { type: "string" },
        env: { type: "string" },
        "plan-out": { type: "string" },
        "baseline-existing-target": { type: "boolean", default: false },
        "up-to": { type: "string" },
        yes: { type: "boolean", short: "y", default: false },
        hard: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "V", default: false }
      },
      allowPositionals: true
    });
  } catch (err) {
    process.stderr.write(`error: ${err.message}

${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(`archascode ${ARCHASCODE_VERSION}
`);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (!command) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (command === "render") {
    return await runRender(values, rest);
  }
  if (command === "login") {
    return await runLogin(values, rest, defaultAuthCliDeps());
  }
  if (command === "logout") {
    return await runLogout(values, defaultAuthCliDeps());
  }
  if (command === "record-handoff") {
    return await runRecordHandoff(values);
  }
  if (command === "cut-schema-migration") {
    return await runCutSchemaMigration(values);
  }
  if (command === "db") {
    return await runDbCmd(rest, values);
  }
  if (command === "clean") {
    return await runClean2(values);
  }
  process.stderr.write(`unknown command: ${command}

${USAGE}`);
  return 2;
}
async function runRender(values, rest) {
  const specPath = rest[0] ?? DEFAULT_SPEC_PATH;
  const usedDefault = rest[0] === void 0;
  try {
    await access3(specPath);
  } catch {
    process.stderr.write(
      usedDefault ? `render: no spec at default path ${DEFAULT_SPEC_PATH}; pass an explicit <spec-path>

${USAGE}` : `render: spec not found at ${specPath}
`
    );
    return 2;
  }
  const outDir = values.out;
  const wantJson = Boolean(values.json);
  const creds = await readCredentials();
  const cloudUrl = resolveCloudUrl({
    explicit: values["cloud-url"],
    env: process.env.ARCHASCODE_DEV_CLOUD_URL,
    credentials: creds?.cloudUrl
  });
  if (cloudUrl === null) {
    process.stderr.write(
      "render failed: not logged in to archascode\nhint: run `archascode login`\n"
    );
    return 2;
  }
  const authToken = isLocalDevOrigin(cloudUrl) ? void 0 : await getAuthToken() ?? void 0;
  if (!wantJson) {
    process.stderr.write(`rendering ${specPath} \u2192 ${outDir}
`);
  }
  let outcome;
  try {
    outcome = await render({
      specPath,
      outDir,
      cloudUrl,
      clientSurface: "cli",
      ...authToken !== void 0 ? { authToken } : {}
    });
  } catch (err) {
    let msg = `render failed: ${err.message}`;
    if (err instanceof CloudRequestError && err.status === 401) {
      msg += "\nhint: run `archascode login`";
    }
    if (err instanceof CloudRequestError && err.status === 426) {
      msg += "\nhint: update your archascode install \u2014 run `/plugin marketplace update archascode`, then `/reload-plugins`";
    }
    if (wantJson) {
      process.stdout.write(
        JSON.stringify({ ok: false, errors: [msg] }) + "\n"
      );
    } else {
      process.stderr.write(`${msg}
`);
    }
    return 1;
  }
  if (wantJson) {
    process.stdout.write(JSON.stringify(outcome) + "\n");
    return outcome.ok ? 0 : 1;
  }
  if (!outcome.ok) {
    process.stderr.write("spec rejected by cloud:\n");
    for (const e of outcome.errors) {
      process.stderr.write(`  - ${e}
`);
    }
    return 1;
  }
  process.stdout.write(
    `wrote ${outcome.filesWritten.length} file(s) to ${outDir}` + (outcome.filesRemoved.length > 0 ? ` (removed ${outcome.filesRemoved.length} stale)` : "") + (outcome.handoff.pending.length > 0 ? ` (${outcome.handoff.pending.length} pending hand-off${outcome.handoff.pending.length === 1 ? "" : "s"})` : "") + "\n"
  );
  if (outcome.warnings) {
    for (const w of outcome.warnings) {
      process.stderr.write(`${w}
`);
    }
  }
  return 0;
}
function promptMasked(question) {
  return new Promise((resolve2) => {
    const { stdin, stderr } = process;
    stderr.write(question);
    let answer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stderr.write("\n");
          resolve2(answer.trim());
          return;
        } else if (char === "") {
          cleanup();
          stderr.write("\n");
          process.exit(130);
        } else if (char === "\x7F" || char === "\b") {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            stderr.write("\b \b");
          }
        } else if (char >= " ") {
          answer += char;
          stderr.write("*");
        }
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}
async function openSystemBrowser(url) {
  process.stderr.write(`Open this URL to sign in:
  ${url}
`);
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : ["xdg-open", [url]];
  try {
    const child = spawn2(cmd, args, {
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
function defaultAuthCliDeps() {
  return {
    prompt: async (q) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return (await rl.question(q)).trim();
      } finally {
        rl.close();
      }
    },
    promptSecret: async (q) => {
      if (!process.stdin.isTTY) {
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        try {
          return (await rl.question(q)).trim();
        } finally {
          rl.close();
        }
      }
      return promptMasked(q);
    },
    login,
    logout,
    isTTY: () => process.stdin.isTTY === true,
    loginWithBrowser: (opts) => loginWithBrowser({ ...opts, openExternal: openSystemBrowser })
  };
}
async function runLogin(values, rest, deps) {
  if (rest.length > 0) {
    process.stderr.write(
      `login: unexpected argument(s) \u2014 passwords are never accepted on the command line

${USAGE}`
    );
    return 2;
  }
  const explicitCloudUrl = values["cloud-url"];
  const explicitUsername = values.username;
  const usePassword = Boolean(values.password) || explicitUsername !== void 0;
  if (!usePassword) {
    try {
      const creds = await deps.loginWithBrowser({
        ...explicitCloudUrl !== void 0 ? { cloudUrl: explicitCloudUrl } : {}
      });
      process.stdout.write(
        creds.username ? `logged in as ${creds.username} (${creds.cloudUrl})
` : `logged in (${creds.cloudUrl})
`
      );
      return 0;
    } catch (err) {
      process.stderr.write(`login failed: ${err.message}
`);
      return 1;
    }
  }
  if (!deps.isTTY()) {
    process.stderr.write("login: no TTY for prompts\n");
    return 2;
  }
  const username = explicitUsername ?? await deps.prompt("Username: ");
  const password = await deps.promptSecret("Password: ");
  try {
    const creds = await deps.login({
      username,
      password,
      promptNewPassword: () => deps.promptSecret("New password required \u2014 choose one: "),
      ...explicitCloudUrl !== void 0 ? { cloudUrl: explicitCloudUrl } : {}
    });
    process.stdout.write(`logged in as ${creds.username} (${creds.cloudUrl})
`);
    return 0;
  } catch (err) {
    process.stderr.write(`login failed: ${err.message}
`);
    return 1;
  }
}
async function runLogout(_values, deps) {
  const removed = await deps.logout();
  process.stdout.write(removed ? "logged out\n" : "no credentials to remove\n");
  return 0;
}
async function runRecordHandoff(values) {
  const id = values.id;
  const hash = values.hash;
  const outDir = values.out;
  if (!id || !hash) {
    process.stderr.write(
      "record-handoff: --id and --hash are required\n\n" + USAGE
    );
    return 2;
  }
  try {
    await recordHandoffResolution(outDir, id, hash);
  } catch (err) {
    process.stderr.write(`record-handoff failed: ${err.message}
`);
    return 1;
  }
  process.stdout.write(`recorded ${id}=${hash} in ${outDir}
`);
  return 0;
}
async function runCutSchemaMigration(values) {
  const outDir = values.out;
  const name = values.name ?? void 0;
  const wantJson = Boolean(values.json);
  let outcome;
  try {
    outcome = await cutSchemaMigration({ outDir, name });
  } catch (err) {
    const msg = `cut-schema-migration failed: ${err.message}`;
    if (wantJson) {
      process.stdout.write(
        JSON.stringify({ ok: false, reason: "error", message: msg }) + "\n"
      );
    } else {
      process.stderr.write(`${msg}
`);
    }
    return 1;
  }
  if (wantJson) {
    process.stdout.write(JSON.stringify(outcome) + "\n");
    return outcome.ok ? 0 : 3;
  }
  if (!outcome.ok) {
    process.stderr.write(`${outcome.message}
`);
    return 3;
  }
  process.stdout.write(`cut migration ${outcome.producedFilename}
`);
  return 0;
}
async function runClean2(values) {
  const outDir = values.out;
  const assumeYes = Boolean(values.yes);
  const wantJson = Boolean(values.json);
  const hard = Boolean(values.hard);
  const outcome = await runClean(
    { outDir, assumeYes, json: wantJson, hard },
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      confirm: async (prompt) => {
        if (!process.stdin.isTTY) {
          process.stderr.write(
            "clean: no TTY for confirmation; re-run with --yes to proceed.\n"
          );
          return false;
        }
        const rl = createInterface({
          input: process.stdin,
          output: process.stderr
        });
        try {
          const answer = (await rl.question(prompt)).trim().toLowerCase();
          return answer === "y" || answer === "yes";
        } finally {
          rl.close();
        }
      }
    }
  );
  if (!outcome.ok) {
    return wantJson ? 3 : 0;
  }
  return 0;
}
var UP_TO_DIGITS_RE = /^\d{1,14}$/;
var UP_TO_FILENAME_RE = /^(\d{14})_[a-z0-9_]+(\.sql)?$/;
function parseUpToBound(raw) {
  if (UP_TO_DIGITS_RE.test(raw)) {
    return { ok: true, upTo: raw };
  }
  const filenameMatch = UP_TO_FILENAME_RE.exec(raw);
  if (filenameMatch) {
    return { ok: true, upTo: filenameMatch[1] };
  }
  return {
    ok: false,
    message: `invalid --up-to value ${JSON.stringify(raw)}: expected a 1-14 digit version prefix (e.g. 20260701) or a full cut filename (<14-digit-timestamp>_<slug>.sql)`
  };
}
async function runDbCmd(rest, values) {
  const subverb = rest[0];
  if (subverb === "apply") {
    return await runDbApplyCmd(values);
  }
  if (subverb === "plan") {
    return await runDbPlanCmd(values);
  }
  const verbDisplay = subverb ? `unknown db verb: ${subverb}` : "db: missing subverb";
  process.stderr.write(`${verbDisplay}

${USAGE}`);
  return 2;
}
function resolveUpTo(verbLabel, values) {
  const rawUpTo = values["up-to"];
  if (rawUpTo === void 0) {
    return void 0;
  }
  const baselineExisting = Boolean(values["baseline-existing-target"]);
  if (baselineExisting) {
    process.stderr.write(
      `${verbLabel}: --up-to cannot be combined with --baseline-existing-target (bounded baselining is deferred; see ADR 069)

${USAGE}`
    );
    return null;
  }
  const result = parseUpToBound(rawUpTo);
  if (!result.ok) {
    process.stderr.write(`${verbLabel}: ${result.message}

${USAGE}`);
    return null;
  }
  return result.upTo;
}
async function runDbApplyCmd(values) {
  const outDir = values.out;
  const envName = values.env;
  const baselineExisting = Boolean(values["baseline-existing-target"]);
  if (!envName) {
    process.stderr.write("db apply: --env <name> is required\n\n" + USAGE);
    return 2;
  }
  const upTo = resolveUpTo("db apply", values);
  if (upTo === null) {
    return 2;
  }
  return await runDeploy(
    { outDir, envName, baselineExisting, mode: "apply", upTo },
    {
      stderr: (text) => process.stderr.write(text),
      invokeMigrate: defaultInvokeMigrate
    }
  );
}
async function runDbPlanCmd(values) {
  const outDir = values.out;
  const envName = values.env;
  const planOut = values["plan-out"];
  if (!envName) {
    process.stderr.write("db plan: --env <name> is required\n\n" + USAGE);
    return 2;
  }
  const baselineExisting = Boolean(values["baseline-existing-target"]);
  const upTo = resolveUpTo("db plan", values);
  if (upTo === null) {
    return 2;
  }
  return await runDeploy(
    { outDir, envName, baselineExisting, mode: "plan", planOut, upTo },
    {
      stderr: (text) => process.stderr.write(text),
      invokeMigrate: defaultInvokeMigrate
    }
  );
}
var isEntry = (() => {
  if (typeof process.argv[1] !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (isEntry) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`unexpected: ${err.stack ?? err}
`);
    process.exit(1);
  });
}
export {
  main,
  parseUpToBound,
  runLogin,
  runLogout
};
//# sourceMappingURL=cli.mjs.map
