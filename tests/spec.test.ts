/**
 * Specification for the lexer-based builder:
 *
 * 1. Every PostgreSQL lexical form is opaque to the formatter (dollar
 *    quoting, E'' strings, nested comments, brackets, CASE ... END).
 * 2. An appended clause is inserted where the statement expects it — in a
 *    SELECT, in DML, after a CTE — or the append throws. It is never left
 *    in a place the caller did not write it.
 * 3. AND / OR continue the condition that was written last (ON, WHERE or
 *    HAVING).
 *
 * `norm()` compares token streams: formatting may only change whitespace
 * and keyword case.
 */

import {
  deepStrictEqual as assertEquals,
  ok,
  throws,
} from "node:assert/strict";
import { describe, test } from "node:test";
import { type SQLQuery, sql } from "../mod.ts";

function norm(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .trim()
    .toUpperCase();
}

function q(text: string): SQLQuery {
  return sql(Object.assign([text], { raw: [text] }) as TemplateStringsArray);
}

describe("Lexer: every quoting form is opaque", () => {
  test("dollar-quoted string keeps commas, keywords and comment markers", () => {
    const literal = "$$it's -- fine, AND ok$$";
    const out = q(`SELECT ${literal} AS a, b FROM t WHERE c = 1`).toString();
    assertEquals(
      out,
      [
        "SELECT",
        `  ${literal} AS a,`,
        "  b",
        "FROM",
        "  t",
        "WHERE",
        "  c = 1",
      ].join("\n"),
    );
  });

  test("tagged dollar quote may contain $$", () => {
    const literal = "$fn$ a $$ b, c FROM x $fn$";
    const out = q(`SELECT ${literal} AS x FROM t`).toString();
    assertEquals(
      out,
      ["SELECT", `  ${literal} AS x`, "FROM", "  t"].join("\n"),
    );
  });

  test("E'' string with a backslash-escaped quote", () => {
    const literal = "E'it\\'s, AND x'";
    const out = q(
      `SELECT * FROM t WHERE a = ${literal} AND b = 1 -- c\n AND d = 2`,
    ).toString();
    assertEquals(
      out,
      [
        "SELECT",
        "  *",
        "FROM",
        "  t",
        "WHERE",
        `  a = ${literal}`,
        "AND",
        "  b = 1",
        "AND",
        "  d = 2",
      ].join("\n"),
    );
  });

  test("nested block comments are stripped as one comment", () => {
    const out = q("SELECT a /* outer /* inner */ still */ FROM t").toString();
    assertEquals(norm(out), "SELECT A FROM T");
  });

  test("commas inside [ ] do not split a field", () => {
    const out = q("SELECT ARRAY[1, 2, 3] AS arr, m[1, 2] FROM t").toString();
    assertEquals(
      out,
      ["SELECT", "  ARRAY[1, 2, 3] AS arr,", "  m[1, 2]", "FROM", "  t"].join(
        "\n",
      ),
    );
  });

  test("AND inside CASE ... END is not a condition boundary", () => {
    const out = q(
      "SELECT * FROM t WHERE CASE WHEN a = 1 AND b = 2 THEN true ELSE false END AND c = 3",
    ).toString();
    assertEquals(
      out,
      [
        "SELECT",
        "  *",
        "FROM",
        "  t",
        "WHERE",
        "  CASE WHEN a = 1 AND b = 2 THEN true ELSE false END",
        "AND",
        "  c = 3",
      ].join("\n"),
    );
  });

  test("$N inside a dollar-quoted string is not renumbered when nested", () => {
    const fragment = sql`note = $$costs $1$$ AND price = ${5}`;
    const query = sql`SELECT * FROM t WHERE id = ${1} AND ${fragment}`;
    ok(query.toString().includes("$$costs $1$$"), query.toString());
    ok(query.toString().includes("price = $2"), query.toString());
    assertEquals(query.parameters, [1, 5]);
  });

  test("a trailing ';' after a dollar-quoted body is stripped, not the body", () => {
    const text = "DO $$ BEGIN PERFORM 1; END $$;";
    assertEquals(q(text).toString(), "DO $$ BEGIN PERFORM 1; END $$");
  });
});

