# recipe-finder — skill package

Cited integration recipes for the library you're about to use, mined from real
open-source repos with **entire-graph**. Drop this into any project so your
coding agent (or you) can pull a proven wiring pattern with real `file:line`
receipts.

## What's inside

```
SKILL.md                      the skill definition (agent instructions)
engine/libraries.mjs          library specs (repos + step signals)
engine/graph.mjs              adapter over the entire-graph CLI
engine/mine.mjs               orchestrator: clone → edges → aggregate → JSON
engine/cli.mjs                query / mine / list entry
lib/recipes.generated.json    pre-mined corpus (so `query` works immediately)
```

## Install

1. Copy the `recipe-finder/` folder into your project root (SKILL.md can live at
   `.claude/skills/recipe-finder/SKILL.md` for Claude Code).
2. Use it right away against the bundled corpus:

   ```bash
   node engine/cli.mjs query "collaborative rich-text editor" --json
   node engine/cli.mjs list
   ```

## Mine fresh data (optional)

Requires the `entire` CLI + graph plugin and `git`:

```bash
curl -fsSL https://entire.io/install.sh | bash
entire plugin install graph
node engine/cli.mjs mine tiptap
```

Every recipe step is evidence, not an oracle — open a receipt to confirm against
the current library version before you ship.
