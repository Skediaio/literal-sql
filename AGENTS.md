# LiteralSQL — Agent Guide

A lightweight, zero-dependency raw SQL query builder for Deno / Node / Bun.
Published to JSR as **`@skedia/literal-sql`**. SQL is written with
tagged-template literals; the builder produces PostgreSQL-style `$1, $2, ...`
placeholders plus a parameters array, and emits consistently formatted
multi-line SQL.

> **Ethos:** write real SQL, not a DSL. The library never executes queries and
> never opens a database connection — it only builds the string and the params.

## Runtime & Toolchain

- **Runtime:** Deno 2.2.x (also consumable from Node and Bun via `jsr:`)
- **Language:** TypeScript 5.7, strict
- **Package registry:** JSR (`deno.json` — also the Deno task/fmt config)
- **No external runtime dependencies** — only `jsr:@std/cli` for the CLI and
  `jsr:@std/assert` for tests

## Commands

```sh
deno task test       # deno test tests/                 — full test suite
deno task check      # deno check **/*.ts               — type-check everything
deno task cli        # deno run --allow-read bin/cli.ts — run the CLI locally

deno check mod.ts                        # type-check the library entry
deno run --allow-read bin/cli.ts --help  # CLI help / smoke test
deno fmt                                 # format (config in jsr.json)
deno lint                                # lint
```

### CI

`.github/workflows/ci.yml` runs `deno fmt --check`, `deno lint`,
`deno task check`, and `deno task test` on every push to `main` and on PRs.
`.github/workflows/publish.yml` runs type-check + tests and then
`npx jsr publish` on every push to `main`. Bumping `deno.json` `version` and
merging to main publishes a new release — be deliberate about version bumps.

## Project Layout

```
mod.ts            Library entry. Exports `SQLQuery` class and `sql` factory.
bin/cli.ts        CLI. Imports SQLQuery, parses argv, prints formatted SQL.
tests/sql.test.ts Unit tests for the builder (formatting, params, DML, throws).
tests/coverage.test.ts Exhaustive matrix: clause/value/nesting/passthrough
                  variants plus per-channel injection-resistance tests.
tests/cli.test.ts End-to-end tests that shell out to `bin/cli.ts`.
examples/         example.ts (tagged-template usage) and basic-query.sql.
deno.json         Deno + JSR package manifest: name, version, exports, fmt
                  config, tasks. (Was `jsr.json`; consolidated because Deno
                  2.2.x reads `deno.json` for tasks — `jsr.json` tasks were
                  dead config.)
```

## Architecture

`SQLQuery` is the only class. Instances are **immutable** — every mutating
operation
(`sql\`...\``chained method) returns a new`SQLQuery`via`structuredClone`of`parts`plus a shallow copy of`params`.

Internal model (`QueryParts` — private, as are `params`, `paramCounter`, and
`raw`; the public surface is the constructor, `sql`/`.sql`, `toString()`,
`.query`, `.parameters`, plus `parseInitialQuery`/`parseQuery` used by the
CLI):

- `select: string[]`, `from: string | null`, `joins: string[]`
- `where: string[]`, `groupBy: string[]`, `having: string[]`,
  `orderBy: string[]`
- `limit`, `offset: string | null`, `returning: string[]`
- `isDML: boolean` — set when the initial query begins with `INSERT` / `UPDATE`
  / `DELETE` (always implies raw passthrough)
- `isRawPassthrough: boolean` + `rawQuery: string | null` — set for DML and
  when the query contains `WITH` / `UNION` / `INTERSECT` / `EXCEPT`;
  `toString` then returns the raw query unchanged (bypasses the SELECT-centric
  formatter to avoid corruption). Fragments appended via `.sql` are attached
  verbatim to `rawQuery` (never silently dropped).

Each instance also keeps `raw` — the comment-stripped interpolated SQL text.
Nesting a query inside another inlines `raw` (never the formatted
`toString()` output) and renumbers its `$N` placeholders in a single pass, so
shifted placeholders cannot collide with not-yet-shifted ones.

Pipeline:

1. **Interpolation** (`_interpolate`) — turns the tagged template into a SQL
   string, substituting each `${value}` with `$N` and recording the value in
   `params`. Nested `SQLQuery` fragments are inlined from their `raw` text
   with single-pass parameter renumbering. `undefined` becomes the literal
   `NULL`; `null` becomes a parameter (Postgres semantics).
