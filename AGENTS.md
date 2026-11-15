# LiteralSQL — Agent Guide

A lightweight, zero-dependency raw SQL query builder for Node / Bun (and Deno
via JSR). Published to npm and JSR as **`@skedia/literal-sql`**. SQL is written with
tagged-template literals; the builder produces PostgreSQL-style `$1, $2, ...`
placeholders plus a parameters array, and emits consistently formatted
multi-line SQL.

> **Ethos:** write real SQL, not a DSL. The library never executes queries and
> never opens a database connection — it only builds the string and the params.

## Runtime & Toolchain

- **Runtime:** Node.js >= 22.18 (native TypeScript type stripping — `.ts`
  files run directly, no tsx/ts-node). Moved off Deno in 0.2.1.
- **Language:** TypeScript, strict, erasable syntax only (`erasableSyntaxOnly`:
  no `enum`, `namespace`, or constructor parameter properties — Node can't
  strip those)
- **Package registries:** npm (`package.json`, ships compiled `dist/`) and JSR
  (`jsr.json`, ships the `.ts` sources). Keep both `version` fields equal — CI
  checks it.
- **No runtime dependencies.** Dev only: `typescript`, `@types/node`,
  `@biomejs/biome`. Tests use built-in `node:test` + `node:assert/strict`; the
  CLI uses `node:util` `parseArgs`.

## Commands

```sh
npm test             # node --test "tests/*.test.ts"   — full test suite
npm run check        # tsc --noEmit                    — type-check everything
npm run build        # tsc -p tsconfig.build.json      — emit dist/ (npm only)
npm run cli -- ...   # node bin/cli.ts                 — run the CLI locally
npm run ci           # biome ci + check + test         — what CI runs

npx biome check --write .   # format + lint + organize imports (ts/json only)
```

### CI

`.github/workflows/ci.yml` runs `biome ci`, type-check, tests and build on
Node 22 (minimum) and 26 (current LTS) for every push to `main` and on PRs, and checks that
`package.json` and `jsr.json` versions match. `.github/workflows/publish.yml`
runs type-check + tests on every push to `main`, then `npm publish
--provenance` (skipped when that version is already on npm) and
`npx jsr publish`. Bumping the version and merging to main publishes a new
release — be deliberate about version bumps.

## Project Layout

```
mod.ts            Library entry. Exports `SQLQuery` class and `sql` factory.
bin/cli.ts        CLI. Imports SQLQuery, parses argv, prints formatted SQL.
tests/sql.test.ts Unit tests for the builder (formatting, params, DML, throws).
tests/coverage.test.ts Exhaustive matrix: clause/value/nesting/passthrough
                  variants plus per-channel injection-resistance tests.
tests/cli.test.ts End-to-end tests that shell out to `bin/cli.ts`.
tests/robustness.test.ts Token-preservation corpus, fuzzing, injection,
                  immutability, perf, and a "Known bugs" suite that fails
                  until each pinned defect is fixed.
examples/         example.ts (tagged-template usage) and basic-query.sql.
package.json      npm manifest: exports -> dist/, bin `literal-sql`, scripts.
jsr.json          JSR manifest: exports -> .ts sources.
tsconfig.json     Type-check config (noEmit, all .ts). tsconfig.build.json
                  emits mod.ts + bin/cli.ts to dist/ with .ts -> .js import
                  rewriting (`rewriteRelativeImportExtensions`).
biome.json        Format + lint config (ts/json only; markdown untouched).
```

## Architecture

`SQLQuery` is the only class. Instances are **immutable** — every mutating
operation (a chained `.sql`) returns a new `SQLQuery` holding a one-level copy
of `parts` (strings and string arrays only) and its own `params` array.

Internal model (`QueryParts` — private, as are `params` and `raw`; the public
surface is the constructor, `sql`/`.sql`, `toString()`, `.query`,
`.parameters`, plus `parseInitialQuery`/`parseQuery` used by the CLI):

- `select: string[]`, `from: string | null`, `joins: string[]`
- `where: string[]`, `groupBy: string[]`, `having: string[]`,
  `orderBy: string[]`
- `limit`, `offset: string | null`, `returning: string[]`
- `isRawPassthrough: boolean` — set unless the initial text starts with a
  SELECT-statement clause keyword (`SELECT` / `FROM` / `JOIN` / `WHERE` /
  `GROUP BY` / `HAVING` / `ORDER BY` / `LIMIT` / `OFFSET`), and also when it
  contains `UNION` / `INTERSECT` / `EXCEPT`. So DML, DDL, `WITH`, `VALUES`,
  `EXPLAIN`, `(`... and bare fragments like `a = $1` all pass through:
  `toString` returns `raw` unchanged. Fragments appended via `.sql` are
  attached verbatim to `raw` (never silently dropped).

