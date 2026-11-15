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
  /** True when the initial query is an INSERT, UPDATE, or DELETE statement. */
  isDML: boolean;
  /** True when the query is DML or contains WITH/UNION/INTERSECT/EXCEPT and should pass through raw. */
  isRawPassthrough: boolean;
  /** Original raw query string used when isRawPassthrough is true. */
  rawQuery: string | null;
}
/**
 * Internal interface for storing parameters using numbered keys.
 * @private
 */
interface Params {
  [key: number]: unknown;
}
/**
 * Represents an SQL query with support for parameterization and incremental building.
 * Provides methods to parse, append, format, and retrieve the query string and parameters.
 */
export class SQLQuery {
  /** The different parts of the SQL query, parsed into categories. */
  private parts: QueryParts;
  /** The parameters for the parameterized query, stored internally by number. */
  private params: Params;
  /** Counter for generating parameter numbers ($1, $2, etc.). */
  private paramCounter: number;
  /**
   * The query's raw SQL text (comments stripped, `${}` values already lifted
   * to `$N` placeholders). Used verbatim — never the formatted `toString()`
   * output — when this query is nested inside another as a fragment.
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
      isDML: false,
      isRawPassthrough: false,
      rawQuery: null,
    };
    this.params = {};
    this.paramCounter = 0;
    this.raw = "";
    if (strings && strings.raw.length > 0) {
      // Check raw length for template presence
      const { interpolatedQuery, initialParams, initialCounter } =
        this._interpolate(strings, values, 0, {});
      this.params = initialParams;
      this.paramCounter = initialCounter;
      this.parseInitialQuery(interpolatedQuery);
    }
  }
  /**
   * Interpolates values into the template strings, handles parameterization ($1, $2),
   * and attempts to integrate nested SQLQuery fragments while renumbering parameters.
   * Replaces `undefined` values with the SQL literal `NULL`.
   *
   * @param strings - Template strings array.
   * @param values - Values to be interpolated.
   * @param startCounter - The parameter counter to start from (for nesting).
   * @param startParams - The parameters object to start from (for nesting).
   * @returns An object containing the interpolated query string fragment,
   * the updated parameters object, and the updated parameter counter.
   * @private
   */
  private _interpolate(
    strings: TemplateStringsArray,
    values: unknown[],
    startCounter: number,
    startParams: Params,
  ): {
    interpolatedQuery: string;
    initialParams: Params;
    initialCounter: number;
  } {
    let currentCounter = startCounter;
    const currentParams = { ...startParams };
    const interpolatedQuery = strings.reduce((result, string, i) => {
      if (i < values.length) {
        const value = values[i];
        // Handle nested SQLQuery instances: inline the fragment's raw SQL
        // text and shift its $N placeholders past the parameters collected
        // so far. Renumbering happens in a single pass so a shifted
        // placeholder can never collide with a not-yet-shifted one.
        if (value instanceof SQLQuery) {
          const shift = currentCounter;
          // Mask string literals so text like 'costs $1' is not renumbered.
          const { masked, unmask } = this.maskStringLiterals(value.raw);
          const nestedFragment = unmask(
            masked.replace(
              /\$(\d+)\b/g,
              (_match, n) => `$${Number(n) + shift}`,
            ),
          );
          value.parameters.forEach((paramValue, index) => {
            currentParams[shift + index + 1] = paramValue;
          });
          currentCounter += value.parameters.length;
          return result + string + nestedFragment;
        }
        // Handle undefined -> NULL literal
        if (value === undefined) {
          return result + string + "NULL";
        }
        // Handle null, primitives, and other objects as parameters
        // Everything else becomes a numbered parameter
        currentCounter++;
        currentParams[currentCounter] = value;
        return result + string + `$${currentCounter}`;
      }
      return result + string;
    }, "");
    return {
      interpolatedQuery,
      initialParams: currentParams,
      initialCounter: currentCounter,
    };
  }
  /**
   * Parses a query fragment (typically added via `.sql()`) and appends it
   * to the appropriate query part. Fragments appended to raw-passthrough
   * queries (DML, WITH/UNION/...) are attached verbatim instead of parsed.
   *
   * @param query - The query fragment string to parse and append.
   */
  parseQuery(query: string): void {
    // Strip line comments (outside string literals) so a trailing "-- note"
    // in a fragment can't comment out whatever toString() joins after it.
    // Trailing whitespace left by stripping is removed on the masked text,
    // so whitespace inside string literals is untouched.
    const { masked, unmask } = this.maskStringLiterals(query);
    const trimmedQuery = unmask(
      masked.replace(/--[^\n]*/g, "").replace(/[ \t]+(?=\n|$)/g, ""),
    ).trim();
    if (!trimmedQuery) return;
    this.raw = this.raw ? `${this.raw}\n${trimmedQuery}` : trimmedQuery;
    // Raw-passthrough queries are never re-parsed; appended fragments are
    // attached to the raw query text so they aren't silently dropped.
    if (this.parts.isRawPassthrough) {
      this.parts.rawQuery = this.parts.rawQuery
        ? `${this.parts.rawQuery}\n${trimmedQuery}`
        : trimmedQuery;
      return;
    }
    const lowerQuery = trimmedQuery.toLowerCase();
    // Basic clause detection for appending
    if (lowerQuery.startsWith("from ")) {
      this.parts.from = trimmedQuery.substring(4).trim();
    } else if (
      lowerQuery.startsWith("join ") ||
      lowerQuery.startsWith("left join ") ||
      lowerQuery.startsWith("right join ") ||
      lowerQuery.startsWith("inner join ") ||
      lowerQuery.startsWith("full outer join ") ||
      lowerQuery.startsWith("full join ") ||
      lowerQuery.startsWith("cross join ") ||
      lowerQuery.startsWith("natural left join ") ||
      lowerQuery.startsWith("natural right join ") ||
      lowerQuery.startsWith("natural inner join ") ||
      lowerQuery.startsWith("natural full outer join ") ||
      lowerQuery.startsWith("natural full join ") ||
      lowerQuery.startsWith("natural join ")
    ) {
      if (trimmedQuery) this.parts.joins.push(trimmedQuery);
    } else if (lowerQuery.startsWith("where ")) {
      const condition = trimmedQuery.substring(5).trim();
      if (condition) {
        if (this.parts.where.length === 0) this.parts.where.push(condition);
        else this.parts.where.push(`AND ${condition}`); // Assume AND if WHERE exists
      }
    } else if (lowerQuery.startsWith("and ")) {
      if (trimmedQuery.substring(3).trim()) this.parts.where.push(trimmedQuery);
    } else if (lowerQuery.startsWith("or ")) {
      if (trimmedQuery.substring(2).trim()) this.parts.where.push(trimmedQuery);
    } else if (lowerQuery.startsWith("group by ")) {
      const content = trimmedQuery.substring(8).trim();
      if (content) this.parts.groupBy.push(content);
    } else if (lowerQuery.startsWith("having ")) {
      const content = trimmedQuery.substring(6).trim();
      if (content) {
        if (this.parts.having.length === 0) this.parts.having.push(content);
        else this.parts.having.push(`AND ${content}`); // Assume AND if HAVING exists
      }
    } else if (lowerQuery.startsWith("order by ")) {
      const content = trimmedQuery.substring(8).trim();
      if (content) this.parts.orderBy.push(content);
    } else if (lowerQuery.startsWith("limit ")) {
      this.parts.limit = trimmedQuery.substring(5).trim();
    } else if (lowerQuery.startsWith("offset ")) {
      this.parts.offset = trimmedQuery.substring(6).trim();
    } else if (lowerQuery.startsWith("returning ")) {
      const content = trimmedQuery.substring(9).trim();
      if (content) this.parts.returning.push(content);
    } else if (trimmedQuery) {
      // Default: Add as WHERE condition
      if (this.parts.where.length > 0) {
        this.parts.where.push(`AND ${trimmedQuery}`);
      } else this.parts.where.push(trimmedQuery);
    }
  }
  /**
   * Parses the initial complete SQL query string provided to the constructor or `sql` tag.
   * It attempts to identify top-level clauses and sets the `isDML` flag.
   * This parser is relatively simple and relies on `toString()` for detailed formatting.
   *
   * @param query - The initial SQL query string.
   */
  parseInitialQuery(query: string): void {
    // Strip SQL line comments (-- to end of line) OUTSIDE string literals,
    // so that '--' inside quotes is preserved while real comments are removed.
    const { masked: commentMasked, unmask: commentUnmask } =
      this.maskStringLiterals(query);
    // Strip comments, then the trailing whitespace they leave behind (on the
    // masked text, so whitespace inside string literals is untouched).
    query = commentUnmask(
      commentMasked.replace(/--[^\n]*/g, "").replace(/[ \t]+(?=\n|$)/g, ""),
    );
    const originalTrimmed = query.trim();
    const originalTrimmedLower = originalTrimmed.toLowerCase();
    this.raw = originalTrimmed;

    // Pass-through for DML (INSERT/UPDATE/DELETE) and WITH/CTE/UNION/
    // INTERSECT/EXCEPT — the SELECT-centric parser would corrupt these
    // (e.g. rewrite an UPDATE as a SELECT, or misclassify a second SELECT
    // as WHERE). The statement is kept verbatim (trimmed, comments
    // stripped); parameters are still lifted to $N by _interpolate.
    const isDMLQuery = /^\s*(insert|update|delete)\b/i.test(
      originalTrimmedLower,
    );
    if (
      isDMLQuery ||
      /^\s*WITH\b/i.test(originalTrimmedLower) ||
      /\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/i.test(
        this.maskStringLiterals(originalTrimmedLower).masked,
      )
    ) {
      this.parts.isDML = isDMLQuery;
      this.parts.isRawPassthrough = true;
      this.parts.rawQuery = originalTrimmed;
      return;
    }

    const hasSelectKeyword = /\bselect\b/i.test(originalTrimmedLower);

    // Clause extraction logic (simplified regex matching)
    // Note: This simple regex approach might misinterpret nested queries or complex syntax.
    //
    // JOIN_ALTERNATION matches any JOIN keyword as a unit (bare JOIN, or prefixed
    // with LEFT/RIGHT/INNER/FULL [OUTER]/CROSS, optionally preceded by NATURAL).
    // Used in the select/from/joins lookaheads so the lazy capture stops at the
    // START of the full JOIN construct rather than at the bare JOIN inside it.
    const JOIN_ALTERNATION =
      "(?:NATURAL\\s+)?(?:LEFT\\s+|RIGHT\\s+|INNER\\s+|FULL\\s+(?:OUTER\\s+)?|CROSS\\s+)?JOIN\\b";
    const clauses: { [key: string]: RegExp } = {
      select: new RegExp(
        `\\bSELECT\\b([\\s\\S]*?)(?=\\bFROM\\b|${JOIN_ALTERNATION}|\\bWHERE\\b|\\bGROUP BY\\b|\\bHAVING\\b|\\bORDER BY\\b|\\bLIMIT\\b|\\bOFFSET\\b|\\bRETURNING\\b|$)`,
        "i",
      ),
      from: new RegExp(
        `\\bFROM\\b([\\s\\S]*?)(?=${JOIN_ALTERNATION}|\\bWHERE\\b|\\bGROUP BY\\b|\\bHAVING\\b|\\bORDER BY\\b|\\bLIMIT\\b|\\bOFFSET\\b|\\bRETURNING\\b|$)`,
        "i",
      ),
      joins: new RegExp(
        `(\\b${JOIN_ALTERNATION}[\\s\\S]*?)(?=${JOIN_ALTERNATION}|\\bWHERE\\b|\\bGROUP BY\\b|\\bHAVING\\b|\\bORDER BY\\b|\\bLIMIT\\b|\\bOFFSET\\b|\\bRETURNING\\b|$)`,
        "gi",
      ),
      where:
        /\bWHERE\b([\s\S]*?)(?=\bGROUP BY\b|\bHAVING\b|\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|\bRETURNING\b|$)/i,
      groupBy:
        /\bGROUP BY\b([\s\S]*?)(?=\bHAVING\b|\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|\bRETURNING\b|$)/i,
      having:
        /\bHAVING\b([\s\S]*?)(?=\bORDER BY\b|\bLIMIT\b|\bOFFSET\b|\bRETURNING\b|$)/i,
      orderBy:
        /\bORDER BY\b([\s\S]*?)(?=\bLIMIT\b|\bOFFSET\b|\bRETURNING\b|$)/i,
      limit: /\bLIMIT\b([\s\S]*?)(?=\bOFFSET\b|\bRETURNING\b|$)/i,
      offset: /\bOFFSET\b([\s\S]*?)(?=\bRETURNING\b|$)/i,
      returning: /\bRETURNING\b([\s\S]*?)$/i,
    };

    // --- Boundary mask: hide paren content so clause keywords inside parens
    // (e.g. ORDER BY inside `OVER (...)`, CASE expressions, subqueries) don't
    // trigger false clause boundaries. maskParenGroups is length-preserving;
    // we slice content from the original `query` using match indices, so
    // captured content retains real parens for downstream scanners.
    const boundaryMask = this.maskParenGroups(query);
    const sliceContent = (m: RegExpMatchArray): string => {
      const start = m.index! + (m[0].length - m[1].length);
      const end = m.index! + m[0].length;
      return query.substring(start, end);
    };

    // --- Extract SELECT ---
    const selectMatch = boundaryMask.match(clauses.select);
    if (selectMatch && selectMatch[1].trim()) {
      const fields = this.splitTopLevelCommas(sliceContent(selectMatch))
        .map((f) => f.trim())
        .filter((f) => f);
      if (fields.length > 0) {
        this.parts.select.push(...fields);
      }
    } else if (
      !this.parts.isDML &&
      !hasSelectKeyword &&
      originalTrimmed &&
      !originalTrimmedLower.match(
        /^\s*(from|where|group|order|limit|offset|returning)\b/,
      )
    ) {
      // Handle cases like sql`${val1} ${val2}` -> becomes SELECT field(s)
      this.parts.select.push(originalTrimmed);
    }
    // --- Extract other clauses ---
    const fromMatch = boundaryMask.match(clauses.from);
    if (fromMatch && fromMatch[1].trim()) {
      this.parts.from = sliceContent(fromMatch).trim();
    }
    let joinMatch: RegExpExecArray | null;
    const joinRegex = clauses.joins;
    joinRegex.lastIndex = 0;
    while ((joinMatch = joinRegex.exec(boundaryMask)) !== null) {
      if (joinMatch?.[0]?.trim()) {
        // Slice from original query (mask is length-preserving).
        const joinContent = query
          .substring(joinMatch.index!, joinMatch.index! + joinMatch[0].length)
          .trim();
        if (
          joinContent &&
          !this.parts.joins.some((existing) => existing.includes(joinContent))
        ) {
          this.parts.joins.push(joinContent);
        }
      }
      if (joinMatch && joinRegex.lastIndex === joinMatch.index) {
        joinRegex.lastIndex++;
      }
    }
    const whereMatch = boundaryMask.match(clauses.where);
    if (whereMatch && whereMatch[1].trim()) {
      this.parts.where.push(sliceContent(whereMatch).trim());
    }
    const groupByMatch = boundaryMask.match(clauses.groupBy);
    if (groupByMatch && groupByMatch[1].trim()) {
      this.parts.groupBy.push(sliceContent(groupByMatch).trim());
    }
    const havingMatch = boundaryMask.match(clauses.having);
    if (havingMatch && havingMatch[1].trim()) {
      this.parts.having.push(sliceContent(havingMatch).trim());
    }
    const orderByMatch = boundaryMask.match(clauses.orderBy);
    if (orderByMatch && orderByMatch[1].trim()) {
      this.parts.orderBy.push(sliceContent(orderByMatch).trim());
    }
    const limitMatch = boundaryMask.match(clauses.limit);
    if (limitMatch && limitMatch[1].trim()) {
      this.parts.limit = sliceContent(limitMatch).trim();
    }
    const offsetMatch = boundaryMask.match(clauses.offset);
    if (offsetMatch && offsetMatch[1].trim()) {
      this.parts.offset = sliceContent(offsetMatch).trim();
    }

    // Extract RETURNING clause (used for DML statements)
    const returningMatch = boundaryMask.match(clauses.returning);
    if (returningMatch && returningMatch[1].trim()) {
      this.parts.returning.push(sliceContent(returningMatch).trim());
    }
    // Note: Default SELECT * logic is handled in toString()
  }
  /**
   * Splits SQL conditions by top-level AND/OR, respecting parentheses.
   * Char-scanner with paren-depth tracking, BETWEEN-AND masking, and
   * string-literal masking (so AND/OR inside quotes isn't mis-split).
   * Returns array like ["cond1", "AND cond2", "OR cond3"]
   * @param conditionString - The string containing conditions.
   * @returns An array of condition strings, subsequent parts prefixed with AND/OR.
   * @private
   */
  private splitConditions(conditionString: string): string[] {
    if (!conditionString) return [];

    // Mask string literals first so AND/OR inside quotes isn't seen as a
    // logical operator. Unmask at return.
    const { masked: litMasked, unmask: litUnmask } =
      this.maskStringLiterals(conditionString);

    // Mask BETWEEN's AND so it isn't treated as a logical operator.
    // Placeholder must not contain the literal text "AND" or "OR" — the
    // top-level scanner would otherwise split inside the placeholder.
    const BETWEEN_MASK = "\u0000BTWN\u0000";
    const masked = litMasked.replace(
      /\bBETWEEN\b\s+[\s\S]+?\s+\bAND\b\s+/gi,
      (m) => m.replace(/\bAND\b/i, BETWEEN_MASK),
    );

    // Scan and split on top-level AND/OR, respecting parentheses
    const tokens: string[] = [];
    let current = "";
    let parenDepth = 0;
    let i = 0;
    while (i < masked.length) {
      const ch = masked[i];
      if (ch === "(") {
        parenDepth++;
        current += ch;
        i++;
        continue;
      }
      if (ch === ")") {
        parenDepth--;
        current += ch;
        i++;
        continue;
      }
      if (parenDepth === 0) {
        const m = masked.substring(i).match(/^(AND|OR)(?![A-Za-z0-9_])/i);
        if (m) {
          if (current.trim()) {
            tokens.push(current.trim());
            tokens.push(m[1].toUpperCase());
          }
          current = "";
          i += m[0].length;
          continue;
        }
      }
      current += ch;
      i++;
    }
    if (current.trim()) tokens.push(current.trim());

    // Unmask BETWEEN's AND, then unmask string literals.
    for (let k = 0; k < tokens.length; k++) {
      tokens[k] = tokens[k].replace(new RegExp(BETWEEN_MASK, "gi"), "AND");
      tokens[k] = litUnmask(tokens[k]);
    }

    // Reassemble into ["cond1", "AND cond2", "OR cond3", ...]
    if (tokens.length === 0) return [];
    if (tokens.length === 1) return tokens;
    const result: string[] = [tokens[0]];
    for (let j = 1; j < tokens.length; j += 2) {
      const op = tokens[j];
      const cond = tokens[j + 1] || "";
      result.push(`${op} ${cond}`.trim());
    }
    return result;
  }