describe("Trailing SELECT clauses are clauses", () => {
  test("FOR UPDATE, FETCH and WINDOW get their own lines", () => {
    const out = q(
      "SELECT sum(x) OVER w FROM t WHERE id = 1 WINDOW w AS (PARTITION BY a ORDER BY b) ORDER BY c FETCH FIRST 5 ROWS ONLY FOR UPDATE",
    ).toString();
    assertEquals(
      out,
      [
        "SELECT",
        "  sum(",
        "    x",
        "  ) OVER w",
        "FROM",
        "  t",
        "WHERE",
        "  id = 1",
        "WINDOW",
        "  w AS (PARTITION BY a ORDER BY b)",
        "ORDER BY",
        "  c",
        "FETCH FIRST 5 ROWS ONLY",
        "FOR UPDATE",
      ].join("\n"),
    );
  });

  test("AND appended after FOR UPDATE lands in WHERE", () => {
    const query = q("SELECT * FROM t WHERE id = 1 FOR UPDATE").sql`AND x = 2`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE id = 1 AND x = 2 FOR UPDATE"),
    );
  });

  test("OFFSET appended after LIMIT ... FOR UPDATE lands before FOR", () => {
    const query = q("SELECT * FROM t LIMIT 1 FOR UPDATE").sql`OFFSET 2`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t LIMIT 1 OFFSET 2 FOR UPDATE"),
    );
  });

  test("ORDER BY appended before FETCH FIRST extends the list", () => {
    const query = q("SELECT * FROM t ORDER BY a FETCH FIRST 5 ROWS ONLY")
      .sql`ORDER BY b`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t ORDER BY a, b FETCH FIRST 5 ROWS ONLY"),
    );
  });

  test("WHERE appended to a query with WINDOW lands before WINDOW", () => {
    const query = q("SELECT sum(x) OVER w FROM t WINDOW w AS (ORDER BY b)")
      .sql`WHERE d = ${1}`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT sum(x) OVER w FROM t WHERE d = $1 WINDOW w AS (ORDER BY b)"),
    );
  });
});

describe("Appends are placed by clause order in any statement", () => {
  test("WHERE appended to UPDATE ... RETURNING", () => {
    const query = sql`UPDATE t SET a = ${1} RETURNING id`.sql`WHERE id = ${2}`;
    assertEquals(
      norm(query.toString()),
      norm("UPDATE t SET a = $1 WHERE id = $2 RETURNING id"),
    );
    assertEquals(query.parameters, [1, 2]);
  });

  test("WHERE appended to DELETE ... RETURNING", () => {
    const query = q("DELETE FROM t RETURNING *").sql`WHERE id = ${7}`;
    assertEquals(
      norm(query.toString()),
      norm("DELETE FROM t WHERE id = $1 RETURNING *"),
    );
  });

  test("clauses appended to a CTE query go to the main statement", () => {
    const query = q(
      "WITH c AS (SELECT * FROM a WHERE x = 1 ORDER BY x) SELECT * FROM c ORDER BY id",
    ).sql`WHERE y = ${2}`.sql`LIMIT ${3}`;
    assertEquals(
      norm(query.toString()),
      norm(
        "WITH c AS (SELECT * FROM a WHERE x = 1 ORDER BY x) SELECT * FROM c WHERE y = $1 ORDER BY id LIMIT $2",
      ),
    );
  });

  test("a second WHERE on DML is ANDed, with parentheses around OR", () => {
    const query = q("UPDATE t SET a = 1 WHERE b = 2").sql`WHERE c = 3 OR d = 4`;
    assertEquals(
      norm(query.toString()),
      norm("UPDATE t SET a = 1 WHERE b = 2 AND (c = 3 OR d = 4)"),
    );
  });

  test("RETURNING appended twice extends the list", () => {
    const query = q("DELETE FROM t RETURNING id").sql`RETURNING name`;
    assertEquals(
      norm(query.toString()),
      norm("DELETE FROM t RETURNING id, name"),
    );
  });

  test("EXPLAIN SELECT keeps its prefix and takes appends", () => {
    const query = q("EXPLAIN ANALYZE SELECT * FROM t ORDER BY a")
      .sql`WHERE b = ${1}`;
    assertEquals(
      norm(query.toString()),
      norm("EXPLAIN ANALYZE SELECT * FROM t WHERE b = $1 ORDER BY a"),
    );
  });

  test("fragments that are not clauses are attached in the order written", () => {
    const query = sql`INSERT INTO t (a) VALUES (${1})`
      .sql`ON CONFLICT (a) DO NOTHING`.sql`RETURNING id`;
    assertEquals(
      query.toString(),
      [
        "INSERT INTO t (a) VALUES ($1)",
        "ON CONFLICT (a) DO NOTHING",
        "RETURNING id",
      ].join("\n"),
    );
  });

  test("UPDATE built from fragments", () => {
    const query = q("UPDATE t").sql`SET a = ${1}`.sql`WHERE id = ${2}`;
    assertEquals(
      query.toString(),
      ["UPDATE t", "SET a = $1", "WHERE id = $2"].join("\n"),
    );
  });

  test("ORDER BY and LIMIT appended to a UNION apply to the whole", () => {
    const query = q("SELECT a FROM t UNION SELECT b FROM u").sql`ORDER BY 1`
      .sql`LIMIT ${5}`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT a FROM t UNION SELECT b FROM u ORDER BY 1 LIMIT $1"),
    );
  });

  test("a clause that could go in two places throws", () => {
    const base = q(
      "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) WHERE p DO UPDATE SET a = 2 WHERE t.b",
    );
    throws(() => base.sql`WHERE z`, /ambiguous/i);
    // A clause that can only go at the end is still fine.
    assertEquals(
      norm(base.sql`RETURNING id`.toString()),
      norm(
        "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) WHERE p DO UPDATE SET a = 2 WHERE t.b RETURNING id",
      ),
    );
  });
});

