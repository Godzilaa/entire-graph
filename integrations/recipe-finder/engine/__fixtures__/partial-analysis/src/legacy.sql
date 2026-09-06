-- The UNPARSEABLE part of the fixture. A supported extension (.sql) whose
-- Spark-dialect content (three-part `catalog.schema.table` names and `:param`
-- markers) the tree-sitter SQL grammar cannot parse, so the graph reports it as
-- a partial_failure (E_PARSE_ERROR) instead of dropping it silently. Any wiring
-- expressed only in here is invisible to the graph — the engine must treat that
-- as "analysis incomplete", not "nothing to see".
CREATE TABLE IF NOT EXISTS workspace.recipe.code_edges (
  goal STRING,
  symbol STRING
);

INSERT INTO workspace.recipe.code_edges
SELECT :goal AS goal, c.symbol
FROM workspace.recipe.raw_edges AS c
WHERE c.goal = :goal AND c.symbol RLIKE '^[A-Z]';
