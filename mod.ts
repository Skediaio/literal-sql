/**
 * A lightweight, raw SQL query builder that prioritizes SQL development through template literals,
 * rather than abstracting SQL behind programming language constructs like traditional query builders.
 *
 * This module provides tools for building SQL queries safely and incrementally.
 * It handles parameter interpolation automatically (using $1, $2 style placeholders)
 * and helps prevent SQL injection vulnerabilities. SELECT queries are emitted
 * as consistently formatted, multi-line SQL for readability; DML statements
 * (INSERT/UPDATE/DELETE) and WITH/UNION/INTERSECT/EXCEPT queries pass through
 * verbatim so the formatter can never corrupt them.
 *
 * @module
 *
 * @example
 * ```ts
 * import { sql } from "@skedia/literal-sql";
 *
 * // Basic query with parameters
 * const userId = 123;
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`;
 * // query.query might look like:
 * // SELECT
 * //   *
 * // FROM
 * //   users
 * // WHERE
 * //   id = $1
 * console.log(query.query);
 * console.log(query.parameters); // Output: [ 123 ]
 *
 * // Incremental building with conditional clauses
 * let baseQuery = sql`SELECT p.name, p.price, c.name as category_name FROM products p`;
 * baseQuery = baseQuery.sql`JOIN categories c ON p.category_id = c.id`;
 *
 * const filterCategory = "Electronics";
 * if (filterCategory) {
 * // Using sql tag within .sql() for parameter handling
 * baseQuery = baseQuery.sql`WHERE ${sql`c.name = ${filterCategory}`}`;
 * // Or directly: baseQuery = baseQuery.sql`WHERE c.name = ${filterCategory}`;
 * }
 *
 * const minPrice = 50;
 * if (minPrice) {
 * baseQuery = baseQuery.sql`AND ${sql`p.price >= ${minPrice}`}`;
 * // Or directly: baseQuery = baseQuery.sql`AND p.price >= ${minPrice}`;
 * }
 *
 * baseQuery = baseQuery.sql`ORDER BY p.price DESC`;
 * baseQuery = baseQuery.sql`LIMIT ${10}`;
 *
 * console.log(baseQuery.query);
 * console.log(baseQuery.parameters); // Output: [ 'Electronics', 50, 10 ]
 * ```
 *
 * @example
 * ```ts
 * // Handling potential errors (e.g., invalid combinations)
 * import { sql } from "@skedia/literal-sql";
 * import { throws } from "node:assert/strict";
 *
 * throws(
 * () => sql`SELECT * FROM users RETURNING id`.toString(),
 * /RETURNING clause cannot be used with SELECT statements/,
 * );
 * ```
 */
/**
 * Interface defining the structure for storing parsed SQL query parts.
 * @private
 */
interface QueryParts {
  /** SELECT fields or expressions */
  select: string[];
  /** FROM table name and aliases */
  from: string | null;
  /** JOIN clauses (each entry is a full join string like "LEFT JOIN table ON ...") */
  joins: string[];
  /** WHERE condition strings (raw content after WHERE, possibly including leading AND/OR for appended parts) */
  where: string[];
  /** GROUP BY expressions */
  groupBy: string[];
  /** HAVING condition strings */
  having: string[];
  /** ORDER BY expressions */
  orderBy: string[];
  /** LIMIT value */
  limit: string | null;
  /** OFFSET value */
  offset: string | null;
  /** RETURNING clause content */
  returning: string[];
  /** True when the text is not a plain SELECT / clause fragment; it is then kept verbatim. */
  isRawPassthrough: boolean;
}
/**
 * Matches any JOIN keyword as a unit: bare JOIN, or prefixed with
 * LEFT/RIGHT/FULL [OUTER], INNER or CROSS, optionally preceded by NATURAL.
 */
const JOIN_ALTERNATION =
  "(?:NATURAL\\s+)?(?:LEFT\\s+(?:OUTER\\s+)?|RIGHT\\s+(?:OUTER\\s+)?|INNER\\s+|FULL\\s+(?:OUTER\\s+)?|CROSS\\s+)?JOIN\\b";
