// Goal-driven, on-demand recipe generation — the real skill.
//
//   node engine/cli.mjs generate "<end goal>" [--package <pkg>] [--repos a,b,c]
//
// No hardcoded libraries. The ENGINE mines cleanly; the INTELLIGENCE
// (goal -> library + which repos) is best supplied by the calling agent via
// --package / --repos. With only a goal it falls back to best-effort discovery.
//
// Pipeline: discover repos -> mine with `entire graph edges` -> derive the
// playbook from the graph (top imported packages + top called library APIs),
// every step carrying real receipts + a real source line.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotGraph, importedModule } from "./graph.mjs";
import { detectLang, langConfig } from "./langs.mjs";
import { gradeStep, stepCaveat, buildAnalysis } from "./evidence.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE = join(__dirname, ".cache");
const OUT = join(ROOT, "lib", "recipes.generated.json");

// Local (in-process) path stays cheap at 3 repos; the Databricks scale path
// (engine/ingest-databricks.mjs) passes a larger cap into discoverRepos().
const MAX_REPOS = 3;
const MAX_REPO_KB = 30_000; // prefer small, focused example repos

const PKG_DENY = new Set([
  "react", "react-dom", "next", "vue", "svelte", "typescript", "vite", "webpack",
  "eslint", "prettier", "tailwindcss", "@types/node", "@types/react",
  "@types/react-dom", "zod", "clsx", "classnames", "dotenv", "express",
  "@vitejs/plugin-react", "postcss", "autoprefixer",
  // icon / util noise that drowns out the real library
  "lucide-react", "react-icons", "@heroicons/react", "@radix-ui/react-icons",
  "uuid", "nanoid", "date-fns", "dayjs", "lodash", "lodash-es", "axios",
  "framer-motion", "@tailwindcss/vite",
  // UI kits — incidental to most goals, drown out the domain library
  "@chakra-ui/react", "@chakra-ui/icons", "@mui/material", "@mui/icons-material",
  "@emotion/react", "@emotion/styled", "antd", "@mantine/core", "@mantine/hooks",
  "bootstrap", "react-bootstrap", "@radix-ui/react-slot", "styled-components",
]);
const SYM_DENY = new Set([
  "useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext",
  "useReducer", "useLayoutEffect", "useImperativeHandle", "useId", "useRouter",
  "useSearchParams", "usePathname", "useTheme", "useForm",
]);

const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Keyword matching — kept in sync with lib/recipes.ts. Stopwords must never act
// as keywords, or a random query matches a stale recipe instead of missing.
export const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "with", "app",
  "apps", "react", "vue", "svelte", "build", "building", "using", "use", "my",
  "your", "how", "do", "i", "is", "it", "that", "this", "want", "need", "make",
  "web", "site", "page",
]);
export const DISTINCTIVE_LEN = 6;
const normKw = (s) => (s || "").toLowerCase().replace(/[-_]/g, " ").trim();

// mirror of lib/recipes.ts::matchScore — phrase hit, OR two distinct word hits,
// OR one distinctive long word; otherwise a lone generic word must not match.
export function matchScore(query, keywords) {
  const nq = normKw(query);
  if (!nq) return { score: 0, accept: false };
  const tokens = new Set(nq.split(/\s+/).filter(Boolean));
  let score = 0, phraseHits = 0, tokenHits = 0, bestLoneLen = 0;
  for (const raw of keywords || []) {
    if (!raw || STOPWORDS.has(raw.toLowerCase().trim())) continue;
    const kw = normKw(raw);
    if (!kw) continue;
    if (kw.includes(" ")) {
      if (nq.includes(kw)) { score += kw.length; phraseHits++; }
    } else if (tokens.has(kw)) {
      score += kw.length; tokenHits++; bestLoneLen = Math.max(bestLoneLen, kw.length);
    }
  }
  return { score, accept: phraseHits >= 1 || tokenHits >= 2 || bestLoneLen >= DISTINCTIVE_LEN };
}

export function keywordsFromGoal(goal) {
  const g = goal.toLowerCase().trim();
  const words = g.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set([g, ...words].filter(Boolean))];
}
export const repoName = (url) => url.replace(/\.git$/, "").split("/").pop();
export const basePkg = (m) =>
  m.startsWith("@") ? m.split("/").slice(0, 2).join("/") : m.split("/")[0];
export const isSource = (f) => !!f && /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(f);

