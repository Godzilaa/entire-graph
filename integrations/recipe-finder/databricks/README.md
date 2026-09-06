# Databricks lakehouse — serving layer

The live web API (`GET /api/recipe`) is served from a Delta table in Unity
Catalog. entire-graph produces the recipes; Databricks stores and serves them,
and new goals mined on-demand are written back so the corpus grows.

```
GET /api/recipe?q=…
  1. Databricks SQL  → workspace.recipe.recipes        (read)
  2. local corpus    → lib/recipes.generated.json      (fallback)
  3. live (miss + ?live=1):
       a. ingest      → parse ~10 repos → workspace.recipe.code_edges  (raw edges)
       b. derive      → aggregate the recipe in Spark SQL on the warehouse
       c. cache       → write the result back into workspace.recipe.recipes
```

## Two tables, two jobs

| table         | holds                              | written by                     | read by                          |
|---------------|------------------------------------|--------------------------------|----------------------------------|
| `recipes`     | finished, served playbooks         | `load-databricks.mjs`, write-back | `queryRecipe()` (fast serve)     |
| `code_edges`  | one row per raw entire-graph edge  | `ingest-databricks.mjs`        | `deriveRecipe()` / `derive.sql`  |

`recipes` is the serving layer (step 1). `code_edges` is the **scale path**: the
per-repo parse is fanned out at ingest, and the heavy cross-repo ranking
(install packages, co-located API symbols, receipts) runs in SQL on the
warehouse via [`derive.sql`](./derive.sql) — not in the Node process. That is
what lets a goal be mined from 10+ repos instead of the 3 the in-process engine
handles. Bump the fan-out with `--max-repos N` (or `MAX_REPOS` in `.env.local`).

## Setup

1. **Workspace** — any Databricks workspace with a serverless SQL warehouse
   (Free Edition works). Grab: host URL, a Personal Access Token, the SQL
   warehouse id, and your catalog (Free Edition = `workspace`).

2. **Env** — put them in `.env.local` (gitignored):

   ```
   DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
   DATABRICKS_TOKEN=dapi…
   DATABRICKS_WAREHOUSE_ID=<warehouse id>
   DATABRICKS_CATALOG=workspace
   DATABRICKS_SCHEMA=recipe
   ```

3. **Schema** — run [`schema.sql`](./schema.sql) (creates both
   `workspace.recipe.recipes` and `workspace.recipe.code_edges`).

4. **Load the seed corpus**:

   ```bash
   node engine/load-databricks.mjs
   ```

That's it — `GET /api/recipe?q=…` now returns `"source":"databricks"`.

## Mining a new goal on Databricks compute (the scale path)

For a goal not yet in the corpus, land its edges then aggregate in SQL:

```bash
# parse ~10 discovered repos and land raw edges into code_edges
node engine/ingest-databricks.mjs "realtime collaborative editor" --max-repos 10
# (optional) inspect the SQL derivation by hand in a SQL editor / Genie:
#   run databricks/derive.sql with :goal = 'realtime-collaborative-editor'
```

The web API does both automatically on `GET /api/recipe?q=…&live=1`: it runs the
ingest, calls `deriveRecipe()` (the same SQL as `derive.sql`), caches the result
into `recipes`, and responds with `"source":"databricks-spark"`.

> Note: the `entire graph` binary (tree-sitter parse) runs at **ingest** — the
> warehouse can't execute it. Databricks scales the *aggregation* across many
> repos; ingest scales the *parse* by simply pointing it at more repos.

## How it connects (no SDK)

Everything uses the **SQL Statement Execution API** (`POST /api/2.0/sql/statements`)
over plain `fetch` — no Databricks SDK or native driver:

- `lib/corpus.ts` — the app's read/write client (`queryRecipe`, `saveRecipe`).
- `engine/load-databricks.mjs` — bulk-loads the mined corpus.

If the `DATABRICKS_*` env vars are absent, `corpusEnabled()` is false and the API
transparently falls back to the local JSON corpus — so nothing breaks without a
workspace.

> Note: Spark SQL string literals process backslash escapes, so JSON stored in a
> `STRING` column must double its backslashes on insert (handled in the `q()`
> helper in both files).
