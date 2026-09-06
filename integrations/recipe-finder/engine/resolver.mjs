// Optional LLM resolver — turns a vague goal into candidate libraries + better
// search terms, so discovery isn't a blind keyword search.
//
// PROPOSE, don't decide: this only SEEDS discovery and biases resolution. The
// graph stays authoritative — a candidate library is used only if real repos
// actually import it (it has to show up in the mined IMPORTS edges). If the LLM
// guesses wrong, the dominant real import still wins. That keeps every recipe
// step a verifiable file:line receipt, not an LLM assertion.
//
// Fully optional and no-dep: uses the Anthropic Messages API via `fetch` (no
// SDK). Disabled unless ANTHROPIC_API_KEY is set (or RECIPE_RESOLVER=off). On
// any error/timeout it returns null and the pipeline falls back to today's
// graph-only discovery.
//
// Env:
//   ANTHROPIC_API_KEY        enables the resolver
//   RECIPE_RESOLVER=off      force-disable even with a key
//   RECIPE_RESOLVER_MODEL    override model (default: claude-haiku-4-5 — the
//                            cost-right tier for a short "suggest libraries" call)
//   ANTHROPIC_BASE_URL       override API host (proxies/gateways)

const MODEL = process.env.RECIPE_RESOLVER_MODEL || "claude-haiku-4-5";
const BASE = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
const API_URL = `${BASE}/v1/messages`;

export function resolverEnabled() {
  return process.env.RECIPE_RESOLVER !== "off" && !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM =
  "You map a developer's end goal to the real, installable libraries most commonly " +
  "used to build it. A separate code-graph tool then VERIFIES your suggestions against " +
  "real repositories, so your job is to propose good candidates, not to be exhaustive. " +
  "Reply with ONLY a JSON object, no prose, no code fences.";

function buildPrompt(goal) {
  return `Goal: "${goal}"

Return exactly this JSON shape:
{
  "ecosystem": "js | python | java | go | ruby | rust | php | csharp | swift | other",
  "libraries": ["up to 4 real installable package names as PUBLISHED (e.g. \\"numpy\\", \\"@tiptap/react\\", \\"react-dnd\\"), best first"],
  "searchTerms": ["up to 4 GitHub search phrases that find real repos building this"]
}

Rules:
- Use the EXACT published package name (the string you'd pip/npm/cargo install), never a description.
- If the goal already names a library, put it first.
- Prefer the dominant, current library over niche or deprecated ones.
- Only packages you are confident exist. If unsure, return fewer.
Reply with ONLY the JSON object.`;
}

// Parse (and defensively sanitize) the model's JSON reply. Exported so it can be
// unit-tested without a live API call.
export function parseResolverJSON(text) {
  if (!text || typeof text !== "string") return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/); // tolerate stray prose/fences around the JSON
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const clean = (arr) =>
    Array.isArray(arr)
      ? [...new Set(arr.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()))].slice(0, 4)
      : [];
  const libraries = clean(obj.libraries);
  const searchTerms = clean(obj.searchTerms);
  const ecosystem = typeof obj.ecosystem === "string" ? obj.ecosystem.trim().toLowerCase() : "";
  if (!libraries.length && !searchTerms.length) return null;
  return { ecosystem, libraries, searchTerms, model: MODEL };
}

export async function resolveCandidates(goal, { timeoutMs = 20000 } = {}) {
  if (!resolverEnabled() || !goal || !goal.trim()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        temperature: 0.2, // low — we want stable, dominant picks (Haiku 4.5 accepts it)
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(goal) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b && b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseResolverJSON(text);
  } catch {
    return null; // network/timeout/parse — fall back to graph-only discovery
  } finally {
    clearTimeout(timer);
  }
}
