"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const GROUPS = [
  {
    title: "Getting Started",
    items: [
      { id: "introduction", label: "Introduction" },
      { id: "quickstart", label: "Quickstart" },
    ],
  },
  {
    title: "Concepts",
    items: [
      { id: "how-it-works", label: "How it works" },
      { id: "generation", label: "Goal-driven generation" },
      { id: "architecture", label: "Architecture" },
    ],
  },
  {
    title: "Reference",
    items: [
      { id: "skill", label: "Using the skill" },
      { id: "web-api", label: "Web API" },
      { id: "cli", label: "CLI" },
    ],
  },
];
const SECTIONS = GROUPS.flatMap((g) => g.items);

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
  return active;
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-code">
      <button
        className="docs-copy"
        onClick={() => {
          navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return <div className="docs-callout">{children}</div>;
}

export default function DocsPage() {
  const active = useActiveSection(SECTIONS.map((s) => s.id));

  return (
    <div className="docs">
      <header className="docs-topbar">
        <Link href="/" className="docs-brand">
          <span className="docs-mark">◆</span> recipe{" "}
          <span className="docs-sep">/</span> docs
        </Link>
        <nav className="docs-topnav">
          <Link href="/">Home</Link>
          <a href="/recipe-finder-skill.zip" download>
            Download skill
          </a>
          <a href="/api/recipe?q=collaborative+editor" target="_blank" rel="noreferrer">
            API
          </a>
        </nav>
      </header>

      <div className="docs-layout">
        {/* left: grouped nav */}
        <aside className="docs-sidebar">
          {GROUPS.map((g) => (
            <div key={g.title} className="docs-group">
              <div className="docs-group-title">{g.title}</div>
              {g.items.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className={`docs-side-link ${active === n.id ? "active" : ""}`}
                >
                  {n.label}
                </a>
              ))}
            </div>
          ))}
        </aside>

        {/* center: content */}
        <main className="docs-main">
          <div className="docs-breadcrumb">Docs / Introduction</div>
          <span className="docs-eyebrow">Powered by Entire Graph</span>
          <h1>Recipe documentation</h1>
          <p className="docs-lead">
            <strong>recipe</strong> turns an end goal — “realtime collaborative
            editor”, “drag-and-drop kanban” — into a proven, cited integration
            recipe. It discovers real repos, lets{" "}
            <a href="https://entire.io" target="_blank" rel="noreferrer">
              entire-graph
            </a>{" "}
            resolve the library they actually use, mines the real APIs, and
            returns a playbook where every step has a real <code>file:line</code>{" "}
            receipt.
          </p>

          <section id="introduction">
            <h2>Introduction</h2>
            <p>
              Search engines tell you a library <em>exists</em>. recipe tells you
              how mature codebases actually <em>wire it up</em> — which packages
              ship together, the dominant setup call, and the parts that are still
              hand-rolled. You never name the library; you name the goal.
            </p>
            <p>There are two ways to use it:</p>
            <ul>
              <li>
                <strong>The web app</strong> — describe what you&apos;re building,
                get the recipe in the browser.
              </li>
              <li>
                <strong>The skill / CLI</strong> —{" "}
                <a href="/recipe-finder-skill.zip" download>
                  download the skill
                </a>{" "}
                so a coding agent pulls the recipe mid-task and acts on the JSON.
              </li>
            </ul>
          </section>

          <section id="quickstart">
            <h2>Quickstart</h2>
            <p>From the project root, describe your goal:</p>
            <CodeBlock code={`node engine/cli.mjs generate "realtime collaborative editor" --json`} />
            <p>
              That single command discovers repos, mines them with entire-graph,
              resolves the library, and prints the cited playbook. Or query the API
              directly:
            </p>
            <CodeBlock code={`curl "https://<your-host>/api/recipe?q=collaborative+editor"`} />
            <Callout>
              Every step&apos;s <code>freq</code> (e.g. <code>3/3</code>) is
              confidence. Open a receipt to see the real source before you copy the
              pattern — evidence, not an oracle.
            </Callout>
          </section>

          <section id="how-it-works">
            <h2>How it works</h2>
            <p>
              For a goal, the engine mines real repos and runs{" "}
              <code>entire graph edges</code> over each, keeping three relation
              types:
            </p>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Relation</th>
                  <th>What it tells us</th>
                  <th>Becomes</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>IMPORTS</code></td>
                  <td>Which packages a repo actually imports</td>
                  <td>Install step + library resolution</td>
                </tr>
                <tr>
                  <td><code>CALLS</code></td>
                  <td>Where APIs like <code>useEditor</code> are invoked</td>
                  <td>Wiring steps + receipts</td>
                </tr>
                <tr>
                  <td><code>CONSTRUCTS</code></td>
                  <td>Where objects like <code>WebsocketProvider</code> are built</td>
                  <td>Provider / feature steps</td>
                </tr>
              </tbody>
            </table>
            <p>
              Results are aggregated into <strong>frequencies</strong> (how many
              repos do this) and <strong>receipts</strong> (the exact{" "}
              <code>file:line</code>). Majority usage is <code>high</code>{" "}
              confidence; rare usage is <code>warn</code> — a signal it isn&apos;t
              standardized.
            </p>
          </section>

          <section id="generation">
            <h2>Goal-driven generation</h2>
            <p>
              You don&apos;t pick the library — the graph does. Given only a goal,
              the engine discovers repos, then resolves the dominant library from
              what they truly import (framework and UI-kit noise filtered out).
            </p>
            <CodeBlock code={`node engine/cli.mjs generate "drag and drop kanban board"
# → resolves @dnd-kit/sortable, mines useSortable / useSensor with receipts`} />
            <p>
              The graph reports the truth — many “kanban” repos use{" "}
              <code>react-dnd</code>, not <code>@dnd-kit</code>. When you want to
              steer it, pin the package or supply focused repos:
            </p>
            <CodeBlock code={`node engine/cli.mjs generate "kanban board" --package @dnd-kit/core --json
node engine/cli.mjs generate "kanban board" --repos "https://github.com/a/b,https://github.com/c/d"`} />
          </section>

          <section id="architecture">
            <h2>Architecture</h2>
            <CodeBlock code={`engine/
  libraries.mjs   authored library specs (repos + step signals)
  graph.mjs       the ONLY adapter over the entire-graph CLI
  mine.mjs        mine an authored spec → corpus
  generate.mjs    goal-driven: discover → mine → derive playbook
  cli.mjs         generate / query / mine / list (used by the skill)
lib/
  recipes.ts             merges mined data over hand-authored fallback
  recipes.generated.json mined corpus
app/
  page.tsx        the web dashboard
  api/recipe/     the public query endpoint (corpus + live-generate)
  docs/           this page`} />
            <p>
              <code>graph.mjs</code> is the single point that shells out to
              entire-graph, so the pipeline swaps cleanly if the CLI changes.
            </p>
          </section>

          <section id="skill">
            <h2>Using the skill</h2>
            <p>
              The <code>recipe-finder</code> skill lets a coding agent pull a
              recipe while it works. It ships with a pre-mined corpus, so it works
              the moment it lands.
            </p>
            <p>
              <a className="docs-download" href="/recipe-finder-skill.zip" download>
                ↓ Download the skill (.zip)
              </a>
            </p>
            <p>
              Place <code>SKILL.md</code> at{" "}
              <code>.claude/skills/recipe-finder/SKILL.md</code>, then let the agent
              run the engine it wraps. The agent supplies judgment (which repos,
              which package) and the graph supplies the evidence.
            </p>
          </section>

          <section id="web-api">
            <h2>Web API</h2>
            <p>
              The same engine is exposed over HTTP, so anyone (or any tool) can
              query it without the skill.
            </p>
            <h3><code>GET /api/recipe</code></h3>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Param</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>q</code></td>
                  <td>string</td>
                  <td>What you&apos;re building, in plain language.</td>
                </tr>
                <tr>
                  <td><code>live</code></td>
                  <td><code>1</code></td>
                  <td>Mine on-demand with entire-graph if not already in the corpus.</td>
                </tr>
              </tbody>
            </table>
            <CodeBlock code={`GET /api/recipe?q=drag+and+drop+kanban

{
  "library": "@dnd-kit/sortable",
  "reposMined": 1,
  "source": "corpus",
  "steps": [
    { "name": "Install", "freq": "1/1", "level": "high",
      "receipts": [{ "label": "react-kanban/…:20", "url": "…#L20" }] }
  ]
}`} />
          </section>

          <section id="cli">
            <h2>CLI</h2>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>generate &quot;&lt;goal&gt;&quot; [--package] [--repos]</code></td>
                  <td>Discover → mine → derive a playbook (add <code>--json</code>).</td>
                </tr>
                <tr>
                  <td><code>query &quot;&lt;goal&gt;&quot;</code></td>
                  <td>Search the already-mined corpus (instant).</td>
                </tr>
                <tr>
                  <td><code>mine &lt;library&gt;</code></td>
                  <td>Re-mine an authored library spec.</td>
                </tr>
                <tr>
                  <td><code>list</code></td>
                  <td>List mined recipes.</td>
                </tr>
              </tbody>
            </table>
          </section>

          <div className="docs-pagination">
            <Link href="/" className="docs-page-link">
              ← Back home
            </Link>
            <a href="/recipe-finder-skill.zip" download className="docs-page-link right">
              Download the skill →
            </a>
          </div>
          <footer className="docs-foot">
            Built on Entire Graph · deterministic, local, verifiable.
          </footer>
        </main>

        {/* right: on this page */}
        <aside className="docs-toc">
          <div className="docs-toc-title">On this page</div>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`docs-toc-link ${active === s.id ? "active" : ""}`}
            >
              {s.label}
            </a>
          ))}
        </aside>
      </div>
    </div>
  );
}
