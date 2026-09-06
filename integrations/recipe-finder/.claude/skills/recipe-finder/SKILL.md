---
name: recipe-finder
description: Turn an end goal ("realtime collaborative editor", "drag-and-drop kanban", "email + OAuth auth") into a proven, cited integration recipe — WITHOUT knowing the library up front. It discovers real repos for the goal, lets entire-graph resolve which library they actually use, mines the real APIs, and returns a playbook where every step has a real file:line receipt. Use whenever the user is about to build a feature and needs the right packages + wiring, or asks "how do I build X" / "what's the standard way to do Y".
---

# recipe-finder

The user says the **end goal** — not a library. The engine finds real repos that
solve it, lets **entire-graph** resolve which library those repos actually use,
mines the real API calls, and returns a cited playbook. Every step is backed by a
real `file:line` receipt, not a guess.

## The one command

```bash
node engine/cli.mjs generate "<the end goal>" --json
```

That alone will: discover repos via GitHub → clone → run `entire graph edges` →
resolve the dominant library → derive install + API steps with receipts. Example
goals: `"realtime collaborative editor"`, `"drag and drop kanban board"`,
`"data table with sorting"`, `"email and oauth auth"`.

## You (the agent) provide judgment — the engine provides evidence

Auto-discovery is grounded but blunt. You make it sharp. After a first run, look
at the resolved `library` and `sources`:

- **Wrong library?** The graph reports what the repos truly import (e.g. a kanban
  repo may use `react-dnd`, not `@dnd-kit`). Trust it — or if you know a better
  fit, pin it:
  ```bash
  node engine/cli.mjs generate "kanban board" --package @dnd-kit/core --json
  ```
- **Weak/irrelevant repos?** Supply focused example repos yourself — this gives
  the cleanest, highest-frequency playbook:
  ```bash
  node engine/cli.mjs generate "kanban board" \
    --repos "https://github.com/user/a,https://github.com/user/b" --json
  ```

`--package` and `--repos` are optional refinements; the goal alone is enough to start.

## How to use the result

The JSON is `{ library, reposMined, sources, analysis, steps: [{ name, freq,
level, code, evidence, caveat, receipts }] }`.

**The graph is evidence, not an oracle — the result tells you how much to trust each part.**

1. **Check `analysis` FIRST.** `analysis.complete` is `false` when the repos were
   only partially analyzed (a file failed to parse, or a repo produced no
   resolvable relations — a blind spot). When it is `false`, a *missing* step is
   NOT proof the step is unnecessary; it may just be unanalyzed. Read
   `analysis.reasons` and follow `analysis.verify` before trusting completeness.
2. **Read each step's `evidence.tier`** — this is the honesty signal:
   - `confirmed` — the graph resolved this edge to a real definition/import. Safe
     default; still pin to your installed version.
   - `heuristic` — matched by name or inference (dynamic dispatch / overloads can
     fool it). Likely right, but **open a receipt and confirm against source.**
   - `unverified` — the graph could not resolve it. Treat as a lead only; confirm
     against source or a test.
   If `evidence.verify` is `true` (always true under partial analysis), verify
   before relying on the step.
3. `freq` (`high`/`warn`) is the cross-repo frequency; `evidence.tier` is the
   structural certainty. They are different axes — a `high`-frequency step can
   still be `heuristic`.
4. **Open a receipt** (`file:line`) to see how a real repo wired it before you
   write the equivalent here.
5. Then scaffold the feature using the dominant pattern — verifying every
   `heuristic`/`unverified` step, and re-mining with `--repos` if `analysis`
   flagged the set as partial or blind.

## Also available

```bash
node engine/cli.mjs query "<goal>"   # search the already-mined corpus (instant)
node engine/cli.mjs list             # what's been mined so far
```

## Requirements

- `entire` CLI + graph plugin (`entire plugin install graph`)
- `gh` (authenticated) for repo discovery, `git`, `node`

## Don't

- Don't ask the user which library to use — that's the point; infer it from the
  goal and let the graph confirm.
- Don't present a step without its receipts. The citations are the product.
