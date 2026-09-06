// Load the mined corpus (lib/recipes.generated.json) into the Delta table
// workspace.recipe.recipes via the Databricks SQL Statement Execution API.
//
//   node engine/load-databricks.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// minimal .env.local loader
for (const line of (() => {
  try {
    return readFileSync(join(ROOT, ".env.local"), "utf8").split("\n");
  } catch {
    return [];
  }
})()) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const { DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID } = process.env;
const CATALOG = process.env.DATABRICKS_CATALOG || "workspace";
const SCHEMA = process.env.DATABRICKS_SCHEMA || "recipe";
const TABLE = `${CATALOG}.${SCHEMA}.recipes`;

async function exec(statement) {
  const res = await fetch(`${DATABRICKS_HOST}/api/2.0/sql/statements`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DATABRICKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      warehouse_id: DATABRICKS_WAREHOUSE_ID,
      statement,
      wait_timeout: "50s",
    }),
  });
  const json = await res.json();
  if (json.status?.state !== "SUCCEEDED") {
    throw new Error(json.status?.error?.message || JSON.stringify(json.status));
  }
  return json;
}

// Spark SQL string literals process backslash escapes, so double backslashes
// (protect embedded JSON) then double single quotes.
const q = (s) => `'${String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
const arr = (a) => `array(${(a || []).map(q).join(", ")})`;

const recipes = JSON.parse(readFileSync(join(ROOT, "lib", "recipes.generated.json"), "utf8"));
console.log(`loading ${recipes.length} recipe(s) into ${TABLE} …`);

for (const r of recipes) {
  await exec(`DELETE FROM ${TABLE} WHERE id = ${q(r.id)}`);
  await exec(
    `INSERT INTO ${TABLE} VALUES (${q(r.id)}, ${q(r.library)}, ${q(r.title)}, ` +
      `${q(r.emphasis || "")}, ${r.reposMined || 0}, ${r.callSites || 0}, ${q(r.runnersUp || "")}, ` +
      `${arr(r.keywords)}, ${q(JSON.stringify(r.steps || []))}, ${arr(r.sources)}, 'mined', current_timestamp())`
  );
  console.log(`  ✓ ${r.id}`);
}

const count = await exec(`SELECT count(*) FROM ${TABLE}`);
console.log(`done. rows in table: ${count.result?.data_array?.[0]?.[0]}`);
