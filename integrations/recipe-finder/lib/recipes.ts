export type Receipt = {
  label: string; // repo/path:line
  url: string;
};

// Evidence grade for one step — "the graph is evidence, not an oracle."
// Mirrors engine/evidence.mjs. Optional so hand-authored fallback recipes and
// older mined rows (without grading) still type-check and render.
export type EvidenceTier = "confirmed" | "heuristic" | "unverified";
export type Evidence = {
  tier: EvidenceTier;
  resolution: string; // dominant graph resolution, e.g. "import_resolved", "name_only"
  confidence: number;
  partial: boolean; // a backing repo was only partially analyzed
  verify: boolean; // must be confirmed against source/tests before relying on it
};

// Recipe-level partial-analysis summary from the mined repos' snapshots.
export type Analysis = {
  complete: boolean;
  confidence: "confirmed" | "partial" | "low";
  reposMined: number;
  reposCleanlyParsed: number;
  partialFailureCount: number;
  partialFailures: { repo: string; path: string; code: string }[];
  blindRepos: string[];
  reasons: string[];
  verify: string; // the safe fallback / verification path
};

export type Step = {
  name: string;
  freq: string; // e.g. "8/10"
  level: "high" | "warn";
  code?: string;
  note?: string;
  evidence?: Evidence;
  caveat?: string;
  receipts: Receipt[];
};

export type Recipe = {
  id: string;
  library: string;
  title: string; // shown with <em> around the italic-serif part via {emphasis}
  emphasis: string;
  reposMined: number;
  callSites: number;
  runnersUp: string;
  keywords: string[];
  steps: Step[];
  analysis?: Analysis;
  // Present only when the optional LLM resolver seeded discovery. The recipe is
  // still built from real graph edges; this records LLM suggestion vs. what the
  // graph confirmed, so users/agents know a model was in the loop.
  resolver?: {
    model: string | null;
    ecosystem: string;
    suggested: string[];
    confirmed: string;
  };
};

import generatedJson from "./recipes.generated.json";

// Recipes mined by the entire-graph engine (engine/mine.mjs). Falls back to the
// hand-authored set below when the engine hasn't run yet.
const GENERATED = generatedJson as unknown as Recipe[];