const JOIN_START = new RegExp(`^${JOIN_ALTERNATION}`, "i");
/** A JOIN clause: join type, table, and the optional ON conditions. */
const JOIN_CLAUSE = new RegExp(
  `^(${JOIN_ALTERNATION})\\s+([\\s\\S]+?)(?:\\s+ON\\s+([\\s\\S]+))?$`,
  "i",
);
/**
 * Quoted text: '...' literals and "..." identifiers (doubled quote escapes);
 * an unterminated quote runs to the end of the text.
 */
const QUOTED = `'[^']*(?:''[^']*)*'?|"[^"]*(?:""[^"]*)*"?`;
const QUOTED_PATTERN = new RegExp(QUOTED, "g");
/** Quoted text, block comments and line comments, whichever starts first. */
const QUOTED_OR_COMMENT = new RegExp(
  `${QUOTED}|[ \\t]*(?:/\\*[\\s\\S]*?\\*/|--[^\\n]*)`,
  "g",
);
/**
 * Keywords that start a clause the formatter understands. The FROM of
 * `IS [NOT] DISTINCT FROM` is an operator, not a clause.
 */
const CLAUSE_KEYWORDS = `SELECT\\b|(?<!\\bDISTINCT\\s+)FROM\\b|${JOIN_ALTERNATION}|WHERE\\b|GROUP\\s+BY\\b|HAVING\\b|ORDER\\s+BY\\b|LIMIT\\b|OFFSET\\b`;
/** Only text that starts with one of these is parsed and formatted. */
const FORMATTABLE_START = new RegExp(`^(?:${CLAUSE_KEYWORDS})`, "i");
const CLAUSE_START = new RegExp(`\\b(?:${CLAUSE_KEYWORDS}|RETURNING\\b)`, "gi");
/**
 * Represents an SQL query with support for parameterization and incremental building.
 * Provides methods to parse, append, format, and retrieve the query string and parameters.
 */
