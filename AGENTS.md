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
                  immutability, perf, and a "Known bugs" suite: one test per
                  defect that was found and fixed.
tests/spec.test.ts Specification of the scanner (every quoting form), of
                  clause placement in any statement, and of AND/OR targets.
examples/         example.ts (tagged-template usage) and basic-query.sql.
package.json      npm manifest: exports -> dist/, bin `literal-sql`, scripts.
jsr.json          JSR manifest: exports -> .ts sources.
tsconfig.json     Type-check config (noEmit, all .ts). tsconfig.build.json
                  emits mod.ts + bin/cli.ts to dist/ with .ts -> .js import
                  rewriting (`rewriteRelativeImportExtensions`).
biome.json        Format + lint config (ts/json only; markdown untouched).
```

## Architecture

`SQLQuery` is the only class. Instances are **immutable** — a chained `.sql`
returns a new `SQLQuery`. Its whole state is three private fields:

- `text` — the statement as SQL text: comments stripped, `${}` values lifted
  to `$N`, appended clauses already spliced into their place. There is no
  parsed model next to it; everything is derived from the text on demand.
- `params` — a plain array (`$N` is `params[N - 1]`).
- `lastCondition` — `join`, `where` or `having`: the condition an appended
  `AND` / `OR` continues.

(`masked` is a cache of `mask(text)`, kept in step by `splice`.)

The public surface is the constructor, `sql`/`.sql`, `toString()`, `.query`,
`.parameters`, plus `parseInitialQuery`/`parseQuery` used by the CLI.
Everything else is a module-level function in `mod.ts`.

Building blocks:

1. **Scanner** (`scan`) — one regex finds the tokens that matter: quoted text
   (`'...'`, `E'...'`, `"..."`, `$tag$...$tag$`), comments (block comments
   nest), `$N`, brackets, and `CASE` / `END`. Everything between is plain.
   `mask(text)` uses it to blank whatever is quoted, commented or nested in
   `( )`, `[ ]` or `CASE ... END`, keeping offsets. A keyword found on the
   mask is top-level by construction; content is sliced from the real text.
   All splitting (clauses, AND/OR, commas) is `splitTopLevel(text, pattern)`.
2. **Clauses** (`findClauses`) — top-level clause keywords with a rank
   (`RANKS`: SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, WINDOW, ORDER BY,
   LIMIT/OFFSET, FETCH, FOR, RETURNING). Set operations, `ON CONFLICT` and
   `WHEN` are *barriers*: only the clauses after the last one are considered.
   This works for any statement (SELECT, DML, `WITH ...`, `EXPLAIN ...`);
   no grammar is involved.
3. **Interpolation** (`_interpolate`) — substitutes each `${value}` with `$N`
   and records the value. A nested `SQLQuery` is inlined as its `text` with
   its `$N` tokens shifted. `undefined` becomes the literal `NULL`; `null`
   becomes a parameter.
4. **Appending** (`parseQuery` -> `place` -> `splice`) — a fragment is cut
   into clauses and each one is put in the text:
   - `WHERE` / `HAVING` that already exists: ANDed on, with parentheses
     around any side that has a top-level OR (`wrapOr`).
   - list clauses (`SELECT`, `GROUP BY`, `ORDER BY`, `WINDOW`, `RETURNING`):
     extended with a comma.
   - single-value clauses (`FROM`, `LIMIT`, `OFFSET`, `FETCH`): replaced.
   - anything else (new clause, another `JOIN` / `FOR`): inserted before the
     first clause with a higher rank, else at the end.
   - `AND` / `OR`: attached, as written, to the end of the `lastCondition`
     clause (default: the last condition in the text). Without any condition
     it starts a `WHERE` in a SELECT.
   - a bare condition is a `WHERE` in a SELECT; in any other statement a
     fragment that does not start with a clause keyword (`SET ...`,
     `ON CONFLICT ...`, `UNION ...`) is attached at the end as written.
   - if the statement repeats a clause or has clauses out of order and the
     new clause would have to go among them, `place` **throws** rather than
     guess.
5. **Formatting** (`toString`) — only text that starts with a SELECT-statement
   clause keyword and has no barrier is formatted; every other statement is
   returned as its `text`. Formatting walks the clauses in text order
   (`formatClause`): keyword on its own line, terms indented 2, one per line;
   `AND` / `OR` on their own line in `WHERE` / `HAVING`; `LIMIT`, `OFFSET`,
   `FETCH`, `FOR` on a single line. It never reorders.
   - **Guard:** the result is compared with the input by `signature`
     (whitespace and keyword case ignored, quoted text exact). If they differ
     in anything but layout, `toString` returns the text as written. So a
     formatter bug can cost layout, never a token.
   - `SELECT` combined with `RETURNING` throws.
   - An empty query renders as `""`; `SELECT *` is added only for a statement
     that starts at `FROM`.

### CLI

`bin/cli.ts` reads a base query from `--file` or `--query`, then walks
`process.argv` in order and appends clauses via `parseQuery`. Output goes to
stdout; parameters (if any) are printed as JSON below the query.

## Conventions

- **Formatting:** 2-space indent, double quotes, semicolons required, line width
  80 — all enforced by Biome (`biome.json`).
- **Exports:** keep the public surface minimal — only `SQLQuery` and `sql`.
  Internal state stays private (`text`, `params`, `lastCondition`); helpers
  are module-level functions that are not exported.
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

- Only SELECT statements are *formatted*. Every statement takes *appends*:
  a clause appended to DML, a CTE query or `EXPLAIN ...` is placed by rank
  (`WHERE` before `RETURNING`, ...). Text that was never appended to is
  returned exactly as written.
- There is no SQL grammar. Clause placement relies on the fixed clause order
  of a statement; when that order is not recognisable `place` throws. New
  syntax that puts a clause keyword at top level in another role needs an
  entry in `CLAUSE_KEYWORDS` / `BARRIER_KEYWORDS`, with a test in
  `tests/spec.test.ts`.
- Not handled: a hand-written `$N` next to `${}` values (numbers collide),
  backslash escapes in plain `'...'` (only with
  `standard_conforming_strings = off`), and re-formatting of subqueries.
- `toString()` runs validation lazily — calling `.parameters` does not throw
  even if the query is invalid. Only `.toString()` / `.query` will throw.
  Statements that are not formatted never throw there.
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
