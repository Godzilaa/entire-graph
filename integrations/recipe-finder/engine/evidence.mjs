// Evidence grading — "the graph is evidence, not an oracle."
//
// entire-graph tags every relation with a `resolution` (how the target was
// resolved) and a `confidence`, and every snapshot with `partial_failures`
// (files it could not parse) + `warnings`. The recipe engine USED to throw all
// of that away and present every mined step as certain ("graph-verified, no
// guesses"). That is a lie whenever the analysis was partial: a call resolved
// only by NAME (dynamic dispatch, an overload, a shadowed local) is a guess, and
// a repo with parse failures or an inventory-only language is a blind spot, not
// a confirmed absence.
//
// This module is the single source of truth for turning raw graph evidence into
// three honest tiers, so users AND agents can tell apart:
//   • confirmed  — structural evidence the graph fully resolved
//   • heuristic  — name-matched / inferred / partially-analyzed; likely but unproven
//   • unverified — the graph was blind here; you MUST check source or tests
//
// It is intentionally pure (no I/O) so it can be unit-tested against synthetic
// "incomplete analysis" records without cloning or a live `entire` binary.

export const TIERS = Object.freeze({
  CONFIRMED: "confirmed",
  HEURISTIC: "heuristic",
  UNVERIFIED: "unverified",
});

// Resolutions where the graph tied the edge to a concrete definition/import.
// These are the ones docs/semantic-provider-requirements.md and the provider
// emit as high-precision (see internal/sem/provider.go resolution assignment).
export const CONFIRMED_RES = new Set([
  "exact", "import_resolved", "import_external", "package", "resolved", "full",
]);
// Resolutions that are a best-effort guess: matched by name, inferred from a
// type, or a shallow/pattern heuristic. Real but not proven — the class of edge
// that dynamic dispatch / reflection / generated code silently corrupts.
export const HEURISTIC_RES = new Set([
  "name_only", "type_inferred", "pattern", "shallow", "signature", "git_history",
]);
// Anything the graph could not resolve at all.
export const UNRESOLVED_RES = new Set(["none", "unresolved", ""]);

// A resolved edge with weak confidence is not "confirmed" — cap it at heuristic.
export const CONFIRMED_MIN_CONFIDENCE = 0.75;

// Tier a single relation record from its resolution + confidence.
export function edgeTier(rec) {
  const res = (rec && rec.resolution) || "";
  const conf = typeof rec?.confidence === "number" ? rec.confidence : null;
  if (UNRESOLVED_RES.has(res)) return TIERS.UNVERIFIED;
  if (CONFIRMED_RES.has(res)) {
    if (conf !== null && conf < CONFIRMED_MIN_CONFIDENCE) return TIERS.HEURISTIC;
    return TIERS.CONFIRMED;
  }
  if (HEURISTIC_RES.has(res)) return TIERS.HEURISTIC;
  // Unknown/future resolution string: never over-claim — treat as heuristic.
  return TIERS.HEURISTIC;
}

const RANK = { [TIERS.CONFIRMED]: 3, [TIERS.HEURISTIC]: 2, [TIERS.UNVERIFIED]: 1 };
const better = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// Grade a step from the relation records that produced it. The TIER reflects the
// resolution quality of the step's own best evidence — that is an honest,
// data-driven signal, so fully-resolved code keeps its "confirmed" tier even
// when the recipe as a whole was mined from a partially-analyzed repo set
// (requirement: existing behaviour for fully resolved code must keep working).
//
// `partial` is a SEPARATE axis: the recipe's overall analysis was incomplete
// (a parse failure or a blind repo), so the frequency/denominator is suspect and
// the step must be verified against source — but that does NOT falsify a
// concretely-resolved edge. We surface both instead of collapsing them.
export function gradeStep(records, { partial = false } = {}) {
  const recs = (records || []).filter(Boolean);
  if (!recs.length) {
    // No backing edges at all -> a claim with no structural evidence.
    return { tier: TIERS.UNVERIFIED, resolution: "none", confidence: 0, partial, verify: true };
  }
  let tier = TIERS.UNVERIFIED;
  const resCount = new Map();
  let confSum = 0;
  let confN = 0;
  for (const r of recs) {
    tier = better(tier, edgeTier(r));
    const res = r.resolution || "unresolved";
    resCount.set(res, (resCount.get(res) || 0) + 1);
    if (typeof r.confidence === "number") { confSum += r.confidence; confN++; }
  }
  const resolution = [...resCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    tier,
    resolution,
    confidence: confN ? Number((confSum / confN).toFixed(2)) : 0,
    partial,
    // Verify against source whenever the evidence is not confirmed OR the recipe
    // was only partially analyzed (you may be missing steps this repo set could
    // not reveal).
    verify: tier !== TIERS.CONFIRMED || partial,
  };
}

