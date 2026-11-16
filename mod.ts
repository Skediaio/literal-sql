/**
 * A lightweight, raw SQL query builder that prioritizes SQL development through template literals,
 * rather than abstracting SQL behind programming language constructs like traditional query builders.
 *
 * This module provides tools for building SQL queries safely and incrementally.
 * It handles parameter interpolation automatically (using $1, $2 style placeholders)
 * and helps prevent SQL injection vulnerabilities. Every statement (SELECT,
 * DML, WITH, EXPLAIN, ...) takes appended clauses, each put where the
 * statement expects it. Only SELECT statements are formatted as multi-line
 * SQL; any other statement is returned as its text.
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
/** A piece of SQL text that is more than plain words and operators. */
interface Token {
  kind: "comment" | "quoted" | "param" | "open" | "close";
  start: number;
  end: number;
}
/** A top-level clause of a statement, as offsets into its text. */
interface Clause {
  /** select, from, join, where, group, having, window, order, limit, offset, fetch, for, returning. */
  key: string;
  start: number;
  /** Where the content begins, right after the keyword. */
  contentStart: number;
  end: number;
}
/**
 * Everything the scanner must recognise to know what is quoted, commented
 * or nested: E'...' (backslash escapes), '...', "...", `...` (MySQL,
 * SQLite), line comment,
 * block-comment opener, dollar-quote opener, `$N`, brackets, CASE and END
 * (not after a `.` and not part of a word: `t.end` and `case$flag` are
 * columns; `$` is a word character in identifiers). An unterminated quote runs to the
 * end of the text.
 */
const TOKEN =
  /(?<![\w$])E'(?:[^'\\]|\\[\s\S]|'')*'?|'[^']*(?:''[^']*)*'?|"[^"]*(?:""[^"]*)*"?|`[^`]*(?:``[^`]*)*`?|--[^\n]*|\/\*|(?<![\w$])\$(?:[A-Z_]\w*)?\$|(?<![\w$])\$\d+|[()[\]]|(?<![\w$.])(?:CASE|END)(?![\w$])/gi;
/**
 * Matches any JOIN keyword as a unit: bare JOIN, or prefixed with
 * LEFT/RIGHT/FULL [OUTER], INNER or CROSS, optionally preceded by NATURAL.
 */
const JOIN_KEYWORD =
  "(?:NATURAL\\s+)?(?:LEFT\\s+(?:OUTER\\s+)?|RIGHT\\s+(?:OUTER\\s+)?|INNER\\s+|FULL\\s+(?:OUTER\\s+)?|CROSS\\s+)?JOIN";
/** A JOIN clause: join type, table, and the optional ON conditions. */
const JOIN_CLAUSE = new RegExp(
  `^(${JOIN_KEYWORD})\\s+([\\s\\S]+?)(?:\\s+ON\\s+([\\s\\S]+))?$`,
  "i",
);
/**
 * Clause keywords in statement order. The FROM of `IS [NOT] DISTINCT FROM`
 * is an operator, not a clause.
 */
const CLAUSE_KEYWORDS = `SELECT|(?<!\\bIS\\s+(?:NOT\\s+)?DISTINCT\\s+)FROM|${JOIN_KEYWORD}|WHERE|GROUP\\s+BY|HAVING|WINDOW|ORDER\\s+BY|LIMIT|OFFSET|FETCH\\s+(?:FIRST|NEXT)|FOR\\s+(?:UPDATE|SHARE|NO\\s+KEY\\s+UPDATE|KEY\\s+SHARE)|RETURNING`;
/** Position of each clause in a statement; LIMIT and OFFSET may swap. */
const RANKS: Record<string, number> = {
  select: 1,
  from: 2,
  join: 3,
  where: 4,
  group: 5,
  having: 6,
  window: 7,
  order: 8,
  limit: 9,
  offset: 9,
  fetch: 10,
  for: 11,
  returning: 12,
};
/**
 * Keywords after which a new run of clauses begins (the next SELECT of a set
 * operation, ON CONFLICT and its DO UPDATE / DO NOTHING action, MERGE ...
 * WHEN). Appended clauses are placed among the clauses after the last one.
 * A keyword after a `.` is a column (`t.offset`), never a clause.
 */
const BARRIER_KEYWORDS =
  "UNION|INTERSECT|EXCEPT|ON\\s+CONFLICT|DO\\s+(?:UPDATE|NOTHING)|WHEN";
