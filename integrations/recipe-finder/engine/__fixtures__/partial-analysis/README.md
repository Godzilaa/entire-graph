# partial-analysis fixture

A deliberately **partially analyzable** repository, used by
`engine/evidence.test.mjs` to prove the recipe engine never presents incomplete
graph evidence as certain ("the graph is evidence, not an oracle").

It contains three kinds of code on purpose:

| File | What the graph can do | Evidence tier it should drive |
|---|---|---|
| `src/editor.jsx` | Parses; imports resolve; library API calls resolve to `external:symbol:` **by name** | Install → **confirmed**; API steps → **heuristic** (`name_only`) |
| `src/dynamic.js` | Parses, but calls go through a runtime registry / `require(var)` — targets **unresolved** | **unverified** (a blind spot, not an absence) |
| `src/legacy.sql` | **Fails to parse** → surfaces as a `partial_failure` (`E_PARSE_ERROR`) | Forces the whole recipe's `analysis.complete = false` |

`partial-analysis-edges.ndjson` (sibling file) is a captured `entire graph edges`
run over this repo — a deterministic golden the test consumes so it can assert
the grading without needing a live `entire` binary.
