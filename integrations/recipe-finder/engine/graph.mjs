// Thin adapter over the `entire graph` CLI (entire-graph plugin).
// This is the ONLY place that shells out to entire-graph — swap the impl here
// if the CLI surface changes.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const ENTIRE =
  process.env.ENTIRE_BIN ||
  [`${process.env.HOME}/.local/bin/entire`, "/usr/local/bin/entire", "entire"].find(
    (p) => p === "entire" || existsSync(p)
  );

export function graphAvailable() {
  try {
    execFileSync(ENTIRE, ["graph", "capabilities", "--json"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

// Run `entire graph edges` and parse the NDJSON into { records, meta }.
//
// The first NDJSON line is the snapshot HEADER — it carries the evidence-quality
// signals the recipe engine must NOT discard: `partial_failures` (files the
// parser could not read), `warnings`, `skipped_relation_families`, and the
// completeness breakdown. Every relation record keeps its `resolution` +
// `confidence` so downstream grading (engine/evidence.mjs) can tell confirmed
// structural evidence apart from name-only guesses. See "the graph is evidence,
// not an oracle."
export function edgesWithMeta(repoPath, relations, { worktree = false } = {}) {
  const args = [
    "graph", "edges",
    "--repo", repoPath,
    "--relation", relations.join(","),
    "--format", "ndjson",
  ];
  if (worktree) args.push("--worktree");

  let out = "";
  try {
    out = execFileSync(ENTIRE, args, {
      maxBuffer: 1024 * 1024 * 1024,
      encoding: "utf8",
      timeout: 120000, // don't let a huge repo hang the pipeline
    });
  } catch (e) {
    out = e.stdout ? e.stdout.toString() : "";
  }

  const recs = [];
  let header = null;
  for (const line of out.split("\n")) {
    if (!line || line[0] !== "{") continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.record_type === "relation") recs.push(obj);
    else if (header === null && obj.record_type === undefined && obj.schema_version) header = obj;
  }
  return { records: recs, meta: snapshotMeta(header, recs) };
}

// Distill the edges header into whatever partial-analysis signal it carries.
// NOTE: `entire graph edges` streams relations and does NOT compute the parse
// summary, so partial_failures is usually empty here — use snapshotGraph() when
// you need authoritative completeness. Kept for the header's relation set / warnings.
function snapshotMeta(header, records) {
  const h = header || {};
  const stats = h.stats || {};
  return {
    partialFailures: normFailures(h.partial_failures),
    warnings: h.warnings || [],
    skippedRelationFamilies: h.skipped_relation_families || [],
    completenessLevel: stats.completeness_level || "",
    parsedFiles: stats.parsed_files ?? null,
    files: stats.files ?? null,
    relationCount: records.length,
  };
}

function normFailures(list) {
  return (list || []).map((f) => ({
    path: typeof f === "string" ? f : f.file_path || f.path || f.file || "",
    code: typeof f === "string" ? "" : f.code || f.reason || "",
    detail: typeof f === "string" ? "" : f.detail || "",
  }));
}

// Back-compat: many call sites just want the relation records. Kept as a thin
// wrapper over edgesWithMeta so nothing that predates evidence grading breaks.
export function edges(repoPath, relations, opts = {}) {
  return edgesWithMeta(repoPath, relations, opts).records;
}

// Run `entire graph snapshot` and return BOTH the relation records and the
// authoritative completeness signal from the trailing `summary` record:
//   partial_failures (E_PARSE_ERROR files), language_tiers (which languages are
//   inventory-only, i.e. no relations), and completeness_level ("ok"/"degraded").
// This is the single source of truth for "was this repo fully analyzable?" — the
// graph-is-evidence-not-oracle core. One call gives relations + completeness, so
// the miner sees exactly the same edges as `edges` PLUS why they might be partial.
export function snapshotGraph(repoPath, { worktree = false } = {}) {
  const args = ["graph", "snapshot", "--repo", repoPath, "--format", "ndjson"];
  if (worktree) args.push("--worktree");

  let out = "";
  try {
    out = execFileSync(ENTIRE, args, {
      maxBuffer: 1024 * 1024 * 1024,
      encoding: "utf8",
      timeout: 180000,
    });
  } catch (e) {
    out = e.stdout ? e.stdout.toString() : "";
  }
  return parseSnapshotNdjson(out);
}

// Pure parse of a snapshot NDJSON stream into { records, meta }. Exported so the
// evidence tests can drive it from a captured golden without a live `entire`.
export function parseSnapshotNdjson(out) {
  const records = [];
  let summary = null;
  for (const line of (out || "").split("\n")) {
    if (!line || line[0] !== "{") continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.record_type === "relation") records.push(obj);
    else if (obj.record_type === "summary") summary = obj;
  }
  return { records, meta: summaryMeta(summary, records) };
}

// Turn the snapshot `summary` record into the partial-analysis signals the grader
// consumes. Tolerates a missing summary (empty repo / older CLI).
function summaryMeta(summary, records) {
  const s = summary || {};
  const stats = s.stats || {};
  const tiers = s.language_tiers || {};
  const inventoryOnly = Object.entries(tiers)
    .filter(([, t]) => t === "inventory-only")
    .map(([lang]) => lang);
  return {
    partialFailures: normFailures(s.partial_failures),
    warnings: s.warnings || [],
    languageTiers: tiers,
    inventoryOnlyLanguages: inventoryOnly,
    completenessLevel: stats.completeness_level || "",
    relations: stats.relations ?? records.length,
    symbols: stats.symbols ?? null,
    parsedFiles: stats.parsed_files ?? null,
    files: stats.files ?? null,
  };
}

// module name from an IMPORTS edge, e.g. "external:import:@tiptap/react" -> "@tiptap/react"
export function importedModule(rec) {
  if (typeof rec.to_id === "string" && rec.to_id.startsWith("external:import:")) {
    return rec.to_id.slice("external:import:".length);
  }
  const ev = rec.evidence && rec.evidence[0];
  return ev && ev.detail ? ev.detail : null;
}