const BARRIER = new RegExp(
  `(?<![\\w$.])(?:${BARRIER_KEYWORDS})(?![\\w$])`,
  "i",
);
const CLAUSE_START = new RegExp(
  `(?<![\\w$.])(?:${CLAUSE_KEYWORDS}|${BARRIER_KEYWORDS})(?![\\w$])`,
  "gi",
);
/** The keyword an appended fragment starts with, if any. */
const FRAGMENT_START = new RegExp(
  `^(?:${CLAUSE_KEYWORDS}|${BARRIER_KEYWORDS}|AND|OR)\\b`,
  "i",
);
/**
 * Text that starts with one of these is a statement or a clause fragment;
 * anything else (`deleted_at IS NULL`) is a bare condition, and an appended
 * AND / OR continues it as written instead of starting a WHERE.
 */
const STATEMENT_START = new RegExp(
  `^(?:SELECT|INSERT|UPDATE|DELETE|WITH|EXPLAIN|MERGE|VALUES|TABLE|${CLAUSE_KEYWORDS})\\b`,
  "i",
);
/** Only text that starts with one of these is formatted by toString(). */
const FORMATTABLE_START = new RegExp(
  `^(?:SELECT|FROM|${JOIN_KEYWORD}|WHERE|GROUP\\s+BY|HAVING|ORDER\\s+BY|LIMIT|OFFSET)\\b`,
  "i",
);
/** Clauses whose content is a comma-separated list: appending extends it. */
const LIST_CLAUSES = new Set([
  "select",
  "group",
  "order",
  "window",
  "returning",
]);
/** Clauses that hold a single value: appending replaces it. */
const SINGLE_CLAUSES = new Set(["from", "limit", "offset", "fetch"]);
/** The opener each closer closes: END (by its first letter) closes CASE. */
const OPENER: Record<string, string> = { ")": "(", "]": "[", e: "c" };
/** How each database writes placeholder N; `?` is positional. */
const PLACEHOLDERS = {
  postgres: "$",
  mysql: "?",
  sqlite: "?",
  mssql: "@p",
  oracle: ":",
};

/** Finds the tokens of `text`, in order; the text between them is plain. */
function scan(text: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const first = m[0][0];
    const kind =
      m[0] === "/*" || first === "-"
        ? "comment"
        : first === "(" || first === "[" || /^c/i.test(m[0])
          ? "open"
          : first === ")" || first === "]" || /^en/i.test(m[0])
            ? "close"
            : /^\$\d/.test(m[0])
              ? "param"
              : "quoted";
    let end = TOKEN.lastIndex;
    if (m[0] === "/*") {
      // Block comments nest in PostgreSQL.
      const marker = /\/\*|\*\//g;
      marker.lastIndex = end;
      for (let level = 1; level > 0; end = marker.lastIndex) {
        const found = marker.exec(text);
        if (!found) {
          end = text.length;
          break;
        }
        level += found[0] === "/*" ? 1 : -1;
      }
    } else if (first === "$" && kind === "quoted") {
      // $tag$ ... $tag$: runs to the same marker.
      const close = text.indexOf(m[0], end);
      end = close < 0 ? text.length : close + m[0].length;
    }
    TOKEN.lastIndex = end;
    tokens.push({ kind, start: m.index, end });
  }
  return tokens;
}
/**
 * Returns `text` with comments, quoted text and everything nested in
 * ( ), [ ] or CASE ... END replaced by spaces. Offsets are unchanged, so
 * keywords found on the mask are top-level and can be sliced from `text`.
 */
function mask(text: string): string {
  let masked = "";
  // The unclosed openers, innermost last: "(", "[" or "c" (CASE).
  const open: string[] = [];
  let at = 0;
  const copy = (from: number, to: number, blank: boolean) => {
    masked += blank ? " ".repeat(to - from) : text.slice(from, to);
  };
  for (const { kind, start, end } of scan(text)) {
    copy(at, start, open.length > 0);
    const first = text[start].toLowerCase();
    // A top-level `$N` stays, and so does an END without CASE (a plain
    // word); an unmatched ")" or "]" is blanked.
    copy(
      start,
      end,
      open.length > 0 || (kind === "close" ? first !== "e" : kind !== "param"),
    );
    if (kind === "open") open.push(first);
    // A closer only closes its own kind: `(CASE ...)` does not end the CASE.
    else if (kind === "close" && open.at(-1) === OPENER[first]) open.pop();
    at = end;
  }
  copy(at, text.length, open.length > 0);
  return masked;
}
/**
 * Rebuilds `text` token by token: for each token of `kind`, `replace` gets
 * the token and the text built so far, and returns the text to continue with.
 */
