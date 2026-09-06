# recipe-finder — Entire Graph evidence log

Graph output is **evidence, verified against source** — never an oracle. This log
records the required graph operations run while building the recipe-finder
integration, and what each one changed or confirmed.

## 1. Graph search — locate the NDJSON edge producer

```
entire graph search --query "stream relation edges as NDJSON for a repository" --top-k 5
```

Top hit: **`WriteRelationsNDJSON`** at `internal/sem/provider.go:1806`. This is the
exact function whose output recipe-finder's `engine/graph.mjs` parses (it shells
`entire graph edges --format ndjson` and reads `record_type:"relation"` lines).
The search grounded the integration in the real producer rather than a guess.

## 2. Definition lookup — confirm the contract

```
entire graph def WriteRelationsNDJSON --repo .
```

```go
func WriteRelationsNDJSON(out io.Writer, snapshot ProviderSnapshot) error
```

Emits a header line, then one JSON line per relation record. Confirms the shape
`graph.mjs` depends on (header + relation records).

## 3. Impact / relationship analysis — before building against it

```
entire graph impact --symbol WriteRelationsNDJSON --repo .
```

> Blast radius: **0 callers, 1 callee (`writeJSONLine`), 2 type consumers
> (`ProviderSnapshot`), 2 data flows, 19 co-change files.**

**What this told us:** 0 in-repo callers, yet it is an exported surface reached
through CLI wiring — so its NDJSON output is an *external* contract. A change to it
would break out-of-repo consumers (like recipe-finder) *without any in-repo caller
turning red*. That is precisely the class of decision the graph makes verifiable:
recipe-finder pins to the `record_type` + `to_id` shape of this stream, and treats
it as an interface, not an implementation detail.

Index scope at capture: 628 files parsed, 11,418 symbols, 56,878 relations,
completeness level `ok`.

## 4. Semantic diff — on the submitted implementation

Run at submission time over the integration commit (see
`docs/recipe-finder-semantic-diff.md`) to show which entities the change adds and
that it touches no existing plugin internals.