  /**
   * Masks SQL single-quoted string literals (with `''` doubling support) by
   * replacing each literal with a `\u0001S<n>\u0001` placeholder. Returns the
   * masked string plus an `unmask(t)` function that restores the originals.
   * Used by splitConditions / splitTopLevelCommas / the comment stripper so
   * that AND/OR/commas/-- inside string literals are not misinterpreted.
   * Out of scope: dollar-quoting `$$...$$`, E'...' C-escapes, "..." identifiers.
   * @private
   */
  private maskStringLiterals(s: string): {
    masked: string;
    unmask: (t: string) => string;
  } {
    const map: string[] = [];
    let masked = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === "'") {
        let literal = "'";
        i++;
        while (i < s.length) {
          if (s[i] === "'" && s[i + 1] === "'") {
            literal += "''";
            i += 2;
            continue;
          }
          if (s[i] === "'") {
            literal += "'";
            i++;
            break;
          }
          literal += s[i];
          i++;
        }
        masked += `\uE000S${map.length}\uE000`;
        map.push(literal);
      } else {
        masked += s[i];
        i++;
      }
    }
    const unmask = (t: string) =>
      t.replace(/\uE000S(\d+)\uE000/g, (_, n) => map[Number(n)] ?? "");
    return { masked, unmask };
  }

  /**
   * Returns a length-preserving mask of `s` with all parenthesized group
   * content replaced by spaces. String literals (with `''` doubling) are
   * passed through unchanged so quoted parens don't affect depth tracking.
   * Used by parseInitialQuery to detect clause boundaries on the mask, then
   * slice content from the original query — so keywords inside parens
   * (ORDER BY inside `OVER (...)`, CASE/WHEN, subqueries) don't trigger
   * false clause boundaries while captured content retains its real parens.
   * @private
   */
  private maskParenGroups(s: string): string {
    let masked = "";
    let depth = 0;
    let inString = false;
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === "'" && !inString) {
        inString = true;
        masked += ch;
        i++;
        continue;
      }
      if (inString) {
        if (ch === "'" && s[i + 1] === "'") {
          masked += "''";
          i += 2;
          continue;
        }
        if (ch === "'") inString = false;
        masked += ch;
        i++;
        continue;
      }
      if (ch === "(") {
        depth++;
        masked += " ";
      } else if (ch === ")") {
        // Clamp at 0 so unmatched ')' in malformed SQL doesn't drive depth
        // negative and leak subsequent paren content unmasked.
        depth = Math.max(0, depth - 1);
        masked += " ";
      } else if (depth > 0) {
        masked += " ";
      } else {
        masked += ch;
      }
      i++;
    }
    return masked;
  }

  /**
   * Splits a string at top-level commas, respecting parentheses AND string
   * literals. Used for SELECT field lists and function argument lists.
   * @private
   */
  private splitTopLevelCommas(s: string): string[] {
    const { masked, unmask } = this.maskStringLiterals(s);
    const parts: string[] = [];
    let current = "";
    let parenDepth = 0;
    for (const ch of masked) {
      if (ch === "(") {
        parenDepth++;
        current += ch;
      } else if (ch === ")") {
        parenDepth--;
        current += ch;
      } else if (ch === "," && parenDepth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    return parts.map(unmask);
  }
  /**
   * Formats a JOIN clause string according to multi-line rules.
   * @param joinClause - The raw join clause string.
   * @returns An array of formatted lines.
   * @private
   */
  private formatJoinClause(joinClause: string): string[] {
    const formattedLines: string[] = [];
    const joinRegex =
      /^((?:NATURAL\s+)?(?:LEFT\s+|RIGHT\s+|INNER\s+|FULL\s+(?:OUTER\s+)?|CROSS\s+)?JOIN)\s+([\s\S]+?)(\s+ON\s+([\s\S]+))?$/i;
    const match = joinClause.match(joinRegex);
    if (match) {
      const [, joinType = "JOIN", tableInfoRaw, , onConditions] = match;
      const tableInfo = tableInfoRaw.trim();
      formattedLines.push(joinType.trim());

      if (onConditions) {
        const conditionParts = this.splitConditions(onConditions.trim());
        if (conditionParts.length > 0) {
          const firstCondition = conditionParts[0]
            .trim()
            .replace(/^(AND|OR)\s+/i, "");

          formattedLines.push(`  ${tableInfo} ON ${firstCondition}`);

          // For subsequent parts, format per test expectations
          for (let i = 1; i < conditionParts.length; i++) {
            const part = conditionParts[i].trim();
            const logicalMatch = part.match(/^(AND|OR)\b/i);
            if (logicalMatch) {
              // Format as:  "  AND condition" (operator and condition on same line)
              formattedLines.push(`  ${part}`);
            } else {
              // If no explicit operator, default to AND
              formattedLines.push(`  AND ${part}`);
            }
          }
        } else {
          formattedLines.push(`  ${tableInfo}`);
        }
      } else {
        formattedLines.push(`  ${tableInfo}`);
      }
    } else {
      formattedLines.push(joinClause);
    } // Fallback
    return formattedLines;
  }

  /**
   * Recursively formats a SELECT field, expanding nested function calls
   * onto multiple indented lines. Single-arg "*" functions (e.g., count(*))
   * and empty-arg functions (e.g., now()) stay on a single line.
   * @private
   */
  private formatSelectField(field: string, indent: number): string[] {
    const lines: string[] = [];
    const prefix = " ".repeat(indent);

    // Window function: detect trailing "OVER" at paren-depth 0 BEFORE running
    // the greedy ([\s\S]*) func-call regex (which would otherwise eat OVER's
    // parens into argsStr, corrupting e.g. ROW_NUMBER() OVER (PARTITION BY ...).
    let core = field;
    let overSuffix = "";
    const lower = field.toLowerCase();
    let depth = 0;
    for (let i = 0; i < lower.length; i++) {
      const c = lower[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (
        depth === 0 &&
        lower.startsWith("over", i) &&
        (i === 0 || !/[a-z0-9_]/i.test(lower[i - 1])) &&
        (i + 4 === lower.length || !/[a-z0-9_]/i.test(lower[i + 4]))
      ) {
        core = field.substring(0, i).trimEnd();
        overSuffix = " " + field.substring(i).trim();
        break;
      }
    }

    const funcMatch = core.match(/^(\w+)\s*\(([\s\S]*)\)(.*)$/);
    if (!funcMatch) {
      lines.push(`${prefix}${field}`);
      return lines;
    }
    const [, funcName, argsStr, aliasSuffix] = funcMatch;
    const args = this.splitTopLevelCommas(argsStr)
      .map((a) => a.trim())
      .filter((a) => a);
    if (args.length === 0 || (args.length === 1 && args[0] === "*")) {
      lines.push(`${prefix}${field}`);
      return lines;
    }
    lines.push(`${prefix}${funcName}(`);
    args.forEach((arg, i) => {
      const isLast = i === args.length - 1;
      const argWithComma = isLast ? arg : `${arg},`;
      lines.push(...this.formatSelectField(argWithComma, indent + 2));
    });
    lines.push(`${prefix})${aliasSuffix}${overSuffix}`);
    return lines;
  }

  /**
   * Formats a WHERE/HAVING-style condition block: the keyword on its own
   * line, conditions indented 2, AND/OR operators on their own lines.
   * Returns an empty array when there are no conditions.
   * @private
   */
  private formatConditionClause(
    keyword: string,
    conditionParts: string[],
  ): string[] {
    if (conditionParts.length === 0) return [];
    const lines: string[] = [keyword];
    // Combine potentially fragmented parts, then re-split on top-level AND/OR
    const conditions = this.splitConditions(conditionParts.join(" "));
    if (conditions.length > 0) {
      const firstCondition = conditions[0].trim().replace(/^(AND|OR)\s+/i, "");
      lines.push(`  ${firstCondition}`);
      for (let i = 1; i < conditions.length; i++) {
        const part = conditions[i].trim();
        const logicalMatch = part.match(/^(AND|OR)\b/i);
        if (logicalMatch) {
          // AND/OR on its own line at col 0; condition indented 2 on the next line
          lines.push(logicalMatch[0].toUpperCase());
          lines.push(`  ${part.substring(logicalMatch[0].length).trim()}`);
        } else {
          // No explicit operator — default to AND
          lines.push("AND");
          lines.push(`  ${part}`);
        }
      }
    }
    return lines;
  }

  /**
   * Formats a comma-separated term list (GROUP BY / ORDER BY / RETURNING):
   * the keyword on its own line, one term per indented line. Splits only on
   * top-level commas so function arguments stay intact.
   * @private
   */
  private formatTermListClause(keyword: string, parts: string[]): string[] {
    if (parts.length === 0) return [];
    const terms = this.splitTopLevelCommas(parts.join(", "))
      .map((s) => s.trim())
      .filter((s) => s);
    if (terms.length === 0) return [];
    return [keyword, `  ${terms.join(",\n  ")}`];
  }

  /**
   * Returns the formatted, multi-line SQL query string.
   * DML and WITH/UNION/INTERSECT/EXCEPT queries are returned verbatim
   * (raw passthrough); everything else is reformatted clause by clause.
   * @returns The formatted SQL query string.
   * @throws {Error} If a RETURNING clause is used with a SELECT statement.
   */
  toString(): string {
    // Passthrough for DML and WITH/CTE/UNION/INTERSECT/EXCEPT — return the
    // raw query (trimmed, comments stripped) without reformatting, since the
    // SELECT-centric formatter would corrupt these constructs.
    if (this.parts.isRawPassthrough && this.parts.rawQuery !== null) {
      return this.parts.rawQuery;
    }

    // SELECT statements cannot include a RETURNING clause. (DML statements
    // pass through raw above and never reach this guard.)
    if (this.parts.returning.length > 0) {
      throw new Error("RETURNING clause cannot be used with SELECT statements");
    }

    const output: string[] = [];

    if (this.parts.select.length > 0) {
      output.push("SELECT");
      const lastIdx = this.parts.select.length - 1;
      this.parts.select.forEach((part, i) => {
        const cleaned = part.replace(/,\s*$/, "");
        const isLast = i === lastIdx;
        const fieldWithSuffix = isLast ? cleaned : `${cleaned},`;
        output.push(...this.formatSelectField(fieldWithSuffix, 2));
      });
    } else if (this.parts.from) {
      output.push("SELECT");
      output.push("  *"); // Default SELECT *
    } else if (
      Object.values(this.parts).every(
        (p) => !p || (Array.isArray(p) && p.length === 0),
      )
    ) {
      output.push("SELECT");
      output.push("  *"); // sql`` case
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
    // LIMIT
    if (this.parts.limit !== null && this.parts.limit !== undefined) {
      output.push(`LIMIT ${this.parts.limit}`);
    }
    // OFFSET
    if (this.parts.offset !== null && this.parts.offset !== undefined) {
      output.push(`OFFSET ${this.parts.offset}`);
    }
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
   * Gets the parameters for the parameterized query as a correctly ordered array,
   * suitable for use with database drivers like node-postgres.
   * Handles potential gaps in parameter numbering internally.
   *
   * @returns The query parameters as an array. Returns empty array if no parameters.
   */
  get parameters(): unknown[] {
    if (Object.keys(this.params).length === 0) {
      return [];
    }
    const paramIndices = Object.keys(this.params)
      .map(Number)
      .sort((a, b) => a - b);
    if (paramIndices.length === 0) {
      return [];
    }
    const maxParam = paramIndices[paramIndices.length - 1]; // Use highest actual index found
    const finalParams = new Array(maxParam);
    for (let i = 1; i <= maxParam; i++) {
      // Fill array based on actual params, leaving undefined for gaps
      finalParams[i - 1] = Object.hasOwn(this.params, i)
        ? this.params[i]
        : undefined;
    }
    // Trim only trailing undefined values
    let lastDefinedIndex = -1;
    for (let i = finalParams.length - 1; i >= 0; i--) {
      if (finalParams[i] !== undefined) {
        lastDefinedIndex = i;
        break;
      }
    }
    return finalParams.slice(0, lastDefinedIndex + 1);
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
    // Create a new instance for immutability
    const newQuery = new SQLQuery();
    // Deep clone parts (structuredClone handles Date, RegExp etc.)
    newQuery.parts = structuredClone(this.parts);
    // Copy parameters, counter, and raw text
    newQuery.params = { ...this.params };
    newQuery.paramCounter = this.paramCounter;
    newQuery.raw = this.raw;
    // Interpolate the new fragment, starting parameter numbering after existing ones
    const { interpolatedQuery, initialParams, initialCounter } =
      newQuery._interpolate(
        strings,
        values,
        newQuery.paramCounter,
        newQuery.params,
      );
    // Update the new query's parameters and counter from interpolation result
    newQuery.params = initialParams;
    newQuery.paramCounter = initialCounter;
    // Parse the *new* interpolated fragment and add/append its parts
    newQuery.parseQuery(interpolatedQuery);
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
