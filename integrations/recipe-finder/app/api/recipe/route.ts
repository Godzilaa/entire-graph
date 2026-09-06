import { spawnSync } from "node:child_process";
import { findRecipe } from "@/lib/recipes";
import { corpusEnabled, queryRecipe, saveRecipe, deriveRecipe } from "@/lib/corpus";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Public query endpoint, served from the Databricks lakehouse when configured.
//   GET /api/recipe?q=collaborative+editor           read: databricks → local corpus
//   GET /api/recipe?q=...&live=1                      miss: mine on Databricks compute
//
// On a live miss with Databricks configured, the parse is fanned across ~10
// repos (engine/ingest-databricks.mjs → code_edges) and the recipe is
// aggregated in SQL on the warehouse (deriveRecipe / databricks/derive.sql).
// Without a workspace it falls back to the local in-process engine.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const live = searchParams.get("live") === "1";

  if (!q.trim()) {
    return Response.json(
      { error: "missing query", usage: "/api/recipe?q=collaborative+editor" },
      { status: 400 }
    );
  }

  // 1. Databricks lakehouse (the live serving store)
  if (corpusEnabled()) {
    try {
      const hit = await queryRecipe(q);
      if (hit) return Response.json({ ...hit, source: "databricks" });
    } catch {
      // fall through to local corpus if the warehouse is unreachable
    }
  }

  // 2. local corpus (mined + hand-authored) — always available
  const local = findRecipe(q);
  if (local) return Response.json({ ...local, source: "corpus" });

  // 3. no hit — mine on demand?
  if (!live) {
    return Response.json(
      { error: "not in corpus", query: q, hint: "retry with &live=1 to mine it on-demand" },
      { status: 404 }
    );
  }

  const spawnEnv = { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };

  // 4. live on Databricks: fan the parse across many repos → land raw edges,
  //    then aggregate the recipe in SQL on the warehouse (the scale path).
  if (corpusEnabled()) {
    const ing = spawnSync("node", ["engine/ingest-databricks.mjs", q], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 240000,
      maxBuffer: 64 * 1024 * 1024,
      env: spawnEnv,
    });
    if (ing.status === 0) {
      try {
        const recipe = await deriveRecipe(q);
        if (recipe && recipe.steps.length > 1) {
          // cache the SQL-derived recipe into the served table so the next read
          // is an instant `source:"databricks"` hit
          try {
            await saveRecipe(recipe, "databricks-spark");
          } catch {
            /* serving still works even if the write-back cache fails */
          }
          return Response.json({ ...recipe, source: "databricks-spark" });
        }
      } catch {
        /* fall through to the local engine below */
      }
    }
    // ingest or SQL aggregation failed — fall through to the local engine
  }

  // 4b. fallback: entire-graph engine discovers → mines → derives in-process
  //     (no Databricks workspace, or the Spark path was unavailable)
  const res = spawnSync("node", ["engine/cli.mjs", "generate", q, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 64 * 1024 * 1024,
    env: spawnEnv,
  });

  if (res.status !== 0 || !res.stdout?.trim()) {
    return Response.json(
      { error: "generation failed", query: q, detail: (res.stderr || "").split("\n").slice(-3).join("\n") },
      { status: 502 }
    );
  }

  try {
    const recipe = JSON.parse(res.stdout);
    // write the new recipe back into the lakehouse so the corpus grows
    let source = "live";
    if (corpusEnabled()) {
      try {
        await saveRecipe(recipe);
        source = "live+databricks";
      } catch {
        /* keep source=live if write-back fails */
      }
    }
    return Response.json({ ...recipe, source });
  } catch {
    return Response.json({ error: "could not parse engine output", query: q }, { status: 502 });
  }
}
