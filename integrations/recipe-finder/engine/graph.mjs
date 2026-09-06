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

// Stream relation records of the given types for a repo. Returns parsed
// { record_type:"relation", from_id, to_id, type, evidence:[{file_path,start_line,detail}] }
export function edges(repoPath, relations, { worktree = false } = {}) {
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
  for (const line of out.split("\n")) {
    if (!line || line[0] !== "{") continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.record_type === "relation") recs.push(obj);
  }
  return recs;
}

// module name from an IMPORTS edge, e.g. "external:import:@tiptap/react" -> "@tiptap/react"
export function importedModule(rec) {
  if (typeof rec.to_id === "string" && rec.to_id.startsWith("external:import:")) {
    return rec.to_id.slice("external:import:".length);
  }
  const ev = rec.evidence && rec.evidence[0];
  return ev && ev.detail ? ev.detail : null;
}
