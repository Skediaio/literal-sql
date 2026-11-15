/**
 * Defects found by an independent review of the text-model builder. Each
 * test states the behaviour that should hold and fails until it is fixed.
 */

import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { describe, test } from "node:test";
import { type SQLQuery, sql } from "../mod.ts";

function q(text: string): SQLQuery {
  return sql(Object.assign([text], { raw: [text] }) as TemplateStringsArray);
}

function append(query: SQLQuery, fragment: string): SQLQuery {
  return query.sql(
    Object.assign([fragment], { raw: [fragment] }) as TemplateStringsArray,
  );
}

/** The output, or null when building it throws (an accepted outcome). */
function outputOrThrow(build: () => SQLQuery): string | null {
  try {
    return build().toString();
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .trim()
    .toUpperCase();
}

describe("Review: keyword-named columns", () => {
  test("a column named end inside a subquery does not close the subquery", () => {
    const out = append(
      q("SELECT * FROM u"),
      "WHERE u.t < (SELECT max(e.end) FROM e) ORDER BY u.id",
    ).toString();
    assertEquals(
      out,
      [
        "SELECT",
        "  *",
        "FROM",
        "  u",
        "WHERE",
        "  u.t < (SELECT max(e.end) FROM e)",
        "ORDER BY",
        "  u.id",
      ].join("\n"),
    );
    const and = append(
      q("SELECT a FROM u WHERE b IN (SELECT t.end FROM t)"),
      "AND x = 1",
    ).toString();
    assertEquals(
      and,
      [
        "SELECT",
        "  a",
        "FROM",
        "  u",
        "WHERE",
        "  b IN (SELECT t.end FROM t)",
        "AND",
        "  x = 1",
      ].join("\n"),
    );
  });

  test("a column named case does not hide the rest of the statement", () => {
    const out = append(
      q("SELECT t.case FROM t WHERE a = 1"),
      "WHERE b = 2",
    ).toString();
    assertEquals(
      out,
      [
        "SELECT",
        "  t.case",
        "FROM",
        "  t",
        "WHERE",
        "  a = 1",
        "AND",
        "  b = 2",
      ].join("\n"),
    );
  });

  test("a qualified column named like a clause keyword is not a clause", () => {
    const out = append(
      q("UPDATE t SET a = s.offset FROM s"),
      "WHERE b",
    ).toString();
    assertEquals(
      out,
      ["UPDATE t SET a = s.offset FROM s", "WHERE b"].join("\n"),
    );
  });
});

describe("Review: DISTINCT", () => {
  test("SELECT DISTINCT(col) FROM: an appended SELECT term joins the select list", () => {
    const out = append(
      q("SELECT DISTINCT(email) FROM users"),
      "SELECT name",
    ).toString();
    assertEquals(norm(out), norm("SELECT DISTINCT(email), name FROM users"));
  });
});

describe("Review: ON CONFLICT", () => {
  test("ON CONFLICT (...) WHERE predicate: an appended WHERE stays out of DO UPDATE SET", () => {
    const out = outputOrThrow(() =>
      append(
        q(
          "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) WHERE a > 0 DO UPDATE SET b = 1",
        ),
        "WHERE c",
      ),
    );
    if (out === null) return;
    assertEquals(
      out,
      [
        "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) WHERE a > 0 DO UPDATE SET b = 1",
        "WHERE c",
      ].join("\n"),
    );
  });
});

describe("Review: AND / OR without a condition", () => {
  test("AND on an UPDATE without WHERE does not extend the SET expression", () => {
    const out = outputOrThrow(() =>
      append(q("UPDATE t SET flag = true"), "AND b = 2"),
    );
    if (out === null) return;
    assertEquals(out, ["UPDATE t SET flag = true", "WHERE b = 2"].join("\n"));
  });

  test("AND on a WITH ... SELECT without WHERE starts the WHERE", () => {
    const out = outputOrThrow(() =>
      append(q("WITH x AS (SELECT 1 AS a) SELECT * FROM x"), "AND a = 1"),
    );
    if (out === null) return;
    assertEquals(
      out,
      ["WITH x AS (SELECT 1 AS a) SELECT * FROM x", "WHERE a = 1"].join("\n"),
    );
  });

  test("AND on an EXPLAIN without WHERE starts the WHERE", () => {
    const out = append(q("EXPLAIN SELECT * FROM t"), "AND a = 1").toString();
    assertEquals(out, ["EXPLAIN SELECT * FROM t", "WHERE a = 1"].join("\n"));
  });
});

describe("Review: regression variants", () => {
  test("a column named end in a DML subquery leaves a top-level WHERE", () => {
    const out = append(
      q("UPDATE t SET a = (SELECT max(e.end) FROM e WHERE e.id = t.id)"),
      "WHERE t.b",
    ).toString();
    assertEquals(
      out,
      [
        "UPDATE t SET a = (SELECT max(e.end) FROM e WHERE e.id = t.id)",
        "WHERE t.b",
      ].join("\n"),
    );
  });

  test("a column named end in a select-list subquery", () => {
    const out = append(
      q("SELECT (SELECT max(e.end) FROM e) AS m FROM u"),
      "WHERE u.a",
    ).toString();
    assertEquals(
      out,
      [
        "SELECT",
        "  (SELECT max(e.end) FROM e) AS m",
        "FROM",
        "  u",
        "WHERE",
        "  u.a",
      ].join("\n"),
    );
  });

  test("a column named returning is not the RETURNING clause", () => {
    const out = append(q("UPDATE t SET a = t.returning"), "WHERE b");
    assertEquals(
      out.toString(),
      ["UPDATE t SET a = t.returning", "WHERE b"].join("\n"),
    );
  });

  test("qualified columns named and, or, join, union, when, limit", () => {
    const out = append(
      q(
        "SELECT t.limit, t.or FROM t JOIN s ON s.join = t.union WHERE t.when = 1 AND t.and = 2",
      ),
      "WHERE b",
    ).toString();
    assertEquals(
      out,
      [
        "SELECT",
        "  t.limit,",
        "  t.or",
        "FROM",
        "  t",
        "JOIN",
        "  s ON s.join = t.union",
        "WHERE",
        "  t.when = 1",
        "AND",
        "  t.and = 2",
        "AND",
        "  b",
      ].join("\n"),
    );
  });

  test("SELECT DISTINCT(col) FROM: an appended FROM replaces the one FROM", () => {
    const out = append(
      q("SELECT DISTINCT(email) FROM users"),
      "FROM other",
    ).toString();
    assertEquals(
      out,
      ["SELECT", "  DISTINCT(", "    email", "  )", "FROM", "  other"].join(
        "\n",
      ),
    );
  });

  test("CASE nested in parentheses and in another CASE still masks", () => {
    const nested = append(
      q("SELECT (CASE WHEN a THEN 1 ELSE 2 END) AS c FROM t"),
      "WHERE z",
    ).toString();
    assertEquals(
      nested,
      [
        "SELECT",
        "  (CASE WHEN a THEN 1 ELSE 2 END) AS c",
        "FROM",
        "  t",
        "WHERE",
        "  z",
      ].join("\n"),
    );
    const inCase = append(
      q(
        "SELECT CASE WHEN a THEN CASE WHEN b THEN 1 ELSE 2 END ELSE 3 END AS c FROM t",
      ),
      "WHERE z",
    ).toString();
    assertEquals(
      inCase,
      [
        "SELECT",
        "  CASE WHEN a THEN CASE WHEN b THEN 1 ELSE 2 END ELSE 3 END AS c",
        "FROM",
        "  t",
        "WHERE",
        "  z",
      ].join("\n"),
    );
  });

  test("a top-level END without CASE is a plain word", () => {
    assertEquals(q("BEGIN; SELECT 1; END").toString(), "BEGIN; SELECT 1; END");
  });
});
