// Databricks-backed recipe corpus — the lakehouse serving layer.
// Reads/writes workspace.recipe.recipes via the SQL Statement Execution API.
// If the DATABRICKS_* env vars are absent, corpusEnabled() is false and the
// API route falls back to the local JSON corpus.
import type { Recipe, Step, Receipt, Evidence, Analysis } from "./recipes";
import { matchScore, keywordsFromGoal } from "./recipes";

// The Spark scale path aggregates raw edges in SQL and (by design) does NOT land
// per-edge `resolution` / `confidence` or the snapshot's `partial_failures` into
// code_edges — it trades that evidence metadata for cross-repo scale. So it must
// NOT claim "confirmed": every SQL-derived step is graded heuristic and flagged
// for source verification, keeping the scale path honest about what it can prove.
const SPARK_EVIDENCE: Evidence = {
  tier: "heuristic",
  resolution: "sql_aggregated",
  confidence: 0,
  partial: true,
  verify: true,
};
const SPARK_CAVEAT =
  "Heuristic: derived by SQL aggregation over raw edges (no per-edge resolution landed on the scale path) — open a receipt and confirm against source.";

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const WAREHOUSE = process.env.DATABRICKS_WAREHOUSE_ID;
const CATALOG = process.env.DATABRICKS_CATALOG || "workspace";
const SCHEMA = process.env.DATABRICKS_SCHEMA || "recipe";
const TABLE = `${CATALOG}.${SCHEMA}.recipes`;
const EDGES = `${CATALOG}.${SCHEMA}.code_edges`;

export function corpusEnabled(): boolean {
  return Boolean(HOST && TOKEN && WAREHOUSE);
}

type Param = { name: string; value: string; type?: string };

async function exec(statement: string, parameters?: Param[]) {
  const res = await fetch(`${HOST}/api/2.0/sql/statements`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      warehouse_id: WAREHOUSE,
      statement,
      wait_timeout: "30s",
      ...(parameters?.length ? { parameters } : {}),
    }),
  });
  const json = await res.json();
  if (json.status?.state !== "SUCCEEDED") {
    throw new Error(json.status?.error?.message || "databricks query failed");
  }
  return json;
}
const rowsOf = (r: { result?: { data_array?: string[][] } }): string[][] =>
  r.result?.data_array || [];

