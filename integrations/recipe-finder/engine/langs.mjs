// Per-language config so the recipe engine works across every language
// entire-graph parses semantically (imports + calls), not just JS/TS.
//
// Each config answers four questions the miner needs:
//   root(mod)         → grouping key for an import (or null if stdlib/noise)
//   famPrefix(root)   → prefix used to group a library "family" + co-locate files
//   installName(root) → how the dependency is actually installed (display)
//   install(names)    → the install command line
//   notable(symbol)   → is this called symbol an API worth surfacing
//
// root() intentionally returns the IMPORT prefix (PIL, javafx, @tiptap/react),
// not the installable name — co-location matches raw import strings. installName
// maps that prefix to the package you'd install (PIL → Pillow) for display only.

const EXT_LANG = {
  ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js",
  ".cjs": "js", ".vue": "js", ".svelte": "js",
  ".py": "py",
  ".java": "java",
  ".kt": "kotlin", ".kts": "kotlin",
  ".go": "go",
  ".rb": "ruby",
  ".rs": "rust",
  ".php": "php",
  ".cs": "csharp",
  ".swift": "swift",
  ".rb.erb": "ruby",
  ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp",
  ".scala": "scala", ".ex": "elixir", ".exs": "elixir", ".rb2": "ruby",
};

const first = (mod, sep) => mod.split(sep).filter(Boolean)[0] || mod;
const firstN = (mod, sep, n) => mod.split(sep).filter(Boolean).slice(0, n).join(sep);

// npm noise (frameworks / UI kits / utils that drown out the domain library)
const NPM_DENY = new Set([
  "react", "react-dom", "next", "vue", "svelte", "typescript", "vite", "webpack",
  "eslint", "prettier", "tailwindcss", "@types/node", "@types/react",
  "@types/react-dom", "zod", "clsx", "classnames", "dotenv", "express",
  "@vitejs/plugin-react", "postcss", "autoprefixer", "lucide-react", "react-icons",
  "@heroicons/react", "@radix-ui/react-icons", "uuid", "nanoid", "date-fns",
  "dayjs", "lodash", "lodash-es", "axios", "framer-motion", "@tailwindcss/vite",
  "@chakra-ui/react", "@chakra-ui/icons", "@mui/material", "@mui/icons-material",
  "@emotion/react", "@emotion/styled", "antd", "@mantine/core", "@mantine/hooks",
  "bootstrap", "react-bootstrap", "@radix-ui/react-slot", "styled-components",
  // test runners / build tooling — imported by *.test/*.bench files, never the
  // domain library. Left in, a repo's test runner (e.g. vitest) wins "most
  // common import" and becomes a bogus recipe library.
  "vitest", "@vitest/ui", "@vitest/coverage-v8", "jest", "ts-jest", "babel-jest",
  "mocha", "chai", "jasmine", "ava", "sinon", "supertest", "cypress",
  "playwright", "@playwright/test", "karma", "jsdom", "happy-dom", "enzyme",
  "ts-node", "tsx", "tsup", "esbuild", "rollup", "nodemon", "@swc/core",
  "@testing-library/react", "@testing-library/dom", "@testing-library/jest-dom",
  "@testing-library/user-event",
]);
const JS_SYM_DENY = new Set([
  "useState", "useEffect", "useRef", "useMemo", "useCallback", "useContext",
  "useReducer", "useLayoutEffect", "useImperativeHandle", "useId", "useRouter",
  "useSearchParams", "usePathname", "useTheme", "useForm",
]);
// generic call names that aren't a library's public API, across languages
const GENERIC_SYM = new Set([
  "get", "set", "add", "put", "run", "main", "init", "new", "val", "let", "var",
  "def", "fun", "func", "print", "println", "printf", "log", "append", "len",
  "str", "int", "map", "list", "dict", "push", "pop", "call", "apply", "self",
  "this", "super", "make", "build", "close", "open", "read", "write", "next",
]);

const PY_STDLIB = new Set([
  "os", "sys", "re", "math", "random", "json", "time", "datetime", "collections",
  "itertools", "functools", "typing", "abc", "io", "pathlib", "subprocess",
  "threading", "asyncio", "logging", "argparse", "unittest", "tkinter", "sqlite3",
  "socket", "struct", "hashlib", "base64", "csv", "copy", "enum", "string",
  "traceback", "warnings", "contextlib", "shutil", "glob", "pickle", "queue",
]);
const PY_ALIAS = {
  PIL: "Pillow", cv2: "opencv-python", sklearn: "scikit-learn",
  bs4: "beautifulsoup4", yaml: "PyYAML", np: "numpy", pd: "pandas",
  dotenv: "python-dotenv", jwt: "PyJWT", serial: "pyserial",
};

