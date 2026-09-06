#!/usr/bin/env node
// recipe — CLI entry for the integration-recipe engine (powered by entire-graph).
//
//   node engine/cli.mjs query "<what you're building>"   Find a recipe (--json for raw)
//   node engine/cli.mjs mine  <library>                  Re-mine a library with entire-graph
//   node engine/cli.mjs list                             List mined recipes
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generate, saveRecipe, matchScore } from "./generate.mjs";
import { resolveCandidates, resolverEnabled } from "./resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CORPUS = join(ROOT, "lib", "recipes.generated.json");

function load() {
  try {
    return JSON.parse(readFileSync(CORPUS, "utf8"));
  } catch {
    return [];
  }
}

// same keyword scoring as the web app's findRecipe()
function findRecipe(query) {
  let best = null;
  let bestScore = 0;
  for (const r of load()) {
    const { score, accept } = matchScore(query, r.keywords || []);
    if (accept && score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

const TIER_TAG = {
  confirmed: "✓ confirmed",
  heuristic: "≈ heuristic·verify",
  unverified: "? unverified·check source",
};

function printRecipe(r) {
  console.log(`\n  RECIPE  ${r.library} — ${r.title} ${r.emphasis}`);
  console.log(
    `  mined from ${r.reposMined} repos · ${r.callSites} call sites · runners-up: ${r.runnersUp}`
  );
  if (r.resolver) {
    console.log(
      `  LLM suggested: ${(r.resolver.suggested || []).join(", ") || "—"} → graph confirmed: ${r.resolver.confirmed}`
    );
  }
  // Evidence honesty banner — "the graph is evidence, not an oracle."
  const a = r.analysis;
  if (a && !a.complete) {
    console.log(`\n  ⚠ PARTIAL ANALYSIS (${a.confidence}). Missing steps may just be unanalyzed, not absent.`);
    for (const reason of (a.reasons || []).slice(0, 4)) console.log(`     - ${reason}`);
    if (a.verify) console.log(`     → ${a.verify}`);
  } else if (a && a.complete) {
    console.log(`\n  ✅ Full analysis: all ${a.reposMined} repos parsed cleanly. Tiers below grade each step's evidence.`);
  }
  console.log();
  r.steps.forEach((s, i) => {
    const tier = s.evidence?.tier ? `  [${TIER_TAG[s.evidence.tier] || s.evidence.tier}]` : "";
    console.log(`  ${i + 1}. ${s.name}   [${s.level === "high" ? "✓" : "⚠"} ${s.freq} repos]${tier}`);
    if (s.code) console.log(s.code.split("\n").map((l) => "       " + l).join("\n"));
    if (s.note) console.log("     " + s.note);
    if (s.caveat) console.log("     ⓘ " + s.caveat);
    s.receipts.forEach((x) => console.log("       ↗ " + x.label));
    console.log();
  });
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const wantJson = argv.includes("--json");
const rest = argv.slice(1).filter((a) => a !== "--json");

if (cmd === "query" || cmd === "recipe") {
  const query = rest.join(" ");
  const r = findRecipe(query);
  if (!r) {
    console.error(`No recipe for "${query}". See: node engine/cli.mjs list`);
    process.exit(1);
  }
  if (wantJson) console.log(JSON.stringify(r, null, 2));
  else printRecipe(r);
} else if (cmd === "generate" || cmd === "goal") {
  // goal-driven, on-demand: discover repos → mine → derive playbook
  const flags = {};
  const words = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--repos") flags.repos = (rest[++i] || "").split(",").filter(Boolean);
    else if (rest[i] === "--package") flags.package = rest[++i];
    else words.push(rest[i]);
  }
  const goal = words.join(" ");
  if (!goal) {
    console.error('Usage: node engine/cli.mjs generate "<end goal>"');
    process.exit(1);
  }
  console.error(`\n▶ generating recipe for goal: "${goal}"\n`);
  // Optional LLM resolver (only in pure-auto mode — the agent's own --package /
  // --repos always win). Proposes candidate libraries + search terms; the graph
  // still verifies. No-op unless ANTHROPIC_API_KEY is set.
  if (!flags.package && !flags.repos?.length && resolverEnabled()) {
    console.error("  resolving candidate libraries with LLM …");
    const r = await resolveCandidates(goal);
    if (r) {
      flags.candidates = r.libraries;
      flags.searchTerms = r.searchTerms;
      flags.ecosystem = r.ecosystem;
      flags.resolverModel = r.model;
      console.error(`  LLM suggested: ${(r.libraries || []).join(", ") || "—"} (ecosystem: ${r.ecosystem || "?"})`);
    }
  }
  const recipe = generate(goal, flags);
  saveRecipe(recipe);
  if (wantJson) console.log(JSON.stringify(recipe, null, 2));
  else {
    printRecipe(recipe);
    console.log(`  sources: ${(recipe.sources || []).join(", ")}`);
    console.log(`  saved to corpus as "${recipe.id}"\n`);
  }
} else if (cmd === "mine") {
  const res = spawnSync("node", [join(__dirname, "mine.mjs"), ...rest], { stdio: "inherit" });
  process.exit(res.status ?? 0);
} else if (cmd === "ingest") {
  // fan the parse across many repos → land raw edges in Databricks code_edges;
  // aggregate with lib/corpus.ts::deriveRecipe() / databricks/derive.sql
  const res = spawnSync("node", [join(__dirname, "ingest-databricks.mjs"), ...rest], { stdio: "inherit" });
  process.exit(res.status ?? 0);
} else if (cmd === "list") {
  const all = load();
  if (!all.length) console.log("No recipes yet. Run: node engine/cli.mjs mine tiptap");
  for (const r of all)
    console.log(`${r.library.padEnd(14)} ${r.title} ${r.emphasis}  (${r.reposMined} repos)`);
} else {
  console.log(`recipe — integration recipes mined from real repos (entire-graph)

Usage:
  node engine/cli.mjs generate "<end goal>" [--package P] [--repos a,b]  Discover + mine + derive locally (add --json)
  node engine/cli.mjs ingest   "<end goal>" [--package P] [--max-repos N]  Land raw edges in Databricks (scale path)
  node engine/cli.mjs query "<goal>"                   Search the mined corpus (instant)
  node engine/cli.mjs mine <library>                   Re-mine an authored library spec
  node engine/cli.mjs list                             List mined recipes`);
}