// ---- discovery -------------------------------------------------------------
function sizeOK(fullName) {
  try {
    const kb = parseInt(sh("gh", ["api", `repos/${fullName}`, "--jq", ".size"]).trim(), 10);
    if (kb && kb > MAX_REPO_KB) {
      console.error(`    skip ${fullName} (${Math.round(kb / 1000)}MB)`);
      return false;
    }
  } catch {}
  return true;
}

export function discoverRepos(goal, pkg, maxRepos = MAX_REPOS) {
  const picked = [];
  const seen = new Set();
  try {
    if (pkg) {
      // repos that ACTUALLY import the package (grounded)
      console.error(`  discovering repos that import ${pkg} …`);
      const out = sh("gh", [
        "search", "code", pkg, "--language", "typescript",
        "--limit", String(Math.max(30, maxRepos * 4)), "--json", "repository",
      ]);
      for (const it of JSON.parse(out)) {
        const full = it.repository?.nameWithOwner;
        const url = it.repository?.url;
        if (!full || seen.has(full)) continue;
        seen.add(full);
        if (picked.length < maxRepos && sizeOK(full)) picked.push(url);
      }
    }
    if (picked.length < maxRepos) {
      console.error(`  discovering repos for "${goal}" …`);
      const out = sh("gh", [
        "search", "repos", goal, "--language", "typescript",
        "--sort", "stars", "--limit", String(Math.max(12, maxRepos * 3)), "--json", "fullName,url",
      ]);
      for (const r of JSON.parse(out)) {
        if (seen.has(r.fullName)) continue;
        seen.add(r.fullName);
        if (picked.length < maxRepos && sizeOK(r.fullName)) picked.push(r.url);
      }
    }
    if (picked.length < maxRepos) {
      // Any-language fallback — the engine is language-aware (see langs.mjs), so
      // Python/Java/Go/Ruby/etc. repos are mined too. TS/JS are tried first
      // (above) so web goals still prefer the JS ecosystem; this widens to
      // everything else when a goal has few/no JS repos.
      console.error(`  discovering repos for "${goal}" (any language) …`);
      const out = sh("gh", [
        "search", "repos", goal,
        "--sort", "stars", "--limit", String(Math.max(12, maxRepos * 3)), "--json", "fullName,url",
      ]);
      for (const r of JSON.parse(out)) {
        if (seen.has(r.fullName)) continue;
        seen.add(r.fullName);
        if (picked.length < maxRepos && sizeOK(r.fullName)) picked.push(r.url);
      }
    }
  } catch (e) {
    console.warn("  ! discovery failed:", e.message.split("\n")[0]);
  }
  return picked;
}

export function clone(url) {
  // Key the cache dir by the full owner/name so two repos that share a short
  // name (e.g. different owners' "dragon-tiger-game") don't overwrite each other.
  const dest = join(
    CACHE,
    url.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/[^A-Za-z0-9._-]+/g, "__")
  );
  if (existsSync(join(dest, ".git"))) return dest;
  mkdirSync(CACHE, { recursive: true });
  console.error(`  cloning ${url} …`);
  try {
    execFileSync("git", ["clone", "--depth", "1", "--single-branch", url, dest], {
      stdio: ["ignore", "ignore", "ignore"], timeout: 180000,
    });
    return dest;
  } catch {
    return null;
  }
}

// ---- helpers ---------------------------------------------------------------
const receipt = (repo, url, file, line) => ({
  label: `${repo}/${file}${line ? `:${line}` : ""}`,
  url: `${url}/blob/HEAD/${file}${line ? `#L${line}` : ""}`,
});
function snippet(repoPath, file, line) {
  if (!file || !line) return null;
  try {
    const l = readFileSync(join(repoPath, file), "utf8").split("\n")[line - 1] || "";
    return l.trim().slice(0, 160);
  } catch {
    return null;
  }
}

