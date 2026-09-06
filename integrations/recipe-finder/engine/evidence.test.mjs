// Evidence-grading tests — "the graph is evidence, not an oracle."
//
//   node --test engine/evidence.test.mjs
//
// Proves the recipe engine (a) grades confirmed structural evidence apart from
// name-matched / unresolved guesses, and (b) DETECTS and SURFACES partial
// analysis (parse failures, blind repos) instead of presenting an incomplete
// graph as certain. The core assertions are hermetic (synthetic records + a
// captured golden), so they run with no network and no live `entire` binary; a
// final live check runs only when `entire` is on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  edgeTier, gradeStep, buildAnalysis, stepCaveat, TIERS,
} from "./evidence.mjs";
import { parseSnapshotNdjson, snapshotGraph, graphAvailable } from "./graph.mjs";
import { isTestPath } from "./generate.mjs";
import { parseResolverJSON } from "./resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "__fixtures__", "partial-analysis");
const GOLDEN = join(__dirname, "__fixtures__", "partial-analysis-snapshot.ndjson");

const rel = (resolution, confidence, extra = {}) => ({
  record_type: "relation", type: "CALLS", resolution, confidence, ...extra,
});

// ---- edgeTier ---------------------------------------------------------------
test("edgeTier: resolved edges are confirmed", () => {
  assert.equal(edgeTier(rel("exact", 0.95)), TIERS.CONFIRMED);
  assert.equal(edgeTier(rel("import_resolved", 0.9)), TIERS.CONFIRMED);
  assert.equal(edgeTier(rel("import_external", 0.78)), TIERS.CONFIRMED);
});

test("edgeTier: name-matched / inferred edges are heuristic", () => {
  assert.equal(edgeTier(rel("name_only", 0.8)), TIERS.HEURISTIC);
  assert.equal(edgeTier(rel("type_inferred", 0.7)), TIERS.HEURISTIC);
  assert.equal(edgeTier(rel("pattern", 0.6)), TIERS.HEURISTIC);
});

test("edgeTier: unresolved edges are unverified", () => {
  assert.equal(edgeTier(rel("none", 0.3)), TIERS.UNVERIFIED);
  assert.equal(edgeTier(rel("", 0)), TIERS.UNVERIFIED);
});

test("edgeTier: a resolved edge with weak confidence is downgraded, not trusted", () => {
  assert.equal(edgeTier(rel("exact", 0.4)), TIERS.HEURISTIC);
});

test("edgeTier: an unknown/future resolution never over-claims", () => {
  assert.equal(edgeTier(rel("some_new_scheme", 0.99)), TIERS.HEURISTIC);
});

// ---- gradeStep --------------------------------------------------------------
test("gradeStep: confirmed evidence from a clean repo needs no verification", () => {
  const g = gradeStep([rel("import_external", 0.78), rel("import_external", 0.78)], { partial: false });
  assert.equal(g.tier, TIERS.CONFIRMED);
  assert.equal(g.verify, false);
  assert.equal(g.partial, false);
});

test("gradeStep: name-only evidence is heuristic and must be verified", () => {
  const g = gradeStep([rel("name_only", 0.8)], { partial: false });
  assert.equal(g.tier, TIERS.HEURISTIC);
  assert.equal(g.verify, true);
});

test("gradeStep: no backing edges => unverified claim", () => {
  const g = gradeStep([], { partial: false });
  assert.equal(g.tier, TIERS.UNVERIFIED);
  assert.equal(g.verify, true);
});

test("gradeStep: partial analysis keeps the honest tier but forces verification", () => {
  // requirement: fully-resolved code keeps working — a confirmed edge stays
  // confirmed even when the recipe was mined from a partial repo set, but the
  // incompleteness still forces a verify nudge.
  const g = gradeStep([rel("import_external", 0.78)], { partial: true });
  assert.equal(g.tier, TIERS.CONFIRMED);
  assert.equal(g.partial, true);
  assert.equal(g.verify, true);
  assert.match(stepCaveat(g), /partially-analyzed|missing steps/i);
});

// ---- buildAnalysis ----------------------------------------------------------
test("buildAnalysis: all-clean repos => complete + confirmed", () => {
  const a = buildAnalysis(
    [
      { name: "a", partialFailures: [], warnings: [], relationCount: 40 },
      { name: "b", partialFailures: [], warnings: [], relationCount: 30 },
    ],
    "js"
  );
  assert.equal(a.complete, true);
  assert.equal(a.confidence, "confirmed");
  assert.equal(a.reasons.length, 0);
});

test("buildAnalysis: a parse failure => incomplete + partial + reason + verify path", () => {
  const a = buildAnalysis(
    [
      { name: "clean", partialFailures: [], warnings: [], relationCount: 40 },
      { name: "novel", partialFailures: [{ path: "x.sql", code: "E_PARSE_ERROR" }], warnings: [], relationCount: 40 },
    ],
    "js"
  );
  assert.equal(a.complete, false);
  assert.equal(a.confidence, "partial");
  assert.equal(a.partialFailureCount, 1);
  assert.ok(a.reasons.some((r) => /failed to parse/i.test(r)));
  assert.match(a.verify, /PARTIALLY analyzed|confirm/i);
});

