"use client";

import { useState } from "react";
import { type Recipe, type Step, type EvidenceTier } from "@/lib/recipes";

type ApiRecipe = Recipe & { source?: string };

type View = "hero" | "search" | "results";

const CHIPS = [
  { emoji: "✍️", label: "collab editor", q: "collaborative rich-text editor with comments" },
  { emoji: "🗂️", label: "kanban board", q: "drag and drop kanban board" },
  { emoji: "📊", label: "data grid", q: "data table with sorting and filtering" },
  { emoji: "🔐", label: "auth flow", q: "authentication with email and oauth" },
];

export default function Home() {
  const [view, setView] = useState<View>("hero");
  const [query, setQuery] = useState("");
  const [recipe, setRecipe] = useState<ApiRecipe | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  async function runSearch(q: string) {
    setView("results");
    setRecipe(null);
    setNotFound(false);
    setLoading(true);
    setLoadingMsg("Searching the corpus…");
    try {
      let res = await fetch(`/api/recipe?q=${encodeURIComponent(q)}`);
      if (res.status === 404) {
        setLoadingMsg(
          "Not in the corpus — mining real repos with entire-graph… (can take a minute)"
        );
        res = await fetch(`/api/recipe?q=${encodeURIComponent(q)}&live=1`);
      }
      if (res.ok) setRecipe(await res.json());
      else setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) runSearch(query);
  }

  return (
    <>
      {/* Liquid-glass refraction filter (feTurbulence -> feDisplacementMap),
          the CSS-native equivalent of dashersw/liquid-glass-js's WebGL warp */}
      <svg
        aria-hidden
        style={{ position: "absolute", width: 0, height: 0 }}
      >
        <filter id="liquid-glass" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.009 0.011"
            numOctaves={2}
            seed={42}
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation={2} result="blurred" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="blurred"
            scale={38}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>

      <div className="bg-image" />
      <div className="bg-tint" />

      {/* Nav — compact centered glass pill */}
      <nav className="glass nav">
        <div className="nav-logo" onClick={() => setView("hero")}>
          <svg width="34" height="20" viewBox="0 0 34 20" aria-label="logo">
            <path d="M2 1h7a9 9 0 0 1 0 18H2z" fill="#0d1f33" />
            <path d="M15 1h7a9 9 0 0 1 0 18h-7z" fill="#0d1f33" />
          </svg>
          <span className="nav-wordmark">recipe</span>
        </div>
        <div className="nav-links">
          <a onClick={() => setView("hero")}>How it works</a>
          <a onClick={() => setView("search")}>Recipes</a>
          <a onClick={() => setView("search")}>Repositories</a>
          <a href="/docs">Docs</a>
        </div>
        <button className="pill-contact" onClick={() => setView("search")}>
          Find a recipe
        </button>
      </nav>

      <main className="stage">
        {/* HERO */}
        <section className={`view view-hero ${view === "hero" ? "is-active" : ""}`}>
          <div className="hero">
            <div className="glass pill label-pill">
              <span className="diamond">◆</span> Powered by Entire Graph
            </div>
            <h1 className="hero-title">
              Integrate any library
              <br />
              <em>the way real repos do</em>
            </h1>
            <p className="hero-sub">
              Describe what you&apos;re building and get a proven, cited recipe —
              mined from how real repos wire it together. Search it on the web, or
              download the skill so your coding agent pulls recipes mid-task.
            </p>
            <div className="hero-actions">
              <button
                className="btn btn-dark btn-icon"
                onClick={() => setView("search")}
              >
                Find a recipe
                <span className="btn-circle">↗</span>
              </button>
              <a
                className="btn btn-ghost glass"
                href="/recipe-finder-skill.zip"
                download
              >
                ↓ Download skill
              </a>
            </div>
          </div>
        </section>

        {/* SEARCH */}
        <section className={`view view-search ${view === "search" ? "is-active" : ""}`}>
          <div className="search-wrap">
            <div className="glass pill label-pill center">
              <span className="dot" /> mined from real repositories
            </div>
            <h2 className="search-title">
              What are you <em>building?</em>
            </h2>
            <form className="glass search-box" onSubmit={onSubmit}>
              <span className="search-icon">🔍</span>
              <input
                id="search-input"
                autoComplete="off"
                placeholder="collaborative rich-text editor with comments…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-dark search-go">
                Find recipe
              </button>
            </form>
            <div className="chips">
              {CHIPS.map((c) => (
                <button
                  key={c.label}
                  className="glass chip"
                  onClick={() => {
                    setQuery(c.q);
                    runSearch(c.q);
                  }}
                >
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* RESULTS */}
        <section className={`view view-results ${view === "results" ? "is-active" : ""}`}>
          <div className="results-wrap">
            <button className="glass pill back-btn" onClick={() => setView("search")}>
              ← new search
            </button>
            {loading ? (
              <div className="glass loading-card" style={{ borderRadius: 20 }}>
                <span className="spinner" />
                {loadingMsg}
              </div>
            ) : null}
            {!loading && recipe ? <RecipeView recipe={recipe} /> : null}
            {!loading && notFound ? (
              <div className="glass empty" style={{ borderRadius: 20 }}>
                Couldn&apos;t mine a recipe for that. Try “collab editor”, “kanban
                board”, “data grid”, or “auth flow”.
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}

function RecipeView({ recipe }: { recipe: ApiRecipe }) {
  return (
    <div>
      <div className="recipe-head">
        <span className="recipe-kicker">
          Recipe · {recipe.library}
          {recipe.source ? (
            <span className="source-badge">served via {recipe.source}</span>
          ) : null}
        </span>
        <h2 className="recipe-title">
          {recipe.title} <em>{recipe.emphasis}</em>
        </h2>
        <p className="recipe-meta">
          Mined from {recipe.reposMined} repositories · {recipe.callSites} call
          sites · runners-up: {recipe.runnersUp}
        </p>
        {recipe.resolver ? (
          <p className="recipe-meta resolver-note">
            🤖 LLM suggested <b>{recipe.resolver.suggested.join(", ") || "—"}</b> →
            graph confirmed <b>{recipe.resolver.confirmed}</b>. Suggestions are a
            starting point; the receipts below are the proof.
          </p>
        ) : null}
      </div>

      <EvidenceBanner recipe={recipe} />

      {recipe.steps.map((step, i) => (
        <div key={step.name} className="glass step">
          <div className="step-head">
            <div className="step-name">
              <span className="step-num">{i + 1}</span>
              {step.name}
            </div>
            <div className="step-badges">
              <TierBadge step={step} />
              <span className={`freq ${step.level === "high" ? "freq-high" : "freq-warn"}`}>
                {step.level === "high" ? "✓ " : "⚠ "}
                {step.freq} repos
              </span>
            </div>
          </div>
          {step.code ? <code>{step.code}</code> : null}
          {step.note ? <p className="step-note">{step.note}</p> : null}
          {step.caveat ? <p className="step-caveat">{step.caveat}</p> : null}
          <div className="receipts">
            {step.receipts.map((r, ri) => (
              <a
                key={`${r.label}-${ri}`}
                className="receipt"
                href={r.url}
                target="_blank"
                rel="noreferrer"
              >
                {r.label}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const TIER_META: Record<EvidenceTier, { label: string; icon: string }> = {
  confirmed: { label: "confirmed", icon: "✓" },
  heuristic: { label: "heuristic · verify", icon: "≈" },
  unverified: { label: "unverified · check source", icon: "?" },
};

// Per-step honesty badge: tells confirmed structural evidence apart from a
// name-matched guess or a graph blind spot. No badge for un-graded (curated)
// steps so older/hand-authored recipes still render cleanly.
function TierBadge({ step }: { step: Step }) {
  const tier = step.evidence?.tier;
  if (!tier) return null;
  const m = TIER_META[tier];
  return (
    <span className={`tier tier-${tier}`} title={step.caveat || ""}>
      {m.icon} {m.label}
    </span>
  );
}

// Replaces the old "every step is graph-verified — no guesses" banner. Now it
// reports whether the mined analysis was COMPLETE and, when it was partial,
// surfaces exactly why plus the verification path. Falls back to a measured
// message for un-graded (curated) recipes.
function EvidenceBanner({ recipe }: { recipe: Recipe }) {
  const a = recipe.analysis;
  if (!a) {
    return (
      <div className="glass verify-banner" style={{ borderRadius: 16 }}>
        🔎{" "}
        <span>
          Each step is backed by a real <b>file:line</b> receipt — evidence, not
          an oracle. Click a receipt and confirm against your installed version.
        </span>
      </div>
    );
  }
  if (a.complete) {
    return (
      <div className="glass verify-banner" style={{ borderRadius: 16 }}>
        ✅{" "}
        <span>
          All {a.reposMined} repos parsed cleanly. Steps are graded by graph
          evidence: <b>confirmed</b> = resolved edges, <b>heuristic</b> =
          name-matched (verify). {a.verify}
        </span>
      </div>
    );
  }
  return (
    <div className="glass verify-banner verify-banner-warn" style={{ borderRadius: 16 }}>
      ⚠️{" "}
      <span>
        <b>Partial analysis.</b> {a.verify}
        {a.reasons.length ? (
          <ul className="analysis-reasons">
            {a.reasons.slice(0, 4).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
      </span>
    </div>
  );
}
