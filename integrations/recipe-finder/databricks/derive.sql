-- derive.sql — turn raw entire-graph edges (workspace.recipe.code_edges) into a
-- recipe, entirely in Spark SQL on the warehouse. This is the aggregation that
-- used to run in the Node process (engine/generate.mjs); moving it here is what
-- lets a goal be mined from 10+ repos. lib/corpus.ts::deriveRecipe() runs the
-- same three statements with :goal / :library / :famPrefix bound as parameters
-- and assembles the final Recipe JSON.
--
-- Keep the deny-lists below in sync with PKG_DENY / SYM_DENY in
-- engine/generate.mjs — they are duplicated on purpose so this file runs
-- standalone in a SQL editor / Genie.
--
-- Bind :goal to a recipe slug, e.g. 'realtime-collaborative-editor'.

-- ===========================================================================
-- 1. Totals + sources for the goal (repos mined, and the repo URLs).
-- ===========================================================================
SELECT
  count(DISTINCT repo)                              AS repos_mined,
  to_json(array_distinct(collect_list(repo_url)))  AS sources
FROM workspace.recipe.code_edges
WHERE goal = :goal;

-- ===========================================================================
-- 2. Install packages: external packages ranked by how many repos import them,
--    with one file:line receipt each. The top row (unless the caller pins a
--    package) resolves the library; :library / :famPrefix in query 3 come from
--    it. Drop framework/UI/util noise via the deny-list.
-- ===========================================================================
SELECT
  base_pkg,
  count(DISTINCT repo) AS repos,
  to_json(min_by(
    named_struct(
      'label', concat(repo, '/', file, if(line IS NULL, '', concat(':', cast(line AS string)))),
      'url',   concat(repo_url, '/blob/HEAD/', file, if(line IS NULL, '', concat('#L', cast(line AS string))))
    ),
    concat(repo, '/', file)
  )) AS receipt
FROM workspace.recipe.code_edges
WHERE goal = :goal
  AND relation = 'IMPORTS'
  AND base_pkg IS NOT NULL
  AND base_pkg NOT IN (
    'react','react-dom','next','vue','svelte','typescript','vite','webpack',
    'eslint','prettier','tailwindcss','@types/node','@types/react',
    '@types/react-dom','zod','clsx','classnames','dotenv','express',
    '@vitejs/plugin-react','postcss','autoprefixer',
    'lucide-react','react-icons','@heroicons/react','@radix-ui/react-icons',
    'uuid','nanoid','date-fns','dayjs','lodash','lodash-es','axios',
    'framer-motion','@tailwindcss/vite',
    '@chakra-ui/react','@chakra-ui/icons','@mui/material','@mui/icons-material',
    '@emotion/react','@emotion/styled','antd','@mantine/core','@mantine/hooks',
    'bootstrap','react-bootstrap','@radix-ui/react-slot','styled-components'
  )
GROUP BY base_pkg
ORDER BY repos DESC, base_pkg;

-- ===========================================================================
-- 3. API steps: called/constructed symbols that appear in files which import
--    the resolved library family (the co-location filter), ranked by repo
--    frequency. Keeps PascalCase / useXxx identifiers, drops the React hook
--    noise, carries up to 4 receipts + one example source line each.
--    :library is the resolved package; :famPrefix is its scope ('@tiptap') or
--    the package name itself for unscoped libraries.
-- ===========================================================================
WITH lib_files AS (
  SELECT DISTINCT repo, file
  FROM workspace.recipe.code_edges
  WHERE goal = :goal
    AND relation = 'IMPORTS'
    AND (module = :library OR module LIKE concat(:famPrefix, '%'))
),
sym AS (
  SELECT c.symbol, c.repo, c.file, c.line, c.repo_url, c.snippet
  FROM workspace.recipe.code_edges c
  JOIN lib_files lf ON c.repo = lf.repo AND c.file = lf.file
  WHERE c.goal = :goal
    AND c.relation IN ('CALLS', 'CONSTRUCTS')
    AND c.symbol IS NOT NULL
    AND c.line IS NOT NULL
    AND length(c.symbol) >= 3
    AND c.symbol NOT IN (
      'useState','useEffect','useRef','useMemo','useCallback','useContext',
      'useReducer','useLayoutEffect','useImperativeHandle','useId','useRouter',
      'useSearchParams','usePathname','useTheme','useForm'
    )
    AND (c.symbol RLIKE '^[A-Z]' OR c.symbol RLIKE '^use[A-Z]')
)
SELECT
  symbol,
  count(DISTINCT repo) AS repos,
  to_json(slice(array_distinct(collect_list(
    named_struct(
      'label', concat(repo, '/', file, ':', cast(line AS string)),
      'url',   concat(repo_url, '/blob/HEAD/', file, '#L', cast(line AS string))
    )
  )), 1, 4)) AS receipts,
  min_by(snippet, concat(repo, '/', file, ':', cast(line AS string))) AS snippet
FROM sym
GROUP BY symbol
ORDER BY repos DESC, symbol
LIMIT 5;