export class SQLQuery {
  /** The different parts of the SQL query, parsed into categories. */
  private parts: QueryParts;
  /** The parameter values; `$N` refers to `params[N - 1]`. */
  private params: unknown[];
  /**
   * The verbatim SQL text (comments stripped, `${}` values already lifted to
   * `$N` placeholders). It is what a raw-passthrough query renders as, and
   * what nesting inlines; empty once clauses were appended to a parsed query.
   */
  private raw: string;
  /**
   * Creates a new SQLQuery instance.
   * If called with template literals, it interpolates values and parses the initial query string.
   *
   * @param strings - Template strings array if created with template literal.
   * @param values - Values to be interpolated into the query.
   */
  constructor(strings?: TemplateStringsArray, ...values: unknown[]) {
    this.parts = {
      select: [],
      from: null,
      joins: [],
      where: [],
      groupBy: [],
      having: [],
      orderBy: [],
      limit: null,
      offset: null,
      returning: [],
      isRawPassthrough: false,
    };
    this.params = [];
    this.raw = "";
    if (strings && strings.raw.length > 0) {
      const { text, params } = this._interpolate(strings, values, []);
      this.params = params;
      this.parseInitialQuery(text);
    }
  }
  /**
   * Interpolates values into the template strings as `$N` placeholders.
   * A nested SQLQuery is inlined as its own SQL text with its placeholders
   * shifted past the parameters collected so far (single pass, so a shifted
   * placeholder can never collide with a not-yet-shifted one).
   * `undefined` becomes the SQL literal `NULL`.
   *
   * @param strings - Template strings array.
   * @param values - Values to be interpolated.
   * @param startParams - Parameters already collected (not mutated).
   * @returns The interpolated SQL text and the extended parameter list.
   * @private
   */
  private _interpolate(
    strings: TemplateStringsArray,
    values: unknown[],
    startParams: unknown[],
  ): { text: string; params: unknown[] } {
    let params = startParams;
    const text = strings.reduce((result, string, i) => {
      if (i >= values.length) return result + string;
      const value = values[i];
      if (value instanceof SQLQuery) {
        const nested = value.raw || value.toString();
        const shift = params.length;
        params = params.concat(value.params);
        // Nothing to renumber; keeps building long lists by nesting cheap.
        if (shift === 0) return result + string + nested;
        // Mask quoted text so text like 'costs $1' is not renumbered.
        const { masked, unmask } = this.maskStringLiterals(nested);
        return (
          result +
          string +
          unmask(
            masked.replace(/\$(\d+)\b/g, (_m, n) => `$${Number(n) + shift}`),
          )
        );
      }
      if (value === undefined) return `${result}${string}NULL`;
      // null, primitives and objects all become a numbered parameter.
      params = [...params, value];
      return `${result}${string}$${params.length}`;
    }, "");
    return { text, params };
  }
  /**
   * Parses a query fragment (typically added via `.sql()`) and appends each
   * clause in it to the matching query part. Fragments appended to
   * raw-passthrough queries are attached verbatim instead of parsed.
   *
   * @param query - The query fragment string to parse and append.
   */
  parseQuery(query: string): void {
    // Strip comments so a trailing "-- note" in a fragment can't comment
    // out whatever toString() joins after it.
    const fragment = this.stripComments(query);
    if (!fragment) return;
    if (this.parts.isRawPassthrough) {
      this.raw = this.raw ? `${this.raw}\n${fragment}` : fragment;
      return;
    }
    // Appended clauses may arrive out of statement order, so the verbatim
    // text is no longer the query; nesting falls back to toString().
    this.raw = "";
    for (const piece of this.splitClauses(fragment)) this.addClause(piece);
  }
  /**
   * Adds one clause ("WHERE a = 1", "LEFT JOIN b ON ...", "AND c") or a bare
   * condition to the matching query part.
   * @private
   */
  private addClause(piece: string): void {
    if (JOIN_START.test(piece)) {
      this.parts.joins.push(piece);
      return;
    }
    // Keywords may be followed by any whitespace (newline, tab).
    const keyword = piece.match(
      /^(select|from|where|and|or|group\s+by|having|order\s+by|limit|offset|returning)\b/i,
    );
    const kw = keyword ? keyword[1].toLowerCase().replace(/\s+/g, " ") : null;
    const content = keyword ? piece.substring(keyword[0].length).trim() : piece;
    if (!content) return;
    switch (kw) {
      case "select":
        this.parts.select.push(...this.splitTopLevelCommas(content));
        break;
      case "from":
        this.parts.from = content;
        break;
      case "and":
      case "or":
        this.parts.where.push(piece);
        break;
      case "group by":
        this.parts.groupBy.push(content);
        break;
      case "having":
        this.appendAnd(this.parts.having, content);
        break;
      case "order by":
        this.parts.orderBy.push(content);
        break;
      case "limit":
        this.parts.limit = content;
        break;
      case "offset":
        this.parts.offset = content;
        break;
      case "returning":
        this.parts.returning.push(content);
        break;
      default:
        // "WHERE ..." or a bare condition: AND it onto the existing WHERE.
        this.appendAnd(this.parts.where, content);
    }
  }
  /**
   * Appends a condition the builder itself joins with AND. Either side that
   * contains a top-level OR is parenthesised, so the OR cannot escape the
   * filter on the other side (`a OR b` + `c` -> `(a OR b) AND c`).
   * @private
   */
  private appendAnd(list: string[], condition: string): void {
    if (list.length === 0) {
      list.push(condition);
      return;
    }
    const hasTopLevelOr = (s: string) =>
      this.splitConditions(s).some((p) => /^OR\b/i.test(p));
    const existing = list.join(" ");
    if (hasTopLevelOr(existing)) list.splice(0, list.length, `(${existing})`);
    list.push(`AND ${hasTopLevelOr(condition) ? `(${condition})` : condition}`);
  }
  /**
   * Strips `--` and `/* *\/` comments (with the whitespace before them) and
   * a trailing statement `;`, then trims. Quoted text is matched by the same
   * scan, so comment markers inside it — and quotes inside comments — are
   * never misread.
   * @private
   */
  private stripComments(query: string): string {
    return query
      .replace(QUOTED_OR_COMMENT, (m) =>
        /^['"]/.test(m) ? m : m.trimStart().startsWith("/*") ? " " : "",
      )
      .replace(/;\s*$/, "")
      .trim();
  }
  /**
   * Parses the initial SQL text given to the constructor or `sql` tag.
   * Only text that starts with a SELECT-statement clause keyword is parsed
   * and formatted. Everything else — DML, DDL, WITH, VALUES, EXPLAIN, set
   * operations, bare fragments like `a = $1` — is kept verbatim, so the
   * SELECT-centric formatter can never corrupt it.
   *
   * @param query - The initial SQL query string.
   */
  parseInitialQuery(query: string): void {
    const text = this.stripComments(query);
    if (
      text &&
      (!FORMATTABLE_START.test(text) ||
        /\b(?:UNION|INTERSECT|EXCEPT)\b/i.test(
          text.replace(QUOTED_PATTERN, ""),
        ))
    ) {
      this.parts.isRawPassthrough = true;
    }
    this.raw = text;
    if (this.parts.isRawPassthrough) return;
    for (const piece of this.splitClauses(text)) this.addClause(piece);
  }
  /**
   * Cuts `text` in front of every top-level match of `pattern` and returns
   * the trimmed, non-empty pieces. Matches are located on `mask` (same
   * length as `text`), so those inside parentheses or quotes don't count.
   * @private
   */
  private splitTopLevel(
    text: string,
    pattern: RegExp,
    mask = this.maskParenGroups(text),
  ): string[] {
    const starts = [0];
    for (const m of mask.matchAll(pattern)) starts.push(m.index);
    return starts
      .map((start, i) => text.slice(start, starts[i + 1]).trim())
      .filter((piece) => piece);
  }
  /**
   * Splits SQL text into its top-level clauses ("SELECT a", "FROM t", ...).
   * Text before the first keyword (a bare condition) is its own piece.
   * @private
   */
  private splitClauses(text: string): string[] {
    return this.splitTopLevel(text, CLAUSE_START);
  }
  /**
   * Splits conditions at top-level AND/OR: `a AND b OR c` becomes
   * ["a", "AND b", "OR c"]. The first entry never carries an operator.
   * @private
   */
  private splitConditions(conditions: string): string[] {
    // The AND of "BETWEEN x AND y" is not a logical operator: blank it.
    const mask = this.maskParenGroups(conditions).replace(
      /\bBETWEEN\s[\s\S]+?\sAND\b/gi,
      (m) => " ".repeat(m.length),
    );
    // `$` guards placeholders such as "$and"; \b alone would split there.
    return this.splitTopLevel(conditions, /(?<![\w$])(?:AND|OR)\b/gi, mask).map(
      (piece, i) => {
        const [, operator, condition] = piece.match(
          /^(?:(AND|OR)\b\s*)?([\s\S]*)$/i,
        ) as RegExpMatchArray;
        return i === 0 || !operator
          ? condition
          : `${operator.toUpperCase()} ${condition}`.trim();
      },
    );
  }
  /**
   * Splits a comma-separated list (SELECT fields, function arguments,
   * ORDER BY terms) at top-level commas into trimmed, non-empty items.
   * @private
   */
  private splitTopLevelCommas(list: string): string[] {
    return this.splitTopLevel(list, /,/g)
      .map((item) => item.replace(/^,/, "").trim())
      .filter((item) => item);
  }
  /**
   * Masks quoted text ('...' literals and "..." identifiers) by replacing
   * each with a placeholder. Returns the masked string plus an `unmask(t)`
   * function that restores the originals. Used so that AND/OR/commas/`$N`
   * inside quotes are not misinterpreted.
   * Out of scope: dollar-quoting `$$...$$` and E'...' C-escapes.
   * @private
   */
  private maskStringLiterals(s: string): {
    masked: string;
    unmask: (t: string) => string;
  } {
    const map: string[] = [];
    const masked = s.replace(QUOTED_PATTERN, (m) => `S${map.push(m) - 1}`);
    const unmask = (t: string) =>
      t.replace(/S(\d+)/g, (_, n) => map[Number(n)] ?? "");
    return { masked, unmask };
  }

  /**
   * Returns a length-preserving mask of `s` with quoted text and everything
   * inside parentheses replaced by spaces, so keywords there (ORDER BY inside
   * `OVER (...)`, subqueries, 'no limit here') are not clause boundaries.
   * Callers slice the original text by the indices found on the mask.
   * @private
   */
  private maskParenGroups(s: string): string {
    let depth = 0;
    return s
      .replace(QUOTED_PATTERN, (m) => " ".repeat(m.length))
      .replace(/[()]|[^()]+/g, (m) => {
        if (m === "(") depth++;
        // Clamp at 0 so an unmatched ')' doesn't unmask later paren content.
        else if (m === ")") depth = Math.max(0, depth - 1);
        else if (depth === 0) return m;
        return " ".repeat(m.length);
      });
  }
  /**
   * Formats a JOIN clause: the join type on its own line, then the table
   * with its first ON condition, then one line per further AND/OR.
   * @private
   */
  private formatJoinClause(joinClause: string): string[] {
    const match = joinClause.match(JOIN_CLAUSE);
    if (!match) return [joinClause];
    const [, joinType, table, on] = match;
    if (!on) return [joinType, `  ${table.trim()}`];
    const [first, ...rest] = this.splitConditions(on);
    return [
      joinType,
      `  ${table.trim()} ON ${first}`,
      ...rest.map((condition) => `  ${condition}`),
    ];
  }

  /**
   * Recursively formats a SELECT field, expanding function calls onto
   * multiple indented lines. Single-arg "*" functions (e.g., count(*))
   * and empty-arg functions (e.g., now()) stay on a single line.
   * @private
   */
  private formatSelectField(field: string, indent: number): string[] {
    const prefix = " ".repeat(indent);
    // Set a window function's top-level "OVER ..." aside first; the greedy
    // call regex below would otherwise swallow its parentheses as arguments.
    const over = this.maskParenGroups(field).search(/\bOVER\b/i);
    const core = over < 0 ? field : field.slice(0, over).trimEnd();
    const overSuffix = over < 0 ? "" : ` ${field.slice(over).trim()}`;

    const call = core.match(/^(\w+)\s*\(([\s\S]*)\)(.*)$/);
    if (!call) return [prefix + field];
    const [, name, argList, alias] = call;
    const args = this.splitTopLevelCommas(argList);
    if (args.length === 0 || (args.length === 1 && args[0] === "*")) {
      return [prefix + field];
    }
    return [
      `${prefix}${name}(`,
      ...args.flatMap((arg, i) =>
        this.formatSelectField(
          i < args.length - 1 ? `${arg},` : arg,
          indent + 2,
        ),
      ),
      `${prefix})${alias}${overSuffix}`,
    ];
  }

  /**
   * Formats a WHERE/HAVING-style condition block: the keyword on its own
   * line, conditions indented 2, AND/OR operators on their own lines.
   * Returns an empty array when there are no conditions.
   * @private
   */
  private formatConditionClause(keyword: string, parts: string[]): string[] {
    const [first, ...rest] = this.splitConditions(parts.join(" "));
    if (first === undefined) return [];
    return [
      keyword,
      `  ${first}`,
      ...rest.flatMap((condition) => {
        const operator = condition.split(" ", 1)[0];
        return [operator, `  ${condition.slice(operator.length).trim()}`];
      }),
    ];
  }

  /**
   * Formats a comma-separated term list (GROUP BY / ORDER BY): the keyword
   * on its own line, one term per indented line. Splits only on top-level
   * commas so function arguments stay intact.
   * @private
   */
  private formatTermListClause(keyword: string, parts: string[]): string[] {
    const terms = this.splitTopLevelCommas(parts.join(", "));
    return terms.length === 0 ? [] : [keyword, `  ${terms.join(",\n  ")}`];
  }

  /**
   * Returns the formatted, multi-line SQL query string.
   * Raw-passthrough queries are returned verbatim; SELECT statements and
   * clause fragments are reformatted clause by clause.
   * @returns The formatted SQL query string.
   * @throws {Error} If a RETURNING clause is used with a SELECT statement.
   */
  toString(): string {
    if (this.parts.isRawPassthrough) return this.raw;

    // SELECT statements cannot include a RETURNING clause. (DML statements
    // pass through raw above and never reach this guard.)
    if (this.parts.returning.length > 0) {
      throw new Error("RETURNING clause cannot be used with SELECT statements");
    }

    const output: string[] = [];

    if (this.parts.select.length > 0) {
      output.push("SELECT");
      const last = this.parts.select.length - 1;
      this.parts.select.forEach((field, i) => {
        output.push(
          ...this.formatSelectField(i < last ? `${field},` : field, 2),
        );
      });
    } else if (this.parts.from) {
      output.push("SELECT");
      output.push("  *"); // Default SELECT *
    }

    // FROM
    if (this.parts.from) {
      output.push("FROM");
      output.push(`  ${this.parts.from}`);
    }

    // JOINs
    this.parts.joins.forEach((joinClause) => {
      output.push(...this.formatJoinClause(joinClause));
    });

    // WHERE / GROUP BY / HAVING / ORDER BY
    output.push(...this.formatConditionClause("WHERE", this.parts.where));
    output.push(...this.formatTermListClause("GROUP BY", this.parts.groupBy));
    output.push(...this.formatConditionClause("HAVING", this.parts.having));
    output.push(...this.formatTermListClause("ORDER BY", this.parts.orderBy));
    if (this.parts.limit !== null) output.push(`LIMIT ${this.parts.limit}`);
    if (this.parts.offset !== null) output.push(`OFFSET ${this.parts.offset}`);
    return output.join("\n");
  }
  /**
   * Gets the formatted SQL query string by calling `toString()`.
   * Includes validation check from `toString()`.
   * @returns The SQL query string.
   * @throws {Error} If validation in `toString()` fails.
   */
  get query(): string {
    return this.toString();
  }
  /**
   * Gets the parameters for the parameterized query as an array in `$N`
   * order, suitable for database drivers like node-postgres.
   *
   * @returns The query parameters as an array. Returns empty array if no parameters.
   */
  get parameters(): unknown[] {
    return [...this.params];
  }
  /**
   * Appends a new SQL fragment to the current query, returning a *new* SQLQuery instance.
   * The original query object remains unchanged (immutability).
   * Uses template literals for the fragment and handles parameter merging.
   *
   * @param strings - Template strings array for the fragment.
   * @param values - Values to be interpolated into the fragment.
   * @returns A new SQLQuery instance representing the combined query.
   *
   * @example
   * ```ts
   * let query = sql`SELECT * FROM users`;
   * query = query.sql`WHERE status = ${'active'}`;
   * query = query.sql`ORDER BY name`;
   * ```
   */
  sql(strings: TemplateStringsArray, ...values: unknown[]): SQLQuery {
    const newQuery = new SQLQuery();
    // Copy one level deep: the parts hold only strings and string arrays.
    // (structuredClone was 40% of the time of a typical chained build.)
    newQuery.parts = Object.fromEntries(
      Object.entries(this.parts).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    ) as unknown as QueryParts;
    newQuery.raw = this.raw;
    // Number the fragment's parameters after the existing ones.
    const { text, params } = this._interpolate(strings, values, this.params);
    newQuery.params = params;
    newQuery.parseQuery(text);
    return newQuery;
  }
}
/**
 * Factory function to create an SQL query using template literals.
 * This is the main entry point for the library.
 * Handles initial parameter interpolation and parsing.
 *
 * @example
 * ```ts
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`;
 * ```
 *
 * @param strings - Template strings array from the tagged template literal.
 * @param values - Values to be interpolated into the query and parameterised.
 * @returns A new SQLQuery instance.
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SQLQuery {
  return new SQLQuery(strings, ...values);
}