// One-line human caveat for a graded step, so the UI/CLI can render honesty
// inline instead of the old blanket "graph-verified".
export function stepCaveat(evidence) {
  switch (evidence.tier) {
    case TIERS.CONFIRMED:
      return evidence.partial
        ? "Confirmed: the graph resolved this edge — but the recipe was mined from a partially-analyzed repo set, so it may be missing steps. Verify completeness against source."
        : "Confirmed: the graph resolved this to a real definition/import. Still pin to your installed version.";
    case TIERS.HEURISTIC:
      return evidence.partial
        ? "Heuristic: name-matched and some repos were only partially analyzed — open a receipt and confirm against source before relying on it."
        : "Heuristic: matched by name/inference (dynamic dispatch can fool this) — open a receipt and confirm against source.";
    default:
      return "Unverified: the graph could not resolve this — treat as a lead only and confirm against source or tests.";
  }
}

// Build the recipe-level analysis object from each mined repo's snapshot meta.
// repoMetas: [{ name, lang, relationCount, partialFailures:[{path,code}],
//               warnings:[], skippedRelationFamilies:[], completenessLevel, langKey }]
// minedLangKey: the single stack the recipe targeted.
export function buildAnalysis(repoMetas, minedLangKey) {
  const metas = (repoMetas || []).filter(Boolean);
  const reasons = [];
  const partialFailures = [];
  const blindRepos = [];
  let cleanRepos = 0;

  for (const m of metas) {
    const pf = m.partialFailures || [];
    for (const f of pf.slice(0, 20)) partialFailures.push({ repo: m.name, path: f.path, code: f.code });
    // A repo that produced no relations in the mined language is a blind spot:
    // an inventory-only language, an all-failed parse, or a stack mismatch. Its
    // "absence of a step" is NOT evidence the pattern is absent.
    const blind = (m.relationCount || 0) === 0;
    if (blind) blindRepos.push(m.name);
    if (!blind && pf.length === 0) cleanRepos++;
    if (pf.length) {
      const codes = [...new Set(pf.map((f) => f.code).filter(Boolean))].join(", ") || "parse error";
      reasons.push(`${m.name}: ${pf.length} file(s) failed to parse (${codes}) — those files are not in the graph.`);
    }
    if (blind) {
      reasons.push(`${m.name}: produced no resolvable ${minedLangKey} relations (inventory-only language or unparsed) — a blind spot, not a confirmed absence.`);
    }
    for (const w of (m.warnings || []).slice(0, 3)) {
      reasons.push(`${m.name}: graph warning — ${typeof w === "string" ? w : w.code || JSON.stringify(w)}`);
    }
  }

  const complete = partialFailures.length === 0 && blindRepos.length === 0;
  const confidence = complete
    ? "confirmed"
    : blindRepos.length
      ? "low"
      : "partial";

  return {
    complete,
    confidence, // "confirmed" | "partial" | "low"
    reposMined: metas.length,
    reposCleanlyParsed: cleanRepos,
    partialFailureCount: partialFailures.length,
    partialFailures: partialFailures.slice(0, 10),
    blindRepos,
    reasons,
    // The safe fallback / verification path (requirement: always provide one).
    verify: complete
      ? "Every step below is backed by resolved graph edges. Still open a receipt and confirm each API against your installed version before shipping."
      : "This recipe was mined from a PARTIALLY analyzed set of repos (see reasons). Do NOT treat missing steps as 'not needed'. For every heuristic/unverified step, open a receipt and confirm the symbol against the installed package (e.g. check its exported types, or grep the library source) before relying on it.",
  };
}
