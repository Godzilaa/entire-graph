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

function printRecipe(r) {
  console.log(`\n  RECIPE  ${r.library} — ${r.title} ${r.emphasis}`);
  console.log(
    `  mined from ${r.reposMined} repos · ${r.callSites} call sites · runners-up: ${r.runnersUp}\n`
  );
  r.steps.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name}   [${s.level === "high" ? "✓" : "⚠"} ${s.freq} repos]`);
    if (s.code) console.log(s.code.split("\n").map((l) => "       " + l).join("\n"));
    if (s.note) console.log("     " + s.note);
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