2. **Parsing** (`parseInitialQuery` for the constructor, `parseQuery` for
   `.sql(...)` appends) — classifies fragments into `QueryParts` using simple
   case-insensitive keyword detection (`SELECT`, `FROM`, `JOIN`, `WHERE`,
   `HAVING`, ...). Both strip `--` line comments outside string literals.
   Two masking pre-passes make the keyword scanners robust:
   - `maskStringLiterals` — replaces `'...'` literals (with `''` doubling)
     with placeholders so AND/OR/`,`/`--` inside strings isn't mis-scanned.
   - `maskParenGroups` — length-preserving mask that replaces parenthesized
     content with spaces so keywords inside `OVER (...)`, `CASE`, and
     subqueries don't trigger false clause boundaries. Clause content is sliced
     from the original query via match indices (preserving real parens).
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

### CLI

`bin/cli.ts` reads a base query from `--file` or `--query`, then walks
`Deno.args` in order and appends clauses via `parseQuery`. Output goes to
stdout; parameters (if any) are printed as JSON below the query.

## Conventions

- **Formatting:** 2-space indent, double quotes, semicolons required, line width
  80 — all enforced by `deno fmt` via `jsr.json`.
- **Exports:** keep the public surface minimal — only `SQLQuery` and `sql`.
  Internal helpers and state stay private (`_interpolate`, `splitConditions`,
  `formatJoinClause`, `parts`, `params`, `paramCounter`, `raw`).
  `parseInitialQuery` / `parseQuery` remain public because the CLI drives
  them directly.
- **Immutability:** never mutate `this` in chainable methods; always return a
  fresh `SQLQuery`.
- **Parameters:** PostgreSQL `$1, $2, ...` numbering. The `parameters` getter
  fills gaps with `undefined` and trims only trailing undefined values.
- **Tests:** expected SQL strings are written as arrays joined by `"\n"` for
  readability — match that style when adding tests. CLI tests shell out with
  `Deno.Command`, so they exercise the real binary path.
- **No query execution:** this library will never import a database driver.

## Gotchas

- `parseInitialQuery` and `toString` are SELECT-centric. DML statements
  (`INSERT` / `UPDATE` / `DELETE`) are therefore raw passthrough: the
  statement text is preserved verbatim (trimmed, comments stripped, `${}`
  lifted to `$N`) and never reformatted. Appended `.sql` fragments attach
  verbatim below the statement. The DML tests in `tests/sql.test.ts` pin this.
- The parser uses regex / keyword-prefix matching with two masking pre-passes
  (`maskStringLiterals` and `maskParenGroups`) that make scanners
  string-literal-aware and parenthesis-depth-aware. As of 0.2.0, string
  literals containing AND/OR/`,`/`--` are handled correctly, window functions
  with `OVER (...)` are preserved, and `WITH`/`UNION`/`INTERSECT`/`EXCEPT`
  queries pass through raw (avoiding silent corruption). Still NOT first-class:
  dollar-quoting `$$...$$`, `E'...'` escapes, double-quoted identifiers,
  `LATERAL`, and recursive re-formatting of subqueries.
- `toString()` runs validation lazily — calling `.parameters` does not throw
  even if the query is invalid. Only `.toString()` / `.query` will throw.
  Passthrough queries (`WITH`/`UNION`/...) bypass the throw guard by design.
- The CLI walks `Deno.args` manually (not `parseArgs` output) so that clause
  ordering on the command line is preserved in the output.
- `tests/cli.test.ts` end-to-end tests shell out to `bin/cli.ts` via
  `Deno.Command`, so the test runner needs `--allow-run` at the invocation
  level (`deno task test` grants it; per-test `permissions: { run: true }`
  cannot escalate if the runner was invoked without it). The expected arrays
  were updated in 0.1.0 to match the multi-line `toString()` output — if you
  re-break the formatter output, re-update those expectations.

## When to use which agent (oh-my-opencode-slim)

This project uses the oh-my-opencode-slim specialist roster. Route work
deliberately:

- **`@explorer`** — fast read-only recon. Use first when a task touches code you
  haven't read yet (e.g. "where does `parseQuery` handle `OR`?").
- **`@librarian`** — Deno / JSR / `@std/*` docs and behaviour questions, plus
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
  `deno lint`, `deno task check` before opinions. Use before merging non-trivial
  changes to `mod.ts`.

### Routing rule of thumb

- Touches `mod.ts` parser / formatter / validation → **@oracle** designs,
  **@fixer** implements.
- Adds a test that mirrors existing patterns → **@fixer** directly.
- "How does Deno / JSR / `@std/cli` handle X?" → **@librarian**.
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

1. `deno task check` passes (type-checks every `.ts` file).
2. `deno task test` passes (sql.test.ts + cli.test.ts).
3. `deno lint` clean.
4. `deno fmt --check` clean (enforced by `.github/workflows/ci.yml`).
5. If `mod.ts` public surface changed, bump `deno.json` `version` and document
   the change in the commit message — pushes to `main` publish automatically.