const generic = (installCmd, extra = {}) => ({
  root: (m) => {
    if (!m || m.startsWith(".")) return null;
    return first(m, /[.\/:\\]/);
  },
  famPrefix: (root) => root,
  installName: (root) => root,
  install: (names) => `${installCmd} ${names.join(" ")}`,
  notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  ...extra,
});

const CONFIGS = {
  js: {
    root: (m) => {
      if (!m || m.startsWith(".") || m.startsWith("node:")) return null;
      const base = m.startsWith("@") ? m.split("/").slice(0, 2).join("/") : m.split("/")[0];
      return NPM_DENY.has(base) ? null : base;
    },
    famPrefix: (root) => (root.startsWith("@") ? root.split("/")[0] : root),
    installName: (root) => root,
    install: (names) => `npm i ${names.join(" ")}`,
    notable: (n) => !!n && n.length >= 3 && !JS_SYM_DENY.has(n) && (/^[A-Z]/.test(n) || /^use[A-Z]/.test(n)),
  },
  py: {
    root: (m) => {
      if (!m || m.startsWith(".")) return null;
      // Split on "." AND "/": Cython cimports surface as "numpy/arrayobject",
      // which must collapse to the installable root "numpy", not a pseudo-package.
      const r = first(m, /[./]/);
      return PY_STDLIB.has(r) ? null : r;
    },
    famPrefix: (root) => root,
    installName: (root) => PY_ALIAS[root] || root,
    install: (names) => `pip install ${names.join(" ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  java: {
    root: (m) => {
      if (!m || /^(java|javax|sun|jdk)\./.test(m)) return null;
      const segs = m.split(".");
      // reverse-domain (com.google.gson) → first 3 segs; else first seg (javafx)
      return /^(com|org|net|io|edu)$/.test(segs[0]) ? firstN(m, ".", 3) : segs[0];
    },
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `// add to pom.xml / build.gradle: ${names.join(", ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  kotlin: {
    root: (m) => {
      if (!m || /^(java|javax|kotlin)\./.test(m)) return null;
      return first(m, ".");
    },
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `// Gradle: implementation("${names.join('"), implementation("')}")`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  go: {
    root: (m) => {
      if (!m) return null;
      const head = m.split("/")[0];
      if (!head.includes(".")) return null; // stdlib: fmt, net/http, encoding/json
      return firstN(m, "/", 3);
    },
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `go get ${names.join(" ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  ruby: {
    root: (m) => {
      if (!m) return null;
      const r = first(m, "/");
      return new Set(["json", "set", "date", "time", "logger", "csv", "uri", "net"]).has(r) ? null : r;
    },
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `gem install ${names.join(" ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  rust: {
    root: (m) => {
      if (!m) return null;
      const r = m.split("::")[0];
      return new Set(["std", "core", "alloc", "crate", "self", "super"]).has(r) ? null : r;
    },
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `cargo add ${names.join(" ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  php: {
    root: (m) => {
      if (!m) return null;
      return first(m.replace(/^\\/, ""), "\\");
    },
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `composer require ${names.join(" ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  csharp: {
    root: (m) => {
      if (!m || /^System(\.|$)/.test(m)) return null;
      return firstN(m, ".", 2);
    },
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `dotnet add package ${names.join(" ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  swift: {
    root: (m) => (!m || m === "Swift" ? null : first(m, ".")),
    famPrefix: (root) => root,
    installName: (root) => root,
    install: (names) => `// Swift Package Manager: ${names.join(", ")}`,
    notable: (n) => !!n && n.length >= 3 && !GENERIC_SYM.has(n.toLowerCase()),
  },
  default: generic("# add dependency:"),
};

export function langConfig(key) {
  return CONFIGS[key] || CONFIGS.default;
}

// Pick the dominant language across a set of file paths (by extension count).
export function detectLang(files) {
  const counts = new Map();
  for (const f of files) {
    if (!f) continue;
    const dot = f.lastIndexOf(".");
    if (dot < 0) continue;
    const lang = EXT_LANG[f.slice(dot).toLowerCase()];
    if (lang) counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  let best = "default";
  let n = 0;
  for (const [lang, c] of counts) if (c > n) { n = c; best = lang; }
  return best;
}
