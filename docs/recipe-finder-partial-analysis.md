# recipe-finder — partial-analysis honesty ("the graph is evidence, not an oracle")

> Track 2 revised design. The recipe engine consumes graph **relationships**
> (IMPORTS / CALLS / CONSTRUCTS) as the proof behind every recipe step. Static
> analysis cannot fully resolve dynamic dispatch, reflection, generated code, or
> inventory-only languages, and some files fail to parse. This change stops the
> engine from presenting that incomplete evidence as certain, and gives users and
> agents a way to tell confirmed structural facts apart from guesses and blind
> spots.

## The defect it fixes

Before: `engine/graph.mjs` discarded the `resolution` / `confidence` on every
relation and the snapshot's `partial_failures`, and the UI hard-coded

> "Every step below is **graph-verified** against real call sites … No guesses."

So a call resolved only by NAME (`resolution: "name_only"` — the class of edge
that dynamic dispatch silently corrupts) and a recipe mined from a repo with
parse failures were both rendered as proven fact. That is the exact overclaim
Track 2 forbids.

## The three evidence tiers

`engine/evidence.mjs` (pure, unit-tested) maps each graph relation to one of:

| Tier | Meaning | Driven by |
|---|---|---|
| **confirmed** | the graph resolved this edge to a real definition/import | `resolution ∈ {exact, import_resolved, import_external, package, resolved, full}` **and** confidence ≥ 0.75 |
| **heuristic** | name-matched or inferred — likely, unproven | `resolution ∈ {name_only, type_inferred, pattern, shallow, signature}`, a weak-confidence resolved edge, or an unknown resolution string |
| **unverified** | the graph could not resolve it — a blind spot | `resolution ∈ {none, unresolved}` or no backing edge at all |

Each step carries `evidence: { tier, resolution, confidence, partial, verify }`
plus a one-line `caveat`. `verify` is `true` whenever the step is not confirmed
**or** the recipe was only partially analyzed.

## Detecting partial analysis

The authoritative signal is the snapshot **`summary`** record (not the `edges`
header, which does not compute it). `engine/graph.mjs::snapshotGraph()` runs one
`entire graph snapshot` per repo and reads:

- `partial_failures` — files that failed to parse (`E_PARSE_ERROR`). Their
  relations are simply absent from the graph.
- `language_tiers` — which languages are **inventory-only** (no relations at
  all): a blind spot, not a confirmed absence.
- `completeness_level` — `ok` vs `degraded`.

`engine/evidence.mjs::buildAnalysis()` folds every mined repo's meta into a
recipe-level `analysis: { complete, confidence, reasons[], partialFailures[],
blindRepos[], verify }`. `complete` is `false` if any repo had a parse failure or
produced zero relations. **A missing step under `complete:false` is never treated
as "not needed".**

## The safe fallback / verification path

- `analysis.verify` (and each `step.caveat`) spells out the concrete check: open a
  receipt, confirm the symbol against the installed package's exported types or a
  source grep, and — when the set was partial/blind — re-mine with `--repos` /
  `--package` pinned to cleaner repos.
- The web UI (`app/page.tsx`) replaces the old "no guesses" banner with an
  `EvidenceBanner` that turns amber and lists the reasons when analysis is
  partial, plus a per-step tier badge. The CLI (`engine/cli.mjs`) prints the same
  banner + `[≈ heuristic·verify]` tags. The skill (`SKILL.md`) tells agents to
  read `analysis` and `evidence.tier` before trusting a step.

## What still works unchanged (fully-resolved code)

A step's **tier reflects its own edge's resolution quality**, independent of an
unrelated file's parse failure — so cleanly-resolved wiring keeps its `confirmed`
tier and a real recipe is still produced. Partial analysis adds a verify nudge
and a recipe-level warning; it does not blank out or falsify resolved evidence.

## Which parts consume relationship / impact / semantic-diff evidence

Identified with `entire graph` (search / neighbors) — the surfaces that read
graph evidence and therefore had to become honest:

- `engine/graph.mjs` — the ONLY adapter over `entire graph`. `snapshotGraph()`
  (relationships + completeness) and `edges()`/`edgesWithMeta()` (relationships).
- `engine/generate.mjs::generate()` — consumes IMPORTS/CALLS/CONSTRUCTS
  relationships to build steps; now grades them and attaches `analysis`.
- `engine/evidence.mjs` — the grading policy (new).
- `lib/corpus.ts::deriveRecipe()` — the Databricks Spark scale path; aggregates
  raw edges in SQL. It does not land per-edge `resolution`, so it self-labels
  every step `heuristic` with an honest partial `analysis`.
- `app/page.tsx`, `engine/cli.mjs`, `skills/recipe-finder/SKILL.md` — the three
  presentation surfaces, now tier-aware.
- Semantic diff (`entire graph diff`) is used at submission time to show the
  entity-level change set (see `docs/recipe-finder-semantic-diff.md`).

## Test / fixture

`engine/__fixtures__/partial-analysis/` is a deliberately partially-analyzable
repo: `src/editor.jsx` (fully resolvable @tiptap usage), `src/dynamic.js`
(dynamic dispatch the graph cannot resolve), `src/legacy.sql` (unparseable →
`E_PARSE_ERROR`). `engine/evidence.test.mjs` (`node --test`) asserts the grading
and partial-analysis detection against synthetic records **and** a captured
golden snapshot (`partial-analysis-snapshot.ndjson`), with a live end-to-end
check when `entire` is on PATH. Fully-resolved input still grades `confirmed` and
produces a complete recipe (regression guard).