`params` is a plain array (`$N` is `params[N - 1]`). `raw` is the
comment-stripped interpolated SQL text. Nesting a query inside another
inlines `raw`, or `toString()` once clauses were appended to a parsed query
(appends may arrive out of statement order, so `raw` is cleared then), and
renumbers its `$N` placeholders in a single pass, so shifted placeholders
cannot collide with not-yet-shifted ones.

Pipeline:

1. **Interpolation** (`_interpolate`) — turns the tagged template into a SQL
   string, substituting each `${value}` with `$N` and recording the value in
   `params`. Nested `SQLQuery` fragments are inlined with single-pass
   parameter renumbering. `undefined` becomes the literal `NULL`; `null`
   becomes a parameter (Postgres semantics).
2. **Parsing** (`parseInitialQuery` for the constructor, `parseQuery` for
   `.sql(...)` appends) — both strip `--` and `/* */` comments plus a
   trailing `;` (`stripComments`, one scan that also matches quoted text, so
   markers inside quotes and quotes inside comments are not misread), cut the
   text into top-level clauses (`splitClauses`) and hand each one to
   `addClause`, which files it under the matching `QueryParts` entry. A
   fragment may therefore hold several clauses (`WHERE a ORDER BY b`).
   When the builder itself joins conditions with AND (a second
   `WHERE`/`HAVING`, or a bare condition), `appendAnd` parenthesises any side
   with a top-level OR. Explicit `.sql\`AND ...\`` / `.sql\`OR ...\``
   fragments are kept as written and always go to `WHERE`.
   Two masks make the keyword scanners robust:
   - `maskStringLiterals` — replaces `'...'` literals and `"..."` identifiers
     with placeholders so AND/OR/`,`/`$N` inside quotes isn't mis-scanned.
   All splitting (clauses, AND/OR, commas) goes through one helper,
   `splitTopLevel(text, pattern)`: find matches on the mask, slice the original.
   - `maskParenGroups` — length-preserving mask that blanks parenthesized
     and quoted content so keywords inside `OVER (...)`, `CASE`, and
     subqueries don't trigger false clause boundaries. Clause content is
     sliced from the original text via match indices (preserving real parens).
3. **Formatting** (`toString`) — raw-passthrough queries (DML, WITH/UNION/...)
   are returned verbatim. Everything else is emitted as multi-line SQL with
   2-space indentation:
   - `SELECT` / `FROM` / `JOIN` / `WHERE` / `GROUP BY` / `HAVING` /
     `ORDER BY` each on their own line; their terms indented underneath, one
     per line. Term lists split on top-level commas only (function arguments
     stay intact).
   - `AND` / `OR` on their own line within `WHERE` / `HAVING` and within
     `JOIN ... ON` (shared helper: `formatConditionClause`).
   - `LIMIT` / `OFFSET` stay on a single line.
   - Validates invariants and throws:
     - `SELECT` combined with `RETURNING` → throws (DML never reaches this
       guard — it passes through raw).
   - An empty query renders as `""`; `SELECT *` is only added for a query
     that has a `FROM` but no select list.

### CLI

`bin/cli.ts` reads a base query from `--file` or `--query`, then walks
`process.argv` in order and appends clauses via `parseQuery`. Output goes to
stdout; parameters (if any) are printed as JSON below the query.

## Conventions

- **Formatting:** 2-space indent, double quotes, semicolons required, line width
  80 — all enforced by Biome (`biome.json`).
- **Exports:** keep the public surface minimal — only `SQLQuery` and `sql`.
  Internal helpers and state stay private (`_interpolate`, `splitConditions`,
  `formatJoinClause`, `parts`, `params`, `raw`).
  `parseInitialQuery` / `parseQuery` remain public because the CLI drives
  them directly.
- **Immutability:** never mutate `this` in chainable methods; always return a
  fresh `SQLQuery`.
- **Parameters:** PostgreSQL `$1, $2, ...` numbering. The `parameters` getter
  returns a copy of the internal array.
- **Tests:** expected SQL strings are written as arrays joined by `"\n"` for
  readability — match that style when adding tests. CLI tests shell out with
  `spawnSync(process.execPath, ["bin/cli.ts", ...])`, so they exercise the
  real binary path.
- **No query execution:** this library will never import a database driver.

## Gotchas

