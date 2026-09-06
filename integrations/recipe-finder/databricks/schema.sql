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
-- Scale path (not required for the app): land raw entire-graph edges here and
-- aggregate recipes in SQL instead of JS, across thousands of repos.
--
-- CREATE TABLE IF NOT EXISTS workspace.recipe.code_edges (
--   goal STRING, repo STRING, relation STRING, symbol STRING,
--   module STRING, file STRING, line INT, confidence DOUBLE
-- ) USING DELTA;
--
-- Install packages by frequency:
--   SELECT module, count(DISTINCT repo) AS repos
--   FROM workspace.recipe.code_edges
--   WHERE relation = 'IMPORTS' AND goal = :goal
--   GROUP BY module ORDER BY repos DESC;
