# recipe-finder — an integration built on Entire Graph

> Buildathon submission for the **Build on Entire Graph** track. This document is
> the *initial understanding and intended architecture* checkpoint: what the
> feature is, why it is built the way it is, what was rejected, and what evidence
> from the graph changed the design.

## What the track asks

> "Use the structure of a codebase to support a useful, **verifiable** decision or
> action."

The decision a developer makes constantly: *"I want to build X — which packages do
I use, and how do I wire them together?"* Today that answer comes from blog posts,
LLM guesses, and stale docs. None of it is grounded in what real code actually
does.

## The feature: goal → cited integration recipe

The user states an **end goal** — *not* a library:

> "realtime collaborative editor", "drag-and-drop kanban", "email + OAuth auth"

recipe-finder returns a **playbook where every step has a real `file:line`
receipt**, produced by this pipeline:

```
goal ──▶ discover real repos      (gh search — grounded in reality, not a model)
      ──▶ entire graph edges       (IMPORTS / CALLS / CONSTRUCTS as NDJSON)
      ──▶ resolve the LIBRARY      (the dominant import the repos actually use)
      ──▶ mine the real APIs       (top symbols co-located in files using that lib)
      ──▶ cited recipe             (Install + ranked steps, each with receipts)
```

The graph is what makes the output **verifiable**: every claim is an edge with an
evidence `file_path:line`, not a guess. "8/10 repos import `@tiptap/react`" is a
fact you can click into, not an opinion.

## Intended architecture

Three surfaces over one engine:

| Surface | Path | Who it serves |
|---|---|---|
| **Skill / CLI** | `skills/recipe-finder/SKILL.md` + `engine/cli.mjs` | a coding agent pulling a recipe mid-task |
| **Web dashboard + API** | `app/` (Next.js) + `GET /api/recipe` | humans, and non-skill programmatic callers |
| **Docs** | `app/docs` + `docs/recipe-finder.md` | explains the verify angle |

Engine internals (all under `engine/`):

- `graph.mjs` — the **only** adapter over the `entire graph` CLI. Shells
  `entire graph edges --repo X --relation IMPORTS,CALLS,CONSTRUCTS --format ndjson`,
  parses `record_type:"relation"` records, extracts modules from
  `to_id:"external:import:<pkg>"`.
- `generate.mjs` — the goal-driven generator: discover → clone → edges → resolve
  library → derive steps with receipts + source snippets. Progress → stderr so
  `--json` stdout stays clean.
- `cli.mjs` — `generate` / `query` / `mine` / `list`.
- `load-databricks.mjs` — bulk-loads the mined corpus into a Delta table.

## Decisions, and what was rejected

- **Goal-driven, not library-fixated.** *Rejected:* hand-authored per-library specs
  (the first version only knew `tiptap`). The whole point is the user should *not*
  have to know the library — the graph resolves it. Kept a small authored-spec
  miner (`mine.mjs`) only as a seed/fallback.
- **Agent supplies judgment; engine supplies evidence.** *Rejected:* fully-automatic
  goal→library resolution as the *only* path. It is grounded but blunt (see
  Evidence below). The CLI exposes `--package` / `--repos` so the agent can pin the
  right library or focused repos and re-mine. The graph reports truth; the agent
  decides what to trust.
- **Next.js app, not static HTML.** *Rejected:* a static page — the live-mine API
  and Databricks-backed serving need a server runtime.
- **Databricks as the read/write serving store.** The corpus of mined recipes lives
  in a Unity Catalog Delta table; `/api/recipe` reads Databricks first, falls back
  to local JSON, and on a miss live-mines and **writes the new recipe back** so the
  corpus grows. *Honest scope:* at demo scale this is queryability + the scale path,
  not raw compute — the graph itself runs locally (see Open risks).

## Evidence from the graph that changed the design

- **The graph corrected the library.** For "kanban", auto-resolution first surfaced
  `lucide-react` (icons) and generic repos. The IMPORTS edges showed many kanban
  repos truly use **`react-dnd`**, not `@dnd-kit`. This forced: a source-file
  filter, an import denylist (icons/UI-kits/utils), symbol↔library co-location, and
  the `--package`/`--repos` refinements. *The graph reporting what repos actually
  import — over what a blog would tell you — is the entire value proposition.*
- **Real APIs, not plausible ones.** Mining `@dnd-kit/sortable` yielded `useSortable`
  / `useSensor` from real call sites with receipts — the exact hooks a human would
  otherwise guess at.

## Assumptions & open risks

- **Receipts can drift from the installed version.** A receipt proves *a* real repo
  wired it this way; the agent must confirm against the current library version.
  Surfaced explicitly in the skill ("evidence, not an oracle").
- **Auto-resolution is blunt** on vague goals / low-signal repos — mitigated by
  agent-supplied `--package`/`--repos`, not solved.
- **Scale path is not local compute.** Running the `entire` tree-sitter parser
  inside Spark executors is non-trivial; the realistic scale design is *mine edges
  → land in a `code_edges` Delta table → aggregate recipes in SQL on Databricks*.
  Schema is drafted (`databricks/schema.sql`); the SQL aggregation is the open
  work.
- **Discovery depends on `gh search`** ranking; capped at a few repos for latency.

## How this uses Entire Graph (evidence requirements)

- **Graph search / definition lookup** — resolving which symbols a library exposes
  and where they are defined across the mined repos.
- **Relationship / impact analysis** — IMPORTS/CALLS/CONSTRUCTS edges are exactly a
  relationship analysis; used before trusting any step in the recipe.
- **Semantic diff** — run on the final integration to show what entities changed.

Graph results are treated as **evidence, verified against source** — never presented
as an oracle.
