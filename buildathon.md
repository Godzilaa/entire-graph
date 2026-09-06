# recipe-finder — Buildathon submission

> **Build on Entire Graph.** Turn an end goal into a proven, **cited** integration
> recipe — grounded in how real repositories actually wire the code. Every step
> carries a real `file:line` receipt. Evidence, not guesses.

- **Live demo:** https://recipe-finder-2wvbem0sj-pratik2ts-projects.vercel.app *(browses the mined corpus; live mining runs via the skill / local engine — see Limitations)*
- **Deck (5 pages, PDF):** [`docs/recipe-finder-deck.pdf`](docs/recipe-finder-deck.pdf)
- **Code:** [`integrations/recipe-finder/`](integrations/recipe-finder/)
- **Skill:** [`skills/recipe-finder/SKILL.md`](skills/recipe-finder/SKILL.md)

---

## The problem

Every developer constantly asks: *"I want to build X — which packages do I use,
and how do I wire them together?"* Today that answer comes from blog posts, stale
docs, and LLM guesses. None of it is grounded in what production code actually
does — libraries drift, tutorials rot, and *plausible* APIs are often wrong.

## The idea

State the **end goal**, not a library. A precomputed **code graph** — functions,
types, and the `IMPORTS` / `CALLS` / `CONSTRUCTS` relations between them, parsed
with tree-sitter by the Entire Graph provider — answers from reality. The graph
resolves **which library real repos truly use** and **how they wire it**, so the
recipe is *verifiable*: every claim is an edge with a clickable receipt, not an
opinion. "8 of 10 collab-editor repos import `@tiptap/react`" is a fact you can
click into.

## How it works

```
goal ──▶ discover real repos        (GitHub search — grounded in reality)
      ──▶ entire graph edges         (IMPORTS / CALLS / CONSTRUCTS as NDJSON)
      ──▶ resolve the LIBRARY        (the dominant import repos actually use)
      ──▶ mine the real APIs         (top symbols co-located with that library)
      ──▶ cited recipe               (Install + ranked steps, each with receipts)
```

One engine drives it. Discovery is grounded in reality; resolution and mining are
grounded in the graph. The graph even corrected our own design: for "kanban",
auto-resolution first surfaced an icon library — the `IMPORTS` edges showed real
repos use `react-dnd`. Mining `@dnd-kit/sortable` then yielded `useSortable` /
`useSensor` from real call sites, with receipts.

## The hard part — "the graph is evidence, not an oracle"

Static analysis cannot fully resolve dynamic dispatch, reflection, generated
code, or inventory-only languages — and some files fail to parse. The product
must never present incomplete evidence as certain. So **every step is graded**:

| Tier | Meaning |
|---|---|
| **✓ confirmed** | the graph resolved this edge to a real definition / import |
| **≈ heuristic** | matched by name / inference (dynamic dispatch can fool it) — verify against source |
| **? unverified** | the graph couldn't resolve it — a blind spot, not a confirmed absence |

Each recipe also carries an **`analysis`** block that detects parse failures and
blind repos, flags the result as **partial**, and prints a concrete
**verification path**. A missing step is never treated as "not needed." Fully
resolved code still produces a complete, confident recipe.

*Details: [`docs/recipe-finder-partial-analysis.md`](docs/recipe-finder-partial-analysis.md).*

## Architecture

**Three surfaces over one engine:**

- **Skill / CLI** — a coding agent pulls a recipe mid-task. The agent *is* the
  resolver (it passes `--package` / `--repos` from its own judgment).
- **Web dashboard + API** (`Next.js`, `GET /api/recipe`) — humans and
  programmatic callers; served from a mined corpus.
- **Docs** — the verify-first angle, in the repo and on the site.

**Depth:**

- **Multi-language** — language-agnostic engine (`engine/langs.mjs`): JS/TS,
  Python, Java, Go, Ruby, Rust, PHP, C#, Kotlin, Swift, … keyed off resolved
  external symbols.
- **Optional LLM resolver** (`engine/resolver.mjs`) — for the *agent-less*
  surfaces (web, human CLI), Claude proposes candidate libraries + search terms;
  **the graph still verifies** (a candidate is used only if real repos import
  it). Enabled only with `ANTHROPIC_API_KEY`; recipes record `suggested` vs
  `confirmed`.
- **Databricks Spark scale path** — land raw edges in a `code_edges` Delta table
  and aggregate recipes in SQL across many repos.
- **Evidence grading + partial-analysis detection** throughout.

## How this uses Entire Graph

- **Relationship analysis** — `entire graph edges --relation IMPORTS,CALLS,CONSTRUCTS`
  is the core evidence for every step.
- **Search / definition lookup** — used while building the integration to ground
  it in the real NDJSON producer (`WriteRelationsNDJSON`); see
  [`docs/recipe-finder-graph-evidence.md`](docs/recipe-finder-graph-evidence.md).
- **Snapshot completeness** — the `summary` record (`partial_failures`,
  `language_tiers`, `completeness_level`) drives the honesty layer.
- **Semantic diff** — run on the submission to show entity-level change;
  [`docs/recipe-finder-semantic-diff.md`](docs/recipe-finder-semantic-diff.md).

Graph results are treated as **evidence, verified against source — never an oracle.**

## Run it

```bash
cd integrations/recipe-finder
npm install                # first time (web app deps)

# Mine a recipe from a goal (needs: entire CLI + graph plugin, gh authed, git, node)
node engine/cli.mjs generate "drag and drop kanban board" --json
node engine/cli.mjs generate "numpy array math" --package numpy --json

# Or run the web app
npm run dev                # http://localhost:3000
```

The agent path is the skill: `skills/recipe-finder/SKILL.md` — the agent supplies
judgment, the engine supplies evidence.

## Status & limitations

- **Live on Vercel** for browsing the mined corpus. **Live mining does not run on
  serverless** — it needs the `entire` parser + `gh` + `git clone`, so a new-goal
  request returns an honest `501 "live mining unavailable on this host"`. Live
  mining runs via the skill / local engine, or a non-serverless host, or the
  Databricks Spark path.
- Auto-resolution is grounded but can be blunt on vague goals; mitigated by the
  agent's `--package` / `--repos` and the optional LLM resolver, not fully solved.
- **Tests:** `node --test engine/evidence.test.mjs` (evidence grading +
  partial-analysis detection) is green.
