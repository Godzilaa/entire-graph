// The FULLY-RESOLVABLE part of the fixture: a plain library integration the
// graph can parse and resolve. Imports are real declarations; the calls resolve
// to external symbols of @tiptap/react (by name — the honest ceiling for an
// external API). This is the "existing behaviour for fully resolved code must
// continue to work" case: it should still produce a real recipe with receipts.
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import * as Y from "yjs";

export function Editor() {
  const ydoc = new Y.Doc();
  const editor = useEditor({
    extensions: [StarterKit, Collaboration.configure({ document: ydoc })],
  });
  return <EditorContent editor={editor} />;
}