// ---- main ------------------------------------------------------------------
export function generate(goal, opts = {}) {
  const repoUrls = opts.repos?.length ? opts.repos : discoverRepos(goal, opts.package);
  const repos = repoUrls
    .map((url) => {
      const path = clone(url);
      return path ? { url, path, name: repoName(url) } : null;
    })
    .filter(Boolean);
  if (!repos.length) throw new Error("no repos could be discovered/cloned for this goal");

  for (const r of repos) {
    console.error(`  graphing ${r.name} …`);
    // One snapshot yields the SAME edges the miner needs PLUS the authoritative
    // completeness signal (partial_failures, inventory-only languages) — so a
    // parse failure or a blind language is never silently dropped from a recipe.
    const g = snapshotGraph(r.path);
    r.imports = g.records.filter((x) => x.type === "IMPORTS");
    r.calls = g.records.filter((x) => x.type === "CALLS" || x.type === "CONSTRUCTS");
    r.snap = g.meta;
    r.meta = {
      name: r.name,
      partialFailures: g.meta.partialFailures.map((f) => ({ path: f.path, code: f.code })),
      warnings: g.meta.warnings || [],
      inventoryOnlyLanguages: g.meta.inventoryOnlyLanguages || [],
      completenessLevel: g.meta.completenessLevel || "",
      // A repo that produced no relations at all is a blind spot (inventory-only
      // language or an all-failed parse), not a confirmed absence of the pattern.
      relationCount: g.meta.relations ?? g.records.length,
    };
  }
  // Detect each repo's language, then pick ONE dominant stack and mine only
  // those repos — a recipe must target a single ecosystem (mixing e.g. Java +
  // Python game repos into one playbook is incoherent). Package resolution,
  // install command, and API filtering all come from that language's config
  // (langs.mjs), so the engine covers every language entire-graph resolves —
  // not just JS/TS. opts.lang forces the choice.
  for (const r of repos) {
    const files = [...r.imports, ...r.calls]
      .map((rec) => rec.evidence?.[0]?.file_path)
      .filter(Boolean);
    r.lang = detectLang(files);
  }
  let langKey = opts.lang;
  if (!langKey) {
    const langCount = new Map();
    for (const r of repos) langCount.set(r.lang, (langCount.get(r.lang) || 0) + 1);
    langKey = [...langCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "default";
  }
  const mined = repos.filter((r) => r.lang === langKey);
  const repoSet = mined.length ? mined : repos;
  const total = repoSet.length;
  const L = langConfig(langKey);

  // Partial-analysis bookkeeping (the graph-is-evidence-not-oracle core): which
  // mined repos had files the parser could not read (partialFailures) and which
  // produced NO relations at all (a blind spot — inventory-only language or an
  // all-failed parse). These gate whether a step may be called "confirmed".
  const partialRepoNames = new Set(
    repoSet.filter((r) => (r.meta?.partialFailures?.length || 0) > 0).map((r) => r.name)
  );
  const blindRepoNames = new Set(
    repoSet.filter((r) => (r.meta?.relationCount || 0) === 0).map((r) => r.name)
  );

  // resolve library (agent-supplied wins; else dominant imported package root)
  const pkgRepos = new Map();
  const pkgReceipt = new Map();
  const pkgRecords = new Map(); // root -> backing IMPORTS records, for grading
  for (const r of repoSet) {
    for (const rec of r.imports) {
      const root = L.root(importedModule(rec));
      if (!root) continue; // relative import, stdlib, or framework noise
      if (!pkgRepos.has(root)) { pkgRepos.set(root, new Set()); pkgRecords.set(root, []); }
      pkgRepos.get(root).add(r.name);
      pkgRecords.get(root).push(rec);
      const ev = rec.evidence?.[0];
      if (ev?.file_path && !pkgReceipt.has(root))
        pkgReceipt.set(root, receipt(r.name, r.url, ev.file_path, ev.start_line));
    }
  }
  const rankedPkgs = [...pkgRepos.entries()].sort((a, b) => b[1].size - a[1].size);
  const library = opts.package || rankedPkgs[0]?.[0] || "unknown";
  // Honest miss: the discovered repos import nothing installable (only stdlib,
  // or plain logic with no shared library). Surface a clean "no recipe".
  if (library === "unknown") {
    throw new Error(
      "no shared library found for this goal — the discovered repos import nothing installable"
    );
  }
  const famPrefix = L.famPrefix(library);
  const family = rankedPkgs.filter(([p]) => p === library || p.startsWith(famPrefix));
  const familyPkgs = new Set(family.map(([p]) => p));
  if (opts.package && !familyPkgs.has(library)) familyPkgs.add(library);
  const displayLib = L.installName(library);

  // ---- Install step ----
  const steps = [];
  const installPkgs = opts.package ? [...familyPkgs] : family.map(([p]) => p);
  const famCounts = installPkgs.map((p) => pkgRepos.get(p)?.size || 1);
  const installNames = installPkgs.map((p) => L.installName(p));
  const installRecords = installPkgs.flatMap((p) => pkgRecords.get(p) || []);
  const installBackers = new Set(installPkgs.flatMap((p) => [...(pkgRepos.get(p) || [])]));
  const installEvidence = gradeStep(installRecords, {
    partial: blindRepoNames.size > 0 || [...installBackers].some((n) => partialRepoNames.has(n)),
  });
  steps.push({
    name: "Install",
    freq: `${Math.max(1, ...famCounts)}/${total}`,
    level: "high",
    code: L.install(installNames),
    note: `Dependencies the mined repos import together${
      family.length
        ? `. Most common: ${family.slice(0, 3).map(([p, s]) => `${L.installName(p)} (${s.size}/${total})`).join(", ")}`
        : ""
    }.`,
    evidence: installEvidence,
    caveat: stepCaveat(installEvidence),
    receipts: installPkgs.map((p) => pkgReceipt.get(p)).filter(Boolean).slice(0, 4),
  });

  // ---- API steps: calls/constructs that RESOLVE TO AN EXTERNAL SYMBOL of the
  // library family. Keying off the resolved external target (not the raw call
  // text) is what keeps this honest across languages: internal method calls and
  // annotations are excluded, so a language whose call graph doesn't resolve
  // external APIs yields fewer steps rather than noise.
  const symRepos = new Map();
  const symReceipts = new Map();
  const symSnippet = new Map();
  const symRecords = new Map(); // name -> backing CALLS/CONSTRUCTS records
  for (const r of repoSet) {
    for (const rec of r.calls) {
      if (typeof rec.to_id !== "string" || !rec.to_id.startsWith("external:symbol:")) continue;
      const extPath = rec.to_id.slice("external:symbol:".length); // e.g. @tiptap/react.useEditor
      if (extPath !== library && !extPath.startsWith(famPrefix)) continue; // library family only
      const name = extPath.split(/[^A-Za-z0-9_$]+/).filter(Boolean).pop();
      if (!L.notable(name)) continue;
      const ev = rec.evidence?.[0];
      if (!ev?.file_path) continue;
      if (!symRepos.has(name)) {
        symRepos.set(name, new Set());
        symReceipts.set(name, []);
        symRecords.set(name, []);
      }
      symRepos.get(name).add(r.name);
      symRecords.get(name).push(rec);
      const arr = symReceipts.get(name);
      const key = `${r.name}:${ev.file_path}:${ev.start_line}`;
      if (arr.length < 4 && !arr.some((x) => x._k === key)) {
        arr.push({ ...receipt(r.name, r.url, ev.file_path, ev.start_line), _k: key });
        if (!symSnippet.has(name)) {
          const sn = snippet(r.path, ev.file_path, ev.start_line);
          if (sn) symSnippet.set(name, sn);
        }
      }
    }
  }
  const rankedSyms = [...symRepos.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5);

  let callSites = installPkgs.length;
  for (const [name, set] of rankedSyms) {
    const receipts = (symReceipts.get(name) || []).map(({ _k, ...r }) => r);
    callSites += receipts.length;
    // Library API calls resolve to an EXTERNAL symbol by name only, so they are
    // inherently heuristic evidence — grade them honestly rather than stamping
    // them "verified". A parse gap in a backing repo (or any blind repo)
    // downgrades further.
    const partial = blindRepoNames.size > 0 || [...set].some((n) => partialRepoNames.has(n));
    const evidence = gradeStep(symRecords.get(name) || [], { partial });
    steps.push({
      name,
      freq: `${set.size}/${total}`,
      level: set.size >= Math.ceil(total / 2) ? "high" : "warn",
      code: symSnippet.get(name) || `${name}(…)`,
      note: `A ${displayLib} API used across ${set.size}/${total} mined repos.`,
      evidence,
      caveat: stepCaveat(evidence),
      receipts,
    });
  }

  const analysis = buildAnalysis(repoSet.map((r) => r.meta), langKey);

  return {
    id: slug(goal),
    library: displayLib,
    title: goal.charAt(0).toUpperCase() + goal.slice(1),
    emphasis: "",
    reposMined: total,
    callSites,
    runnersUp: rankedPkgs.filter(([p]) => !familyPkgs.has(p)).slice(0, 3).map(([p]) => L.installName(p)).join(", ") || "—",
    keywords: keywordsFromGoal(goal),
    steps,
    analysis,
    sources: repoSet.map((r) => r.url),
  };
}

export function saveRecipe(recipe) {
  let all = [];
  try {
    all = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {}
  all = all.filter((r) => r.id !== recipe.id);
  all.push(recipe);
  writeFileSync(OUT, JSON.stringify(all, null, 2));
}
