# recipe-finder — final semantic diff & verification

## Semantic diff of the submission

```
entire graph diff --base 3a2a715f --head HEAD
```

`3a2a715f` is the fork's baseline (merge of #211); `HEAD` is the full submission
(architecture checkpoint + implementation). Entity-level result:

| File | Status | Entity change |
|---|---|---|
| `docs/recipe-finder.md` | **A** | architecture/decision record — sections added |
| `docs/recipe-finder-graph-evidence.md` | **A** | search/def/impact evidence — sections added |
| `docs/recipe-finder-semantic-diff.md` | **A** | this file |
| `integrations/recipe-finder/**` | **A** | Next.js app + engine + skill (new subtree) |
| `skills/recipe-finder/SKILL.md` | **A** | repo-level skill |
| `.gitignore` | M | appended recipe-finder ignore rules |
| `.claude/settings.json` | M | reconfigured by `entire enable` (permissions/deny) |

**Key finding — the change is purely additive to the plugin.** The `changes`
list contains **no Go entities**: nothing under `internal/` or `cmd/` is added,
removed, renamed, or signature-changed. This honors the repo's contract rules
(frozen additive-only schema, no-egress provider, stable `compound-v1` IDs) — the
integration consumes the graph's public NDJSON surface without touching its
internals. (The `internal/sem/grammars/*.c` lines in the raw output are
pre-existing `E_FILE_TOO_LARGE`/`E_PARSE_ERROR` parse warnings on vendored
tree-sitter grammars, not changes introduced here.)

## Functional verification

The engine's sole graph adapter (`engine/graph.mjs`) was run against **this repo**:

```
graphAvailable: true
entire graph edges --relation IMPORTS  →  2302 relation records parsed
top external imports: strings(282), testing(255), os(140), path/filepath(140), fmt(97)
```

This exercises the exact contract the impact analysis identified: the adapter
parses `record_type:"relation"` lines from `WriteRelationsNDJSON` and extracts
modules from `to_id`. It ran successfully on the entire-graph codebase itself —
the integration works against the very provider it is built on.

`node engine/cli.mjs list` returns the mined corpus (tiptap, @dnd-kit, …),
confirming the CLI surface is intact.

> Graph results treated as evidence, verified against source and a real run —
> never presented as an oracle.