- `parseInitialQuery` and `toString` are SELECT-centric. Everything that
  is not a plain SELECT (DML, DDL, `EXPLAIN`, ...) is therefore raw passthrough: the
  statement text is preserved verbatim (trimmed, comments stripped, `${}`
  lifted to `$N`) and never reformatted. Appended `.sql` fragments attach
  verbatim below the statement. The DML tests in `tests/sql.test.ts` pin this.
- The parser uses regex / keyword-prefix matching with two masking pre-passes
  (`maskStringLiterals` and `maskParenGroups`) that make scanners
  string-literal-aware and parenthesis-depth-aware. As of 0.2.0, string
  literals containing AND/OR/`,`/`--` are handled correctly, window functions
  with `OVER (...)` are preserved, and `WITH`/`UNION`/`INTERSECT`/`EXCEPT`
  queries pass through raw (avoiding silent corruption). Double-quoted
  identifiers are opaque as of 0.3.0. Still NOT first-class: dollar-quoting
  `$$...$$`, `E'...'` escapes, nested block comments, `LATERAL`, trailing
  `FOR UPDATE` / `WINDOW` / `FETCH` (they stay inside the preceding clause),
  and recursive re-formatting of subqueries.
- `toString()` runs validation lazily — calling `.parameters` does not throw
  even if the query is invalid. Only `.toString()` / `.query` will throw.
  Passthrough queries (`WITH`/`UNION`/...) bypass the throw guard by design.
- The CLI walks `argv` manually (not `parseArgs` output) so that clause
  ordering on the command line is preserved in the output.
- `tests/cli.test.ts` end-to-end tests spawn `node bin/cli.ts`. The expected
  arrays match the multi-line `toString()` output — if you re-break the
  formatter output, re-update those expectations.
- `bin/cli.ts` runs `main()` only when `realpath(argv[1])` is the module file
  (works through the npm bin symlink; Node 22 has no `import.meta.main`).
- npm can't load `.ts` from `node_modules`, hence the `dist/` build for npm.

## When to use which agent (oh-my-opencode-slim)

This project uses the oh-my-opencode-slim specialist roster. Route work
deliberately:

- **`@explorer`** — fast read-only recon. Use first when a task touches code you
  haven't read yet (e.g. "where does `parseQuery` handle `OR`?").
- **`@librarian`** — Node / npm / JSR docs and behaviour questions, plus
  any web research. The library touches Postgres semantics and JSR publishing —
  both areas where current docs matter.
- **`@oracle`** — architecture and high-stakes reasoning for `SQLQuery`: parser
  correctness, immutability invariants, parameter renumbering, validation
  ordering, refactors of `toString` / `parseInitialQuery`.
- **`@designer`** — not applicable to the library itself (no UI). Could be used
  if a future docs site or example playground is added.
- **`@fixer`** — bounded mechanical edits: new test cases that follow the
  existing array-join pattern, keyword additions to `parseQuery`, CLI flag
  additions. Hand oracle the design first when validation or parsing semantics
  are involved.
- **`@reviewer`** (custom, via `/review*` commands) — runs `knip`, `jscpd`,
  `biome ci`, `npm run check` before opinions. Use before merging non-trivial
  changes to `mod.ts`.

### Routing rule of thumb

- Touches `mod.ts` parser / formatter / validation → **@oracle** designs,
  **@fixer** implements.
- Adds a test that mirrors existing patterns → **@fixer** directly.
- "How does Node / npm / JSR handle X?" → **@librarian**.
- "Where is X referenced across the repo?" → **@explorer**.

## Skills available in this workspace

Loaded from `~/.config/opencode/skills/`:

- `review-code`, `review-dead-code`, `review-feature`, `review-fix`,
  `review-i18n` — review workflows (the `review-i18n` skill is not relevant
  here; this project has no UI / messages layer).
- `web-research` — SearXNG / Exa / Crawl4AI / Google search and crawl.
- `forgejo-cli` — only relevant if the project mirrors to Codeberg/Forgejo.
- `clonedeps`, `codemap`, `deepwork`, `reflect`, `simplify`, `worktrees`,
  `customize-opencode`, `oh-my-opencode-slim` — general OpenCode workflows.

Browser automation (chrome-devtools MCP) is enabled but not used by the library;
it would only matter for a future docs site.

## Quality bar before merging

1. `npm run ci` passes (Biome, type-check, tests).
2. `npm run build` succeeds.
3. If the public surface changed or you want a release, bump `version` in
   both `package.json` and `jsr.json` and document the change in the commit
   message — pushes to `main` publish automatically.
