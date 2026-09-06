// Per-library mining spec.
// STEP STRUCTURE is authored; EVIDENCE (frequencies + file:line receipts) is
// mined from real repos by engine/mine.mjs using `entire graph edges`.
//
// Step kinds:
//   kind: "imports" — count IMPORTS edges to external modules in `modules`
//   kind: "calls"   — count CALLS/CONSTRUCTS edges whose called/constructed
//                     name is in `symbols`

export const LIBRARIES = {
  tiptap: {
    id: "tiptap-collab-editor",
    library: "tiptap",
    title: "A collaborative rich-text",
    emphasis: "editor",
    runnersUp: "Lexical, Slate, ProseMirror",
    keywords: [
      "editor", "rich text", "rich-text", "collaborative", "collab",
      "google docs", "docs", "wysiwyg", "tiptap", "prosemirror",
      "comments", "writing",
    ],
    // real repos that use tiptap (shallow-cloned by the engine)
    repos: [
      "https://github.com/steven-tey/novel",
      "https://github.com/yjs/yjs-demos",
      "https://github.com/sereneinserenade/tiptap-comment-extension",
    ],
    steps: [
      {
        name: "Install",
        kind: "imports",
        modules: [
          "@tiptap/react", "@tiptap/core", "@tiptap/starter-kit",
          "@tiptap/extension-collaboration", "@tiptap/pm",
          "yjs", "y-websocket", "y-prosemirror", "@hocuspocus/provider",
        ],
        note: "Packages the mined repos actually import together (not just declare).",
      },
      {
        name: "Core editor setup",
        kind: "calls",
        symbols: ["useEditor", "Editor"],
        code: "const editor = useEditor({\n  extensions: [StarterKit, /* … */],\n})",
        note: "The dominant wiring: useEditor / new Editor with StarterKit + extensions.",
      },
      {
        name: "Realtime collaboration provider",
        kind: "calls",
        symbols: ["WebsocketProvider", "HocuspocusProvider", "Doc"],
        code: "const ydoc = new Y.Doc()\nnew WebsocketProvider(WS_URL, room, ydoc)",
        note: "Realtime layer paired with the editor: a Yjs doc + a websocket provider.",
      },
      {
        name: "Inline comments",
        kind: "calls",
        symbols: ["Mark", "mergeAttributes", "addAttributes", "Comment"],
        code: "Mark.create({ name: 'comment', /* addAttributes… */ })",
        note: "Less standardized — repos hand-roll a custom Mark for comments.",
      },
    ],
  },
};