function replaceTokens(
  text: string,
  kind: Token["kind"],
  replace: (token: string, before: string) => string,
): string {
  let result = "";
  let at = 0;
  for (const token of scan(text)) {
    if (token.kind !== kind) continue;
    result = replace(
      text.slice(token.start, token.end),
      result + text.slice(at, token.start),
    );
    at = token.end;
  }
  return result + text.slice(at);
}
/**
 * Strips `--` and (nested) block comments with the spaces before them, and
 * a trailing statement `;`, then trims.
 */
function stripComments(text: string): string {
  // Scanning is only needed when a comment marker is present at all.
  const stripped = /--|\/\*/.test(text)
    ? replaceTokens(
        text,
        "comment",
        (comment, before) =>
          before.replace(/[ \t]+$/, "") + (comment.startsWith("/*") ? " " : ""),
      )
    : text;
  return stripped.replace(/;\s*$/, "").trim();
}
/**
 * The first `$N` token of `text` that starts inside one of the
 * `[start, end)` offset pairs in `ranges`, or "" if there is none.
 */
function findParam(text: string, ranges = [0, text.length]): string {
  for (const { kind, start, end } of scan(text)) {
    if (kind !== "param") continue;
    for (let i = 0; i < ranges.length; i += 2) {
      if (start >= ranges[i] && start < ranges[i + 1]) {
        return text.slice(start, end);
      }
    }
  }
  return "";
}
/** Throws when `placeholder` (hand-written) would share numbers with `params`. */
function assertNotMixed(placeholder: string, params: unknown[]): void {
  if (placeholder && params.length > 0) {
    throw new Error(
      `The hand-written placeholder ${placeholder} cannot be combined with \${value} parameters: their numbers collide. Write \${value} instead of ${placeholder}.`,
    );
  }
}
/** Normalises a matched clause keyword ("left  join", "ORDER BY") to its key. */
function clauseKey(keyword: string): string {
  if (/join$/i.test(keyword)) return "join";
  const word = keyword.slice(0, keyword.search(/\s|$/)).toLowerCase();
  return word in RANKS ? word : "barrier";
}
/**
 * Finds the top-level clauses of a statement. After a set operation,
 * ON CONFLICT or WHEN only the clauses that follow it are returned.
 */
function findClauses(text: string, masked: string): Clause[] {
  const clauses: Clause[] = [];
  for (const m of masked.matchAll(CLAUSE_START)) {
    if (clauses.length > 0) clauses[clauses.length - 1].end = m.index;
    clauses.push({
      key: clauseKey(m[0]),
      start: m.index,
      contentStart: m.index + m[0].length,
      end: text.length,
    });
  }
  return clauses.slice(clauses.map((c) => c.key).lastIndexOf("barrier") + 1);
}
/** True when toString() formats this text (a SELECT or a clause fragment). */
function isFormattable(text: string, masked: () => string): boolean {
  return (
    text === "" || (FORMATTABLE_START.test(text) && !BARRIER.test(masked()))
  );
}
/**
 * Cuts `text` in front of every top-level match of `pattern` and returns the
 * trimmed, non-empty pieces.
 */
function splitTopLevel(
  text: string,
  pattern: RegExp,
  masked = mask(text),
): string[] {
  const starts = [0];
  for (const m of masked.matchAll(pattern)) starts.push(m.index);
  return starts
    .map((start, i) => text.slice(start, starts[i + 1]).trim())
    .filter((piece) => piece);
}
/**
 * Splits conditions at top-level AND/OR: `a AND b OR c` becomes
 * ["a", "AND b", "OR c"]. The first entry never carries an operator.
 */