describe("AND / OR continue the condition written last", () => {
  test("after an appended JOIN ... ON", () => {
    const query = q("SELECT * FROM a").sql`LEFT JOIN b ON b.id = a.id`
      .sql`AND b.x = ${1}`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM a LEFT JOIN b ON b.id = a.id AND b.x = $1"),
    );
  });

  test("after HAVING", () => {
    const query = q("SELECT a FROM t GROUP BY a HAVING count(*) > 1")
      .sql`AND sum(x) > 2`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT a FROM t GROUP BY a HAVING count(*) > 1 AND sum(x) > 2"),
    );
  });

  test("after WHERE, also when a JOIN was appended before it", () => {
    const query = q("SELECT * FROM a").sql`JOIN b ON b.id = a.id`
      .sql`WHERE a.y = 2`.sql`AND a.z = 3`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM a JOIN b ON b.id = a.id WHERE a.y = 2 AND a.z = 3"),
    );
  });

  test("in the initial text, the last condition in reading order wins", () => {
    const query = q("SELECT * FROM a JOIN b ON b.id = a.id WHERE a.y = 2")
      .sql`ORDER BY a.y`.sql`OR a.z = 3`;
    assertEquals(
      norm(query.toString()),
      norm(
        "SELECT * FROM a JOIN b ON b.id = a.id WHERE a.y = 2 OR a.z = 3 ORDER BY a.y",
      ),
    );
  });

  test("a JOIN without ON has no condition: AND starts a WHERE", () => {
    const query = q("SELECT * FROM a").sql`JOIN b USING (id)`.sql`AND a.z = 3`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM a JOIN b USING (id) WHERE a.z = 3"),
    );
  });
});

describe("Nesting inlines the statement in clause order", () => {
  test("appended clauses are in place, on the lines they were written", () => {
    const inner = sql`SELECT id FROM t ORDER BY id`.sql`WHERE x = ${1}`;
    const query = sql`SELECT * FROM u WHERE id IN (${inner})`;
    assertEquals(
      query.toString(),
      [
        "SELECT",
        "  *",
        "FROM",
        "  u",
        "WHERE",
        "  id IN (SELECT id FROM t",
        "WHERE x = $1",
        "ORDER BY id)",
      ].join("\n"),
    );
  });
});
