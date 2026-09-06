-- recipe corpus — Unity Catalog schema for the Databricks-backed serving layer.
-- Run these in a Databricks SQL editor (or via the Statement Execution API,
-- which is what engine/load-databricks.mjs and lib/corpus.ts use).

CREATE SCHEMA IF NOT EXISTS workspace.recipe;

-- Materialized playbooks served by GET /api/recipe.
-- steps is stored as a JSON string (the app parses it); keywords/sources are
-- native arrays. source ∈ {'mined','live'} records how the row was produced.
CREATE TABLE IF NOT EXISTS workspace.recipe.recipes (
  id           STRING,
  library      STRING,
  title        STRING,
  emphasis     STRING,
  repos_mined  INT,
  call_sites   INT,
  runners_up   STRING,
  keywords     ARRAY<STRING>,
  steps        STRING,          -- JSON: [{name,freq,level,code,note,receipts[]}]
  sources      ARRAY<STRING>,   -- the repos it was mined from
  source       STRING,
  updated_at   TIMESTAMP
) USING DELTA;

-- Example queries the app / Genie can run:
--   SELECT library, count(*) FROM workspace.recipe.recipes GROUP BY library;
--   SELECT id, repos_mined, call_sites FROM workspace.recipe.recipes ORDER BY call_sites DESC;

-- ---------------------------------------------------------------------------
-- Scale path (the Databricks compute story): land raw entire-graph edges here,
-- one row per relation across MANY repos, and aggregate the recipe in Spark SQL
-- (databricks/derive.sql) instead of in the Node process. This is what lets a
-- goal be mined from 10+ repos — the parse is fanned out at ingest and the
-- heavy cross-repo ranking runs on the warehouse.
--
-- engine/ingest-databricks.mjs writes these rows; lib/corpus.ts::deriveRecipe()
-- and databricks/derive.sql read them.
CREATE TABLE IF NOT EXISTS workspace.recipe.code_edges (
  goal      STRING,          -- recipe slug the edge was mined for (partition key)
  repo      STRING,          -- short repo name, e.g. "novel"
  repo_url  STRING,          -- clone URL, used to build receipt links
  relation  STRING,          -- 'IMPORTS' | 'CALLS' | 'CONSTRUCTS'
  module    STRING,          -- IMPORTS: raw imported module (e.g. "@tiptap/react"); else NULL
  base_pkg  STRING,          -- IMPORTS: installable package (e.g. "@tiptap/react" -> family base); else NULL
  symbol    STRING,          -- CALLS/CONSTRUCTS: called/constructed identifier; else NULL
  file      STRING,          -- source file the edge was observed in
  line      INT,             -- 1-based line of the evidence
  snippet   STRING,          -- trimmed source line at file:line (drives the step `code`)
  mined_at  TIMESTAMP
)
USING DELTA
PARTITIONED BY (goal);

-- Sanity queries once ingest has run for a goal:
--   SELECT count(DISTINCT repo) FROM workspace.recipe.code_edges WHERE goal = 'realtime-collaborative-editor';
--   SELECT base_pkg, count(DISTINCT repo) AS repos
--   FROM workspace.recipe.code_edges
--   WHERE relation = 'IMPORTS' AND goal = 'realtime-collaborative-editor'
--   GROUP BY base_pkg ORDER BY repos DESC;
--
-- The full recipe derivation (install packages + co-located API symbols +
-- receipts) lives in databricks/derive.sql.
