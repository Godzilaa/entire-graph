# Databricks lakehouse — serving layer

The live web API (`GET /api/recipe`) is served from a Delta table in Unity
Catalog. entire-graph produces the recipes; Databricks stores and serves them,
and new goals mined on-demand are written back so the corpus grows.

```
GET /api/recipe?q=…
  1. Databricks SQL  → workspace.recipe.recipes        (read)
  2. local corpus    → lib/recipes.generated.json      (fallback)
  3. live-generate   → entire-graph, then WRITE BACK    (miss + ?live=1)
```

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

3. **Schema** — run [`schema.sql`](./schema.sql) (creates `workspace.recipe.recipes`).

4. **Load the corpus**:

   ```bash
   node engine/load-databricks.mjs
   ```

That's it — `GET /api/recipe?q=…` now returns `"source":"databricks"`.

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
