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
import { edges, importedModule } from "./graph.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE = join(__dirname, ".cache");
const OUT = join(ROOT, "lib", "recipes.generated.json");

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
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const repoName = (url) => url.replace(/\.git$/, "").split("/").pop();
const basePkg = (m) =>
  m.startsWith("@") ? m.split("/").slice(0, 2).join("/") : m.split("/")[0];
const isSource = (f) => !!f && /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/.test(f);

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

function discoverRepos(goal, pkg) {
  const picked = [];
  const seen = new Set();
  try {
    if (pkg) {
      // repos that ACTUALLY import the package (grounded)
      console.error(`  discovering repos that import ${pkg} …`);
      const out = sh("gh", [
        "search", "code", pkg, "--language", "typescript",
        "--limit", "30", "--json", "repository",
      ]);
      for (const it of JSON.parse(out)) {
        const full = it.repository?.nameWithOwner;
        const url = it.repository?.url;
        if (!full || seen.has(full)) continue;
        seen.add(full);
        if (picked.length < MAX_REPOS && sizeOK(full)) picked.push(url);
      }
    }
    if (picked.length < MAX_REPOS) {
      console.error(`  discovering repos for "${goal}" …`);
      const out = sh("gh", [
        "search", "repos", goal, "--language", "typescript",
        "--sort", "stars", "--limit", "12", "--json", "fullName,url",
      ]);
      for (const r of JSON.parse(out)) {
        if (seen.has(r.fullName)) continue;
        seen.add(r.fullName);
        if (picked.length < MAX_REPOS && sizeOK(r.fullName)) picked.push(r.url);
      }
    }
  } catch (e) {
    console.warn("  ! discovery failed:", e.message.split("\n")[0]);
  }
  return picked;
}

function clone(url) {
  const dest = join(CACHE, repoName(url));
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
    r.imports = edges(r.path, ["IMPORTS"]).filter((e) => isSource(e.evidence?.[0]?.file_path));
    r.calls = edges(r.path, ["CALLS", "CONSTRUCTS"]).filter((e) => isSource(e.evidence?.[0]?.file_path));
  }
  const total = repos.length;

  // resolve library (agent-supplied wins; else dominant external package)
  const pkgRepos = new Map();
  const pkgReceipt = new Map();
  for (const r of repos) {
    for (const rec of r.imports) {
      const mod = importedModule(rec);
      if (!mod || mod.startsWith(".") || mod.startsWith("node:")) continue;
      const base = basePkg(mod);
      if (PKG_DENY.has(base)) continue;
      if (!pkgRepos.has(base)) pkgRepos.set(base, new Set());
      pkgRepos.get(base).add(r.name);
      const ev = rec.evidence?.[0];
      if (ev?.file_path && !pkgReceipt.has(base))
        pkgReceipt.set(base, receipt(r.name, r.url, ev.file_path, ev.start_line));
    }
  }
  const rankedPkgs = [...pkgRepos.entries()].sort((a, b) => b[1].size - a[1].size);
  const library = opts.package || rankedPkgs[0]?.[0] || "unknown";
  const famPrefix = library.startsWith("@") ? library.split("/")[0] : library;
  const family = rankedPkgs.filter(([p]) => p === library || p.startsWith(famPrefix));
  const familyPkgs = new Set(family.map(([p]) => p));
  if (opts.package && !familyPkgs.has(library)) familyPkgs.add(library);

  // per-repo: which source files import the library family (co-location filter)
  for (const r of repos) {
    r.libFiles = new Set();
    for (const rec of r.imports) {
      const mod = importedModule(rec);
      if (!mod) continue;
      if (mod === library || mod.startsWith(famPrefix)) {
        const f = rec.evidence?.[0]?.file_path;
        if (f) r.libFiles.add(f);
      }
    }
  }

  // ---- Install step ----
  const steps = [];
  const installPkgs = (opts.package ? [...familyPkgs] : family.map(([p]) => p));
  const famCounts = installPkgs.map((p) => (pkgRepos.get(p)?.size || 1));
  steps.push({
    name: "Install",
    freq: `${Math.max(1, ...famCounts)}/${total}`,
    level: "high",
    code: `npm i ${installPkgs.join(" ")}`,
    note: `Packages the mined repos import together${
      family.length
        ? `. Most common: ${family.slice(0, 3).map(([p, s]) => `${p} (${s.size}/${total})`).join(", ")}`
        : ""
    }.`,
    receipts: installPkgs.map((p) => pkgReceipt.get(p)).filter(Boolean).slice(0, 4),
  });

  // ---- API steps: called/constructed symbols co-located with a library import
  const symRepos = new Map();
  const symReceipts = new Map();
  const symSnippet = new Map();
  for (const r of repos) {
    for (const rec of r.calls) {
      const ev = rec.evidence?.[0];
      if (!ev?.file_path || !r.libFiles.has(ev.file_path)) continue; // must be a library file
      const raw = ev.detail || (rec.to_id ? rec.to_id.split(":").pop() : "");
      const name = (raw || "").split(/[^A-Za-z0-9_$]+/).filter(Boolean).pop();
      if (!name || name.length < 3 || SYM_DENY.has(name)) continue;
      if (!/^[A-Z]/.test(name) && !/^use[A-Z]/.test(name)) continue;
      if (!symRepos.has(name)) {
        symRepos.set(name, new Set());
        symReceipts.set(name, []);
      }
      symRepos.get(name).add(r.name);
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
    steps.push({
      name,
      freq: `${set.size}/${total}`,
      level: set.size >= Math.ceil(total / 2) ? "high" : "warn",
      code: symSnippet.get(name) || `${name}(…)`,
      note: `A ${library} API used across ${set.size}/${total} mined repos.`,
      receipts,
    });
  }

  return {
    id: slug(goal),
    library,
    title: goal.charAt(0).toUpperCase() + goal.slice(1),
    emphasis: "",
    reposMined: total,
    callSites,
    runnersUp: rankedPkgs.filter(([p]) => !familyPkgs.has(p)).slice(0, 3).map(([p]) => p).join(", ") || "—",
    keywords: [goal.toLowerCase(), ...goal.toLowerCase().split(/\s+/)],
    steps,
    sources: repos.map((r) => r.url),
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