// Spark SQL literals process backslash escapes — double backslashes (protect
// embedded JSON) then double single quotes.
const q = (s: string) => `'${String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
const arr = (a: string[]) => `array(${(a || []).map(q).join(", ")})`;
const asArray = (v: unknown): string[] => {
  try {
    return Array.isArray(v) ? (v as string[]) : JSON.parse(v as string);
  } catch {
    return [];
  }
};
const asJson = (v: unknown) => {
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return [];
  }
};

function rowToRecipe(row: string[]): Recipe {
  const [id, library, title, emphasis, repos, calls, runnersUp, keywords, steps, sources] = row;
  return {
    id,
    library,
    title,
    emphasis: emphasis || "",
    reposMined: Number(repos) || 0,
    callSites: Number(calls) || 0,
    runnersUp: runnersUp || "",
    keywords: asArray(keywords),
    steps: asJson(steps),
    sources: asArray(sources),
  } as Recipe;
}

export async function getAllRecipes(): Promise<Recipe[]> {
  const r = await exec(
    `SELECT id, library, title, emphasis, repos_mined, call_sites, runners_up, keywords, steps, sources FROM ${TABLE}`
  );
  return (r.result?.data_array || []).map(rowToRecipe);
}

// same keyword scoring as the local findRecipe, over the lakehouse rows
export async function queryRecipe(query: string): Promise<Recipe | null> {
  let best: Recipe | null = null;
  let bestScore = 0;
  for (const r of await getAllRecipes()) {
    const { score, accept } = matchScore(query, r.keywords || []);
    if (accept && score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// write-back: upsert a freshly-generated recipe into the lakehouse
export async function saveRecipe(
  r: Recipe & { sources?: string[] },
  source = "live"
): Promise<void> {
  await exec(`DELETE FROM ${TABLE} WHERE id = ${q(r.id)}`);
  await exec(
    `INSERT INTO ${TABLE} VALUES (${q(r.id)}, ${q(r.library)}, ${q(r.title)}, ` +
      `${q(r.emphasis || "")}, ${r.reposMined || 0}, ${r.callSites || 0}, ${q(r.runnersUp || "")}, ` +
      `${arr(r.keywords)}, ${q(JSON.stringify(r.steps || []))}, ${arr(r.sources || [])}, ${q(source)}, current_timestamp())`
  );
}

// ---------------------------------------------------------------------------
// Spark scale path: derive a recipe from the raw edges in code_edges entirely
// via SQL aggregation on the warehouse (see databricks/derive.sql). This is the
// server-side equivalent of engine/generate.mjs, run on Databricks compute so a
// goal can be mined from many more repos than the Node process could hold.
//
// The deny-lists MUST track PKG_DENY / SYM_DENY in engine/generate.mjs.
const PKG_DENY = [
  "react", "react-dom", "next", "vue", "svelte", "typescript", "vite", "webpack",
  "eslint", "prettier", "tailwindcss", "@types/node", "@types/react",
  "@types/react-dom", "zod", "clsx", "classnames", "dotenv", "express",
  "@vitejs/plugin-react", "postcss", "autoprefixer",
  "lucide-react", "react-icons", "@heroicons/react", "@radix-ui/react-icons",
  "uuid", "nanoid", "date-fns", "dayjs", "lodash", "lodash-es", "axios",
  "framer-motion", "@tailwindcss/vite",
  "@chakra-ui/react", "@chakra-ui/icons", "@mui/material", "@mui/icons-material",
  "@emotion/react", "@emotion/styled", "antd", "@mantine/core", "@mantine/hooks",
  "bootstrap", "react-bootstrap", "@radix-ui/react-slot", "styled-components",
  // test runners / build tooling (keep in sync with engine/generate.mjs + langs.mjs)
  "vitest", "@vitest/ui", "@vitest/coverage-v8", "jest", "ts-jest", "babel-jest",
  "mocha", "chai", "jasmine", "ava", "sinon", "supertest", "cypress",
  "playwright", "@playwright/test", "karma", "jsdom", "happy-dom", "enzyme",
  "ts-node", "tsx", "tsup", "esbuild", "rollup", "nodemon", "@swc/core",
  "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom",
  "@testing-library/user-event",
];
const SYM_DENY = [
  "useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext",
  "useReducer", "useLayoutEffect", "useImperativeHandle", "useId", "useRouter",
  "useSearchParams", "usePathname", "useTheme", "useForm",
];
const sqlList = (a: string[]) => a.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const asReceipts = (v: unknown): Receipt[] => {
  const j = asJson(v);
  return Array.isArray(j) ? (j as Receipt[]) : [];
};

// True when the raw-edge lakehouse is reachable AND ingest has landed rows for
// this goal — i.e. the Spark aggregation has something to chew on.
export async function edgesReady(goal: string): Promise<boolean> {
  if (!corpusEnabled()) return false;
  try {
    const r = await exec(`SELECT count(*) FROM ${EDGES} WHERE goal = :goal`, [
      { name: "goal", value: slugify(goal), type: "STRING" },
    ]);
    return (Number(rowsOf(r)[0]?.[0]) || 0) > 0;
  } catch {
    return false;
  }
}

export async function deriveRecipe(
  goal: string,
  opts: { package?: string } = {}
): Promise<(Recipe & { sources: string[] }) | null> {
  const goalSlug = slugify(goal);
  const p: Param[] = [{ name: "goal", value: goalSlug, type: "STRING" }];

  // 1. totals + the repo URLs mined for this goal
  const meta = rowsOf(
    await exec(
      `SELECT count(DISTINCT repo), to_json(array_distinct(collect_list(repo_url)))
       FROM ${EDGES} WHERE goal = :goal`,
      p
    )
  );
  const total = Number(meta[0]?.[0]) || 0;
  if (!total) return null;
  const sources = asArray(meta[0]?.[1]);

  // 2. install packages — external packages ranked by distinct-repo frequency
  const pkgRows = rowsOf(
    await exec(
      `SELECT base_pkg, count(DISTINCT repo) AS repos,
         to_json(min_by(named_struct(
           'label', concat(repo,'/',file, if(line IS NULL,'',concat(':',cast(line AS string)))),
           'url',   concat(repo_url,'/blob/HEAD/',file, if(line IS NULL,'',concat('#L',cast(line AS string))))
         ), concat(repo,'/',file))) AS receipt
       FROM ${EDGES}
       WHERE goal = :goal AND relation = 'IMPORTS' AND base_pkg IS NOT NULL
         AND base_pkg NOT IN (${sqlList(PKG_DENY)})
       GROUP BY base_pkg ORDER BY repos DESC, base_pkg`,
      p
    )
  );
  const packages = pkgRows.map(([pkg, repos, receipt]) => ({
    pkg,
    repos: Number(repos) || 0,
    receipt: asJson(receipt) as Receipt | null,
  }));
  if (!packages.length) return null;

  // resolve the library (caller-pinned wins, else the dominant package family)
  const library = opts.package || packages[0].pkg;
  const famPrefix = library.startsWith("@") ? library.split("/")[0] : library;
  const family = packages.filter((x) => x.pkg === library || x.pkg.startsWith(famPrefix));
  const familyPkgs = new Set(family.map((x) => x.pkg));
  if (opts.package && !familyPkgs.has(library)) familyPkgs.add(library);
  const installPkgs = opts.package ? [...familyPkgs] : family.map((x) => x.pkg);
  const pkgOf = (name: string) => packages.find((x) => x.pkg === name);

  const steps: Step[] = [
    {
      name: "Install",
      freq: `${Math.max(1, ...installPkgs.map((pk) => pkgOf(pk)?.repos || 1))}/${total}`,
      level: "high",
      code: `npm i ${installPkgs.join(" ")}`,
      note: `Packages the mined repos import together${
        family.length
          ? `. Most common: ${family.slice(0, 3).map((x) => `${x.pkg} (${x.repos}/${total})`).join(", ")}`
          : ""
      }.`,
      evidence: SPARK_EVIDENCE,
      caveat: SPARK_CAVEAT,
      receipts: installPkgs.map((pk) => pkgOf(pk)?.receipt).filter(Boolean).slice(0, 4) as Receipt[],
    },
  ];

  // 3. API steps — library APIs co-located with a library import, ranked
  const symRows = rowsOf(
    await exec(
      `WITH lib_files AS (
         SELECT DISTINCT repo, file FROM ${EDGES}
         WHERE goal = :goal AND relation = 'IMPORTS'
           AND (module = :library OR module LIKE concat(:famPrefix, '%'))
       ),
       sym AS (
         SELECT c.symbol, c.repo, c.file, c.line, c.repo_url, c.snippet
         FROM ${EDGES} c JOIN lib_files lf ON c.repo = lf.repo AND c.file = lf.file
         WHERE c.goal = :goal AND c.relation IN ('CALLS','CONSTRUCTS')
           AND c.symbol IS NOT NULL AND c.line IS NOT NULL AND length(c.symbol) >= 3
           AND c.symbol NOT IN (${sqlList(SYM_DENY)})
           AND (c.symbol RLIKE '^[A-Z]' OR c.symbol RLIKE '^use[A-Z]')
       )
       SELECT symbol, count(DISTINCT repo) AS repos,
         to_json(slice(array_distinct(collect_list(named_struct(
           'label', concat(repo,'/',file,':',cast(line AS string)),
           'url',   concat(repo_url,'/blob/HEAD/',file,'#L',cast(line AS string))
         ))), 1, 4)) AS receipts,
         min_by(snippet, concat(repo,'/',file,':',cast(line AS string))) AS snippet
       FROM sym GROUP BY symbol ORDER BY repos DESC, symbol LIMIT 5`,
      [...p, { name: "library", value: library, type: "STRING" }, { name: "famPrefix", value: famPrefix, type: "STRING" }]
    )
  );

  let callSites = installPkgs.length;
  for (const [symbol, repos, receiptsJson, snippet] of symRows) {
    const receipts = asReceipts(receiptsJson);
    callSites += receipts.length;
    const n = Number(repos) || 0;
    steps.push({
      name: symbol,
      freq: `${n}/${total}`,
      level: n >= Math.ceil(total / 2) ? "high" : "warn",
      code: snippet || `${symbol}(…)`,
      note: `A ${library} API used across ${n}/${total} mined repos.`,
      evidence: SPARK_EVIDENCE,
      caveat: SPARK_CAVEAT,
      receipts,
    });
  }

  const analysis: Analysis = {
    complete: false,
    confidence: "partial",
    reposMined: total,
    reposCleanlyParsed: 0,
    partialFailureCount: 0,
    partialFailures: [],
    blindRepos: [],
    reasons: [
      "Served via the Databricks Spark scale path: recipes are aggregated in SQL over raw edges, which do not carry per-edge resolution or the snapshot's parse-failure list. Completeness cannot be certified here.",
    ],
    verify:
      "Scale-path recipe: every step is heuristic. Open each receipt and confirm the symbol against your installed package (types/exports or a source grep) before relying on it.",
  };

  return {
    id: goalSlug,
    library,
    title: goal.charAt(0).toUpperCase() + goal.slice(1),
    emphasis: "",
    reposMined: total,
    callSites,
    runnersUp:
      packages.filter((x) => !familyPkgs.has(x.pkg)).slice(0, 3).map((x) => x.pkg).join(", ") || "—",
    keywords: keywordsFromGoal(goal),
    steps,
    analysis,
    sources,
  };
}
