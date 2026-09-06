// The UNRESOLVABLE part of the fixture: dynamic dispatch + reflection that static
// analysis cannot follow. A recipe built only from resolved edges would be BLIND
// to whatever wiring happens here — so any "this library isn't used" conclusion
// drawn from the absence of an edge is a guess, not evidence. The engine must
// surface that as a blind spot, not silently omit it.

const registry = {};

export function register(name, factory) {
  registry[name] = factory;
}

// Plugins are loaded by string name at runtime — the graph sees `require(...)`
// but cannot know which module, so no CALLS edge to the real API is resolved.
export function loadPlugin(name) {
  const mod = require(`../plugins/${name}`);
  const build = registry[name] || mod.default;
  return build(); // invoked through a variable: unresolved call target
}

export function dispatch(event, ...args) {
  const handler = registry[event.type];
  return handler ? handler(...args) : null;
}