function splitConditions(conditions: string): string[] {
  // The AND of "BETWEEN x AND y" is not a logical operator: blank it.
  const masked = mask(conditions).replace(/\bBETWEEN\s[\s\S]+?\sAND\b/gi, (m) =>
    " ".repeat(m.length),
  );
  // `$` guards placeholders such as "$and", `.` columns such as `t.and`.
  return splitTopLevel(conditions, /(?<![\w$.])(?:AND|OR)\b/gi, masked).map(
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
/** Splits a comma-separated list at top-level commas into non-empty items. */
function splitCommas(list: string): string[] {
  return splitTopLevel(list, /,/g)
    .map((item) => item.replace(/^,/, "").trim())
    .filter((item) => item);
}
/** Parenthesises a condition with a top-level OR, so AND can be put next to it. */
function wrapOr(condition: string): string {
  return splitConditions(condition).some((part) => /^OR\b/.test(part))
    ? `(${condition})`
    : condition;
}
/**
 * Formats a JOIN clause: the join type on its own line, then the table with
 * its first ON condition, then one line per further AND/OR.
 */
function formatJoin(joinClause: string): string[] {
  const match = joinClause.match(JOIN_CLAUSE);
  if (!match) return [joinClause];
  const [, joinType, table, on] = match;
  if (!on) return [joinType, `  ${table.trim()}`];
  const [first, ...rest] = splitConditions(on);
  return [
    joinType,
    `  ${table.trim()} ON ${first}`,
    ...rest.map((condition) => `  ${condition}`),
  ];
}
/**
 * Recursively formats a SELECT field, expanding function calls onto multiple
 * indented lines. Single-arg "*" functions (e.g., count(*)) and empty-arg
 * functions (e.g., now()) stay on a single line.
 */
function formatField(field: string, indent: number): string[] {
  const prefix = " ".repeat(indent);
  // Set a window function's top-level "OVER ..." aside first; the greedy
  // call regex below would otherwise swallow its parentheses as arguments.
  const over = mask(field).search(/\bOVER\b/i);
  const core = over < 0 ? field : field.slice(0, over).trimEnd();
  const overSuffix = over < 0 ? "" : ` ${field.slice(over).trim()}`;

  const call = core.match(/^(\w+)\s*\(([\s\S]*)\)(.*)$/);
  if (!call) return [prefix + field];
  const [, name, argList, alias] = call;
  const args = splitCommas(argList);
  if (args.length === 0 || (args.length === 1 && args[0] === "*")) {
    return [prefix + field];
  }
  return [
    `${prefix}${name}(`,
    ...args.flatMap((arg, i) =>
      formatField(i < args.length - 1 ? `${arg},` : arg, indent + 2),
    ),
    `${prefix})${alias}${overSuffix}`,
  ];
}
/** Formats a comma-separated list: one item per indented line. */
function formatList(items: string[]): string {
  return `  ${items.join(",\n  ")}`;
}
/**
 * Formats a WHERE/HAVING condition block: conditions indented 2, AND/OR
 * operators on their own lines.
 */
function formatConditions(content: string): string[] {
  const [first, ...rest] = splitConditions(content);
  return [
    `  ${first}`,
    ...rest.flatMap((condition) => {
      const operator = condition.split(" ", 1)[0];
      return [operator, `  ${condition.slice(operator.length).trim()}`];
    }),
  ];
}
/** Formats one clause as lines; `[]` when it has nothing to show. */
function formatClause(key: string, keyword: string, content: string): string[] {
  const title = keyword.toUpperCase().replace(/\s+/g, " ");
  if (key === "join") return formatJoin(`${keyword} ${content}`);
  if (!content) return key === "for" ? [title] : [];
  switch (key) {
    case "select": {
      const fields = splitCommas(content);
      return [
        title,
        ...fields.flatMap((field, i) =>
          formatField(i < fields.length - 1 ? `${field},` : field, 2),
        ),
      ];
    }
    case "where":
    case "having":
      return [title, ...formatConditions(content)];
    case "group":
    case "order":
      return [title, formatList(splitCommas(content))];
    case "from":
    case "window":
      return [title, `  ${content}`];
    default:
      // LIMIT, OFFSET, FETCH and FOR stay on a single line.
      return [`${title} ${content}`];
  }
}
/**
 * SQL text reduced to what must survive formatting: whitespace collapsed,
 * keyword case folded, quoted text kept exactly. Two texts with the same
 * signature differ in layout only. Empty list items (`a,, b`, `a, FROM`)
 * are ignored, since the formatter drops them.
 */
function signature(text: string): string {
  const quoted: string[] = [];
  return (
    replaceTokens(text, "quoted", (token, before) => {
      quoted.push(token);
      return `${before}''`;
    })
      .toUpperCase()
      .replace(
        /,(?=\s*(?:,|$|(?:FROM|WHERE|GROUP|HAVING|WINDOW|ORDER|LIMIT|OFFSET|FETCH|FOR)\b))|(?<=\b(?:SELECT|BY)\s*),/g,
        " ",
      )
      .replace(/\s*([(),[\]])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim() + quoted.join("\n")
  );
}
/**
 * Represents an SQL query with support for parameterization and incremental building.
 * Provides methods to parse, append, format, and retrieve the query string and parameters.
 */
export class SQLQuery {
  /**
   * The statement as SQL text: comments stripped, `${}` values lifted to
   * `$N` placeholders, appended clauses already in their place.
   */
  private text = "";
  /** The parameter values; `$N` refers to `params[N - 1]`. */
  private params: unknown[] = [];
  /** `mask(text)`, computed on first use and kept in step by `splice`. */
  private masked: string | null = null;
  /** The condition clause an AND/OR fragment continues: join, where or having. */
  private lastCondition = "";
  /** The first `$N` the author wrote by hand, or "": see `assertNotMixed`. */
  private handWritten = "";
  /**
   * Creates a new SQLQuery instance.
   * If called with template literals, it interpolates values and parses the initial query string.
   *
   * @param strings - Template strings array if created with template literal.
   * @param values - Values to be interpolated into the query.
   */
  constructor(strings?: TemplateStringsArray, ...values: unknown[]) {
    if (strings && strings.raw.length > 0) {
      const { text, params, handWritten } = this._interpolate(
        strings,
        values,
        [],
      );
      assertNotMixed(handWritten, params);
      this.params = params;
      this.handWritten = handWritten;
      this.text = stripComments(text);
    }
  }
  /**
   * Interpolates values into the template strings as `$N` placeholders.
   * A nested SQLQuery is inlined as its SQL text with its placeholders
   * shifted past the parameters collected so far.
   * `undefined` becomes the SQL literal `NULL`.
   *
   * @param strings - Template strings array.
   * @param values - Values to be interpolated.
   * @param startParams - Parameters already collected (not mutated).
   * @returns The interpolated SQL text, the extended parameter list and the
   * first hand-written placeholder ("" if none).
   * @private
   */
  private _interpolate(
    strings: TemplateStringsArray,
    values: unknown[],
    startParams: unknown[],
  ): { text: string; params: unknown[]; handWritten: string } {
    let params = startParams;
    let handWritten = "";
    // [start, end) offsets of the template's own text, the only place a
    // hand-written placeholder can come from.
    const ranges: number[] = [];
    let dollar = false;
    const text = strings.reduce((result, string, i) => {
      ranges.push(result.length, result.length + string.length);
      dollar ||= string.includes("$");
      if (i >= values.length) return result + string;
      const value = values[i];
      if (value instanceof SQLQuery) {
        handWritten ||= value.handWritten;
        const shift = params.length;
        params = params.concat(value.params);
        // Nothing to renumber; keeps building long lists by nesting cheap.
        if (shift === 0) return result + string + value.text;
        // Only real placeholders move: `$1` inside quotes is not a token.
        return (
          result +
          string +
          replaceTokens(
            value.text,
            "param",
            (param, before) => `${before}$${Number(param.slice(1)) + shift}`,
          )
        );
      }
      if (value === undefined) return `${result}${string}NULL`;
      // null, primitives and objects all become a numbered parameter.
      params = [...params, value];
      return `${result}${string}$${params.length}`;
    }, "");
    // Scanning is only needed when the template itself has a `$`.
    if (!handWritten && dollar) handWritten = findParam(text, ranges);
    return { text, params, handWritten };
  }
  /**
   * Sets the statement text (comments and a trailing `;` are stripped).
   *
   * @param query - The initial SQL query string.
   */
  parseInitialQuery(query: string): void {
    const handWritten = query.includes("$") ? findParam(query) : "";
    assertNotMixed(handWritten, this.params);
    this.handWritten = handWritten;
    this.text = stripComments(query);
    this.masked = null;
    this.lastCondition = "";
  }
  /**
   * Appends a fragment (typically added via `.sql()`). Each clause in it is
   * put where the statement expects it; a fragment that is not a clause
   * (`SET ...`, `ON CONFLICT ...`, `UNION ...`) is attached as written.
   *
   * @param query - The query fragment string to append.
   * @throws {Error} If a clause could go in more than one place, or if a
   * hand-written `$N` meets `${value}` parameters.
   */
  parseQuery(query: string): void {
    const handWritten =
      this.handWritten || (query.includes("$") ? findParam(query) : "");
    assertNotMixed(handWritten, this.params);
    this.handWritten = handWritten;
    this.append(query);
  }
  /**
   * Appends a fragment whose placeholders were already checked.
   * @private
   */
  private append(query: string): void {
    // Comments are stripped so a trailing "-- note" in a fragment can't
    // comment out whatever follows it.
    const fragment = stripComments(query);
    if (!fragment) return;
    const masked = mask(fragment);
    // In a SELECT a fragment without keyword is a condition for WHERE.
    const builder = isFormattable(this.text, () => this.mask);
    if (BARRIER.test(masked) || (!builder && !FRAGMENT_START.test(fragment))) {
      // A barrier starts a new run of clauses: AND / OR follows its conditions.
      if (BARRIER.test(masked)) this.lastCondition = "";
      this.splice(this.text.length, this.text.length, fragment);
      return;
    }
    for (const piece of splitTopLevel(fragment, CLAUSE_START, masked)) {
      this.place(piece);
    }
  }
  /**
   * Puts one clause ("WHERE a = 1", "LEFT JOIN b ON ...", "AND c") or a bare
   * condition in its place in the statement text.
   * @private
   */
  private place(piece: string): void {
    let keyword = piece.match(FRAGMENT_START)?.[0] ?? "";
    let content = piece.slice(keyword.length).trim();
    const clauses = findClauses(this.text, this.mask);
    const textOf = (c: Clause) => this.text.slice(c.contentStart, c.end).trim();

    if (/^(?:and|or)$/i.test(keyword)) {
      if (!content) return;
      const conditions = clauses.filter(
        (c) =>
          c.key === "where" ||
          c.key === "having" ||
          (c.key === "join" && /\bON\b/i.test(mask(textOf(c)))),
      );
      const target =
        conditions.filter((c) => c.key === this.lastCondition).at(-1) ??
        conditions.at(-1);
      if (target) {
        // A JOIN's text runs on over the FROM items after it: `ON ..., c`.
        const comma =
          target.key === "join"
            ? this.mask.slice(target.contentStart, target.end).indexOf(",")
            : -1;
        const at = comma < 0 ? target.end : target.contentStart + comma;
        this.splice(at, at, piece);
        return;
      }
      // A bare condition is continued as written.
      if (this.text && !STATEMENT_START.test(this.text)) {
        this.splice(this.text.length, this.text.length, piece);
        return;
      }
      // No condition yet, in any statement: this one starts the WHERE.
      keyword = "";
    }
    if (!keyword) [keyword, content] = ["WHERE", content || piece];
    const key = clauseKey(keyword);
    if (!content && key !== "for") return;

    const ranks = clauses.map((c) => RANKS[c.key]);
    const single = clauses.filter((c) => c.key !== "join" && c.key !== "for");
    if (
      RANKS[key] <= Math.max(...ranks) &&
      (ranks.some((rank, i) => rank < ranks[i - 1]) ||
        new Set(single.map((c) => c.key)).size < single.length)
    ) {
      throw new Error(
        `Ambiguous place for "${keyword}": the statement repeats clauses or has them out of order. Write this clause in the statement text instead.`,
      );
    }
    const isCondition = key === "where" || key === "having";
    if (isCondition || (key === "join" && /\bON\b/i.test(mask(content)))) {
      this.lastCondition = key;
    }

    const existing = clauses.find((c) => c.key === key);
    const merged =
      !existing || !textOf(existing)
        ? content
        : isCondition
          ? // The builder adds this AND, so an OR on either side is wrapped.
            `${wrapOr(textOf(existing))}\nAND ${wrapOr(content)}`
          : LIST_CLAUSES.has(key)
            ? `${textOf(existing).replace(/,$/, "")}, ${content.replace(/^,\s*/, "")}`
            : content;
    if (
      existing &&
      (isCondition || LIST_CLAUSES.has(key) || SINGLE_CLAUSES.has(key))
    ) {
      const head = this.text.slice(existing.start, existing.contentStart);
      this.splice(existing.start, existing.end, `${head} ${merged}`);
      return;
    }
    // JOIN and FOR repeat; anything else is new. Insert before the first
    // clause that comes later in a statement.
    const next = clauses.find((c) => RANKS[c.key] > RANKS[key]);
    const at = next ? next.start : this.text.length;
    this.splice(at, at, `${keyword} ${content}`.trim());
  }
  /** The mask of the statement text. */
  private get mask(): string {
    this.masked ??= mask(this.text);
    return this.masked;
  }
  /**
   * Replaces `text[start, end)` by `replacement`, on a line of its own.
   * The mask is patched instead of recomputed: clause boundaries are
   * top-level, so the replacement can be masked by itself.
   * @private
   */
  private splice(start: number, end: number, replacement: string): void {
    const { text, mask: masked } = this;
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(end).trimStart();
    const parts = [
      [before, masked.slice(0, before.length)],
      [replacement, mask(replacement)],
      [after, masked.slice(text.length - after.length)],
    ].filter(([part]) => part);
    this.text = parts.map(([part]) => part).join("\n");
    this.masked = parts.map(([, part]) => part).join("\n");
  }
  /**
   * Returns the SQL query string. A SELECT statement or clause fragment is
   * formatted as multi-line SQL; every other statement is returned as
   * written. Formatting only changes whitespace and keyword case: if the
   * result would differ in any other way, the text is returned as written.
   * @returns The SQL query string.
   * @throws {Error} If a RETURNING clause is used with a SELECT statement.
   */
  toString(): string {
    const text = this.text;
    if (!isFormattable(text, () => this.mask)) return text;
    const clauses = findClauses(text, this.mask);
    if (clauses.some((c) => c.key === "returning")) {
      throw new Error("RETURNING clause cannot be used with SELECT statements");
    }
    // A statement that starts at FROM selects everything.
    const implied =
      clauses[0]?.key === "from" && !clauses.some((c) => c.key === "select")
        ? ["SELECT", "  *"]
        : [];
    const formatted = [
      ...implied,
      ...clauses.flatMap((c) =>
        formatClause(
          c.key,
          text.slice(c.start, c.contentStart),
          text.slice(c.contentStart, c.end).trim(),
        ),
      ),
    ].join("\n");
    return signature(formatted) === signature(`${implied.join(" ")} ${text}`)
      ? formatted
      : text;
  }
  /**
   * Gets the SQL query string by calling `toString()`.
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
   * Returns the query and parameters with placeholders written for another
   * database: postgres `$1`, mysql and sqlite `?`, mssql `@p1`, oracle `:1`.
   * For `?` and oracle (whose drivers bind an array by position) the
   * parameters are listed, and oracle placeholders numbered, in the order the
   * placeholders occur.
   *
   * @param name - The database.
   * @throws {Error} If `name` is not a known database, if a positional style
   * meets hand-written `$N` (their values are not known), or as `toString()`.
   */
  dialect(name: keyof typeof PLACEHOLDERS): {
    query: string;
    parameters: unknown[];
  } {
    if (!Object.hasOwn(PLACEHOLDERS, name)) {
      throw new Error(
        `Unknown dialect "${name}": use ${Object.keys(PLACEHOLDERS).join(", ")}`,
      );
    }
    const style = PLACEHOLDERS[name];
    const byPosition = style === "?" || style === ":";
    if (byPosition && this.handWritten) {
      throw new Error(
        `dialect("${name}") binds by position and cannot reorder the hand-written placeholder ${this.handWritten}: write \${value} instead.`,
      );
    }
    const positional: unknown[] = [];
    const query = replaceTokens(this.toString(), "param", (param, before) => {
      if (!byPosition) return before + style + param.slice(1);
      positional.push(this.params[Number(param.slice(1)) - 1]);
      return before + (style === "?" ? "?" : `:${positional.length}`);
    });
    return {
      query,
      parameters: byPosition ? positional : [...this.params],
    };
  }
  /**
   * Appends a new SQL fragment to the current query, returning a *new* SQLQuery instance.
   * The original query object remains unchanged (immutability).
   * Uses template literals for the fragment and handles parameter merging.
   *
   * @param strings - Template strings array for the fragment.
   * @param values - Values to be interpolated into the fragment.
   * @returns A new SQLQuery instance representing the combined query.
   * @throws {Error} If a clause in the fragment could go in more than one place.
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
    newQuery.text = this.text;
    newQuery.masked = this.masked;
    newQuery.lastCondition = this.lastCondition;
    // Number the fragment's parameters after the existing ones.
    const { text, params, handWritten } = this._interpolate(
      strings,
      values,
      this.params,
    );
    newQuery.handWritten = this.handWritten || handWritten;
    assertNotMixed(newQuery.handWritten, params);
    newQuery.params = params;
    newQuery.append(text);
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