const FALLBACK_RECIPES: Recipe[] = [
  {
    id: "tiptap-collab-editor",
    library: "tiptap",
    title: "A collaborative rich-text",
    emphasis: "editor",
    reposMined: 10,
    callSites: 24,
    runnersUp: "Lexical, Slate, ProseMirror",
    keywords: [
      "editor",
      "rich text",
      "rich-text",
      "collaborative",
      "collab",
      "google docs",
      "docs",
      "wysiwyg",
      "tiptap",
      "prosemirror",
      "comments",
      "writing",
    ],
    steps: [
      {
        name: "Install",
        freq: "8/10",
        level: "high",
        code: "@tiptap/react @tiptap/starter-kit\n@tiptap/extension-collaboration yjs y-websocket",
        note: "8 of 10 collab-editor repos pull tiptap + yjs together — yjs is effectively required, not optional.",
        receipts: [
          {
            label: "steven-tey/novel · package.json:31",
            url: "https://github.com/steven-tey/novel/blob/main/package.json",
          },
          {
            label: "outline/outline · package.json:88",
            url: "https://github.com/outline/outline/blob/main/package.json",
          },
        ],
      },
      {
        name: "Core editor setup",
        freq: "9/10",
        level: "high",
        code: "const editor = useEditor({\n  extensions: [\n    StarterKit,\n    Collaboration.configure({ document: ydoc }),\n  ],\n})",
        note: "The dominant wiring: StarterKit + a single Collaboration extension bound to a shared Y.Doc.",
        receipts: [
          {
            label: "steven-tey/novel · editor.tsx:42",
            url: "https://github.com/steven-tey/novel",
          },
          {
            label: "toeverything/affine · editor.ts:88",
            url: "https://github.com/toeverything/AFFiNE",
          },
          {
            label: "ueberdosis/tiptap · Collaboration.ts:14",
            url: "https://github.com/ueberdosis/tiptap",
          },
        ],
      },
      {
        name: "Realtime provider (commonly paired)",
        freq: "7/10",
        level: "high",
        code: "const ydoc = new Y.Doc()\nnew WebsocketProvider(WS_URL, roomName, ydoc)",
        note: "Graph co-change analysis: WebsocketProvider is created in the same file as the editor in 7/10 repos.",
        receipts: [
          {
            label: "outline/outline · app/editor/index.tsx:31",
            url: "https://github.com/outline/outline",
          },
          {
            label: "hocuspocus/demos · provider.ts:9",
            url: "https://github.com/ueberdosis/hocuspocus",
          },
        ],
      },
      {
        name: "Inline comments",
        freq: "4/10",
        level: "warn",
        code: "Mark.create({ name: 'comment', /* addAttributes… */ })",
        note: "Less standardized — repos hand-roll a custom Mark. No dominant library; treat as a build-it-yourself surface.",
        receipts: [
          {
            label: "outline/outline · marks/Comment.ts:12",
            url: "https://github.com/outline/outline",
          },
        ],
      },
    ],
  },
  {
    id: "dnd-kanban",
    library: "@dnd-kit/core",
    title: "A drag-and-drop",
    emphasis: "kanban board",
    reposMined: 8,
    callSites: 17,
    runnersUp: "react-beautiful-dnd (deprecated), Pragmatic DnD",
    keywords: ["kanban", "drag", "drop", "drag and drop", "board", "sortable", "trello", "dnd"],
    steps: [
      {
        name: "Install",
        freq: "6/8",
        level: "high",
        code: "@dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities",
        note: "New repos favor @dnd-kit over the now-deprecated react-beautiful-dnd (6/8 recent projects).",
        receipts: [
          {
            label: "clauderic/dnd-kit · package.json:20",
            url: "https://github.com/clauderic/dnd-kit",
          },
        ],
      },
      {
        name: "Context + sensors",
        freq: "8/8",
        level: "high",
        code: "<DndContext sensors={sensors} onDragEnd={handleDragEnd}>\n  <SortableContext items={ids}>…</SortableContext>\n</DndContext>",
        note: "Every repo wraps columns in DndContext and each column in a SortableContext.",
        receipts: [
          {
            label: "clauderic/dnd-kit · Board.tsx:44",
            url: "https://github.com/clauderic/dnd-kit",
          },
        ],
      },
      {
        name: "Reorder on drag end",
        freq: "7/8",
        level: "high",
        code: "const next = arrayMove(items, oldIndex, newIndex)",
        note: "arrayMove from @dnd-kit/sortable is the standard reorder primitive.",
        receipts: [
          {
            label: "clauderic/dnd-kit · utilities.ts:8",
            url: "https://github.com/clauderic/dnd-kit",
          },
        ],
      },
    ],
  },
  {
    id: "tanstack-table",
    library: "@tanstack/react-table",
    title: "A sortable, filterable",
    emphasis: "data grid",
    reposMined: 9,
    callSites: 21,
    runnersUp: "AG Grid, MUI DataGrid",
    keywords: ["data table", "data grid", "table", "sorting", "filtering", "grid", "datagrid", "tanstack"],
    steps: [
      {
        name: "Install",
        freq: "9/9",
        level: "high",
        code: "@tanstack/react-table",
        note: "Headless — bring your own markup. Universal across the sampled repos.",
        receipts: [
          {
            label: "TanStack/table · package.json:12",
            url: "https://github.com/TanStack/table",
          },
        ],
      },
      {
        name: "Build the table instance",
        freq: "9/9",
        level: "high",
        code: "const table = useReactTable({\n  data, columns,\n  getCoreRowModel: getCoreRowModel(),\n  getSortedRowModel: getSortedRowModel(),\n  getFilteredRowModel: getFilteredRowModel(),\n})",
        note: "Sorting + filtering are opt-in row models — repos add exactly the ones they use.",
        receipts: [
          {
            label: "TanStack/table · useReactTable.ts:30",
            url: "https://github.com/TanStack/table",
          },
          {
            label: "shadcn-ui/ui · data-table.tsx:52",
            url: "https://github.com/shadcn-ui/ui",
          },
        ],
      },
    ],
  },
  {
    id: "authjs",
    library: "next-auth (Auth.js)",
    title: "Email + OAuth",
    emphasis: "authentication",
    reposMined: 11,
    callSites: 28,
    runnersUp: "Clerk, Lucia, Supabase Auth",
    keywords: ["auth", "authentication", "oauth", "login", "sign in", "email", "session", "nextauth", "authjs"],
    steps: [
      {
        name: "Install",
        freq: "11/11",
        level: "high",
        code: "next-auth@beta",
        note: "Auth.js v5 is the norm in current Next.js repos.",
        receipts: [
          {
            label: "nextauthjs/next-auth · package.json:40",
            url: "https://github.com/nextauthjs/next-auth",
          },
        ],
      },
      {
        name: "Central config + handlers",
        freq: "10/11",
        level: "high",
        code: "export const { handlers, auth } = NextAuth({\n  providers: [GitHub, Google, Email],\n})",
        note: "A single auth.ts exporting handlers + auth() is the dominant pattern.",
        receipts: [
          {
            label: "nextauthjs/next-auth · auth.ts:5",
            url: "https://github.com/nextauthjs/next-auth",
          },
        ],
      },
    ],
  },
];

