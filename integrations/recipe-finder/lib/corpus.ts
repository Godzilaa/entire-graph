// Databricks-backed recipe corpus — the lakehouse serving layer.
// Reads/writes workspace.recipe.recipes via the SQL Statement Execution API.
// If the DATABRICKS_* env vars are absent, corpusEnabled() is false and the
// API route falls back to the local JSON corpus.
import type { Recipe } from "./recipes";

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const WAREHOUSE = process.env.DATABRICKS_WAREHOUSE_ID;
const CATALOG = process.env.DATABRICKS_CATALOG || "workspace";
const SCHEMA = process.env.DATABRICKS_SCHEMA || "recipe";
const TABLE = `${CATALOG}.${SCHEMA}.recipes`;

export function corpusEnabled(): boolean {
  return Boolean(HOST && TOKEN && WAREHOUSE);
}

async function exec(statement: string) {
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
    }),
  });
  const json = await res.json();
  if (json.status?.state !== "SUCCEEDED") {
    throw new Error(json.status?.error?.message || "databricks query failed");
  }
  return json;
}

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
  const qq = query.toLowerCase().trim();
  if (!qq) return null;
  let best: Recipe | null = null;
  let score = 0;
  for (const r of await getAllRecipes()) {
    let s = 0;
    for (const kw of r.keywords || []) if (qq.includes(kw)) s += kw.length;
    if (s > score) {
      score = s;
      best = r;
    }
  }
  return best;
}

// write-back: upsert a freshly-generated recipe into the lakehouse
export async function saveRecipe(r: Recipe & { sources?: string[] }): Promise<void> {
  await exec(`DELETE FROM ${TABLE} WHERE id = ${q(r.id)}`);
  await exec(
    `INSERT INTO ${TABLE} VALUES (${q(r.id)}, ${q(r.library)}, ${q(r.title)}, ` +
      `${q(r.emphasis || "")}, ${r.reposMined || 0}, ${r.callSites || 0}, ${q(r.runnersUp || "")}, ` +
      `${arr(r.keywords)}, ${q(JSON.stringify(r.steps || []))}, ${arr(r.sources || [])}, 'live', current_timestamp())`
  );
}