test("buildAnalysis: a blind (inventory-only / unparsed) repo => low confidence", () => {
  const a = buildAnalysis(
    [
      { name: "clean", partialFailures: [], warnings: [], relationCount: 40 },
      { name: "blind", partialFailures: [], warnings: [], relationCount: 0 },
    ],
    "js"
  );
  assert.equal(a.complete, false);
  assert.equal(a.confidence, "low");
  assert.deepEqual(a.blindRepos, ["blind"]);
  assert.ok(a.reasons.some((r) => /blind spot|no resolvable/i.test(r)));
});

// ---- isTestPath: keep test-runner imports out of recipes --------------------
test("isTestPath: test/bench/example files are excluded from mining", () => {
  for (const f of [
    "bench/argreduce.bench.ts", "test/clockSync.test.ts", "__tests__/a.js",
    "tests/test_core.py", "pkg/foo_test.go", "examples/demo.tsx", "src/x.spec.ts",
  ]) assert.equal(isTestPath(f), true, `${f} should be a test path`);
});

test("isTestPath: real source files are kept", () => {
  for (const f of ["src/editor.jsx", "src/lib/np.py", "src/index.ts", "app/api/route.ts"])
    assert.equal(isTestPath(f), false, `${f} should NOT be a test path`);
});

// ---- LLM resolver JSON parsing (hermetic — no API call) ---------------------
test("parseResolverJSON: clean JSON yields sanitized candidates", () => {
  const r = parseResolverJSON(
    '{"ecosystem":"Python","libraries":["numpy","numpy","scipy"],"searchTerms":["numpy tutorial"]}'
  );
  assert.equal(r.ecosystem, "python");
  assert.deepEqual(r.libraries, ["numpy", "scipy"]); // deduped, trimmed
  assert.deepEqual(r.searchTerms, ["numpy tutorial"]);
});

test("parseResolverJSON: tolerates prose/code-fence around the JSON", () => {
  const r = parseResolverJSON('Sure!\n```json\n{"libraries":["@tiptap/react"]}\n```\nHope that helps');
  assert.deepEqual(r.libraries, ["@tiptap/react"]);
});

test("parseResolverJSON: garbage or empty returns null (falls back to graph-only)", () => {
  assert.equal(parseResolverJSON("not json at all"), null);
  assert.equal(parseResolverJSON('{"libraries":[],"searchTerms":[]}'), null);
  assert.equal(parseResolverJSON(""), null);
});

// ---- golden: real captured snapshot of the partial-analysis fixture ---------
test("golden fixture: incomplete analysis is detected and graded honestly", () => {
  const { records, meta } = parseSnapshotNdjson(readFileSync(GOLDEN, "utf8"));

  // 1. the unparseable SQL file surfaced as a partial failure — NOT dropped.
  assert.ok(meta.partialFailures.length >= 1, "expected a partial failure");
  assert.ok(meta.partialFailures.some((f) => f.path.endsWith("legacy.sql")));
  assert.ok(meta.partialFailures.some((f) => f.code === "E_PARSE_ERROR"));
  assert.equal(meta.completenessLevel, "degraded");

  // 2. the fully-resolvable library usage still yields real, gradeable steps.
  const tiptapCalls = records.filter(
    (r) => (r.type === "CALLS" || r.type === "CONSTRUCTS") &&
      typeof r.to_id === "string" && r.to_id.startsWith("external:symbol:")
  );
  assert.ok(tiptapCalls.length >= 1, "expected resolvable external API calls");
  const apiStep = gradeStep(tiptapCalls, { partial: !!meta.partialFailures.length });
  assert.equal(apiStep.tier, TIERS.CONFIRMED, "import_external calls should grade confirmed");
  assert.equal(apiStep.verify, true, "…but partial analysis still forces verification");

  // 3. the recipe-level analysis flags the incompleteness for humans + agents.
  const repoMeta = {
    name: "partial-analysis",
    partialFailures: meta.partialFailures.map((f) => ({ path: f.path, code: f.code })),
    warnings: [],
    relationCount: meta.relations,
  };
  const analysis = buildAnalysis([repoMeta], "js");
  assert.equal(analysis.complete, false);
  assert.notEqual(analysis.confidence, "confirmed");
  assert.ok(analysis.reasons.length >= 1);
});

// ---- live end-to-end (skipped when `entire` is unavailable) -----------------
test("live: snapshotGraph reports the fixture's partial failure", { skip: !graphAvailable() }, () => {
  const tmp = mkdtempSync(join(tmpdir(), "rf-fixture-"));
  try {
    const repo = join(tmp, "repo");
    cpSync(FIXTURE_DIR, repo, { recursive: true });
    const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
    git("init");
    git("-c", "user.email=t@t.co", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@t.co", "-c", "user.name=t", "commit", "-m", "fixture");
    const { meta } = snapshotGraph(repo);
    assert.ok(meta.partialFailures.some((f) => f.path.endsWith("legacy.sql")));
    assert.equal(meta.completenessLevel, "degraded");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