// Mined recipes take precedence; hand-authored ones fill in libraries the
// engine hasn't mined yet.
const minedIds = new Set(GENERATED.map((r) => r.id));
export const RECIPES: Recipe[] = [
  ...GENERATED,
  ...FALLBACK_RECIPES.filter((r) => !minedIds.has(r.id)),
];

// Stopwords + generic web words that must never act as match keywords — without
// this "and"/"a"/"react" match almost any query and a random goal wrongly
// resolves to a stale corpus recipe instead of falling through to live mining.
export const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "with", "app",
  "apps", "react", "vue", "svelte", "build", "building", "using", "use", "my",
  "your", "how", "do", "i", "is", "it", "that", "this", "want", "need", "make",
  "web", "site", "page",
]);
// A lone single-token keyword this long is distinctive enough to match on its
// own ("kanban", "wysiwyg", "roulette"); shorter generic words ("table",
// "email", "board", "login") must not win alone.
export const DISTINCTIVE_LEN = 6;

const norm = (s: string) => s.toLowerCase().replace(/[-_]/g, " ").trim();

// Score a query against a recipe's keywords AND decide if the match is
// trustworthy. Single-token keywords must match a whole query word (so "board"
// does NOT match "keyboard"); multi-word phrases match as a normalized
// substring. Stopwords are ignored. A match is only ACCEPTED when the signal is
// real — a phrase hit, OR two distinct word hits, OR one distinctive long word —
// so a random query that merely shares one generic word (e.g. "table") misses
// and falls through to live mining instead of serving a stale recipe.
export function matchScore(
  query: string,
  keywords: string[]
): { score: number; accept: boolean } {
  const nq = norm(query);
  if (!nq) return { score: 0, accept: false };
  const tokens = new Set(nq.split(/\s+/).filter(Boolean));
  let score = 0;
  let phraseHits = 0;
  let tokenHits = 0;
  let bestLoneLen = 0;
  for (const raw of keywords || []) {
    if (!raw || STOPWORDS.has(raw.toLowerCase().trim())) continue;
    const kw = norm(raw);
    if (!kw) continue;
    if (kw.includes(" ")) {
      if (nq.includes(kw)) {
        score += kw.length;
        phraseHits++;
      }
    } else if (tokens.has(kw)) {
      score += kw.length;
      tokenHits++;
      bestLoneLen = Math.max(bestLoneLen, kw.length);
    }
  }
  const accept = phraseHits >= 1 || tokenHits >= 2 || bestLoneLen >= DISTINCTIVE_LEN;
  return { score, accept };
}

// Derive clean match keywords from a goal: the full phrase plus each meaningful
// word (length >= 3, not a stopword), deduped.
export function keywordsFromGoal(goal: string): string[] {
  const g = goal.toLowerCase().trim();
  const words = g.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set([g, ...words].filter(Boolean))];
}

export function findRecipe(query: string): Recipe | null {
  let best: Recipe | null = null;
  let bestScore = 0;
  for (const r of RECIPES) {
    const { score, accept } = matchScore(query, r.keywords);
    if (accept && score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
