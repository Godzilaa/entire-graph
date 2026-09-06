// Recipe mining engine — powered by entire-graph.
//
//   node engine/mine.mjs [library]      (default: tiptap)
//
// For each real repo that uses the library it:
//   1. shallow-clones it into engine/.cache
//   2. runs `entire graph edges` (IMPORTS / CALLS / CONSTRUCTS)
//   3. filters edges to the library's modules + API symbols
//   4. aggregates frequencies + real file:line receipts across repos
//   5. writes lib/recipes.generated.json for the app to serve.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIBRARIES } from "./libraries.mjs";
import { edges, importedModule, graphAvailable } from "./graph.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE = join(__dirname, ".cache");
const OUT = join(ROOT, "lib", "recipes.generated.json");

const repoName = (url) => url.replace(/\.git$/, "").split("/").pop();
const tokenize = (s) => (s || "").split(/[^A-Za-z0-9_$]+/).filter(Boolean);
// collapse a module path to its installable package name
const basePkg = (mod) =>
  mod.startsWith("@") ? mod.split("/").slice(0, 2).join("/") : mod.split("/")[0];

function clone(url) {
  const dest = join(CACHE, repoName(url));
  if (existsSync(join(dest, ".git"))) return dest;
  mkdirSync(CACHE, { recursive: true });
  console.log(`  cloning ${url} …`);
  execFileSync(
    "git",
    ["clone", "--depth", "1", "--single-branch", url, dest],
    { stdio: ["ignore", "ignore", "inherit"], timeout: 180000 }
  );
  return dest;
}

function receipt(repo, url, file, line) {
  const label = `${repo}/${file}${line ? `:${line}` : ""}`;
  const href = `${url}/blob/HEAD/${file}${line ? `#L${line}` : ""}`;
  return { label, url: href };
}

function moduleMatches(mod, modules) {
  return modules.some((m) => mod === m || mod.startsWith(m + "/"));
}

function mine(libKey) {
  const spec = LIBRARIES[libKey];
  if (!spec) throw new Error(`unknown library: ${libKey}`);

  const repos = spec.repos.map((url) => {
    try {
      return { url, path: clone(url), name: repoName(url) };
    } catch (e) {
      console.warn(`  ! skip ${url}: ${e.message.split("\n")[0]}`);
      return null;
    }
  }).filter(Boolean);

  // pull edges once per repo
  for (const r of repos) {
    console.log(`  graphing ${r.name} …`);
    r.imports = edges(r.path, ["IMPORTS"]);
    r.calls = edges(r.path, ["CALLS", "CONSTRUCTS"]);
  }

  const total = repos.length;
  let callSites = 0;

  const steps = spec.steps.map((step) => {
    const hitRepos = new Set();
    const receipts = [];
    const seen = new Set();

    if (step.kind === "imports") {
      const perModule = new Map(); // module -> Set(repo)
      for (const r of repos) {
        for (const rec of r.imports) {
          const raw = importedModule(rec);
          if (!raw || !moduleMatches(raw, step.modules)) continue;
          const mod = basePkg(raw);
          hitRepos.add(r.name);
          if (!perModule.has(mod)) perModule.set(mod, new Set());
          perModule.get(mod).add(r.name);
          const ev = rec.evidence && rec.evidence[0];
          const key = `${r.name}:${ev?.file_path}`;
          if (ev?.file_path && !seen.has(key) && receipts.length < 4) {
            seen.add(key);
            receipts.push(receipt(r.name, r.url, ev.file_path, ev.start_line));
          }
        }
      }
      const ranked = [...perModule.entries()]
        .sort((a, b) => b[1].size - a[1].size)
        .map(([m, s]) => ({ m, n: s.size }));
      callSites += ranked.reduce((a, x) => a + x.n, 0);
      const installLine = ranked.filter((x) => x.n >= 1).map((x) => x.m).join(" ");
      return {
        name: step.name,
        freq: `${hitRepos.size}/${total}`,
        level: hitRepos.size >= Math.ceil(total / 2) ? "high" : "warn",
        code: installLine ? `npm i ${installLine}` : step.code,
        note:
          step.note +
          (ranked.length
            ? `  Most common: ${ranked.slice(0, 3).map((x) => `${x.m} (${x.n}/${total})`).join(", ")}.`
            : ""),
        receipts,
      };
    }

    // kind: "calls"
    for (const r of repos) {
      for (const rec of r.calls) {
        const ev = rec.evidence && rec.evidence[0];
        const called = ev?.detail || (rec.to_id ? rec.to_id.split(":").pop() : "");
        if (!tokenize(called).some((t) => step.symbols.includes(t))) continue;
        hitRepos.add(r.name);
        const key = `${r.name}:${ev?.file_path}:${ev?.start_line}`;
        if (ev?.file_path && !seen.has(key)) {
          seen.add(key);
          callSites += 1;
          if (receipts.length < 5)
            receipts.push(receipt(r.name, r.url, ev.file_path, ev.start_line));
        }
      }
    }
    return {
      name: step.name,
      freq: `${hitRepos.size}/${total}`,
      level: hitRepos.size >= Math.ceil(total / 2) ? "high" : "warn",
      code: step.code,
      note: step.note,
      receipts,
    };
  });

  return {
    id: spec.id,
    library: spec.library,
    title: spec.title,
    emphasis: spec.emphasis,
    reposMined: total,
    callSites,
    runnersUp: spec.runnersUp,
    keywords: spec.keywords,
    steps,
  };
}

// ---- run ----
if (!graphAvailable()) {
  console.error("entire-graph not available. Install: entire plugin install graph");
  process.exit(1);
}

const libKey = process.argv[2] || "tiptap";
console.log(`\n▶ mining "${libKey}" with entire-graph\n`);
const recipe = mine(libKey);

let all = [];
try {
  all = JSON.parse(readFileSync(OUT, "utf8"));
} catch {}
all = all.filter((r) => r.id !== recipe.id);
all.push(recipe);
writeFileSync(OUT, JSON.stringify(all, null, 2));

console.log(`\n✓ ${recipe.library}: ${recipe.reposMined} repos, ${recipe.callSites} sites`);
for (const s of recipe.steps) {
  console.log(`  • ${s.name.padEnd(32)} ${s.freq}  (${s.receipts.length} receipts)`);
}
console.log(`\n→ wrote ${OUT}\n`);
