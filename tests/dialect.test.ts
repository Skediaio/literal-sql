/**
 * Specification for other databases:
 *
 * 1. `dialect(name)` rewrites every real placeholder to the style of the
 *    database; positional `?` gets its parameters in text order.
 * 2. Backtick identifiers (MySQL, SQLite) and bracket identifiers
 *    (SQL Server) are opaque to clause detection.
 */

import { deepStrictEqual as assertEquals, throws } from "node:assert/strict";
import { describe, test } from "node:test";
import { type SQLQuery, sql } from "../mod.ts";

function q(text: string): SQLQuery {
  return sql(Object.assign([text], { raw: [text] }) as TemplateStringsArray);
}

describe("dialect(): placeholder styles", () => {
  const query = sql`SELECT * FROM t WHERE a = ${"x"}`.sql`AND b = ${2}`;
  const lines = (p1: string, p2: string) =>
    [
      "SELECT",
      "  *",
      "FROM",
      "  t",
      "WHERE",
      `  a = ${p1}`,
      "AND",
      `  b = ${p2}`,
    ].join("\n");

  test("postgres is toString() and parameters unchanged", () => {
    assertEquals(query.dialect("postgres"), {
      query: query.toString(),
      parameters: query.parameters,
    });
    assertEquals(query.dialect("postgres").query, lines("$1", "$2"));
  });

  test("mysql and sqlite use ?", () => {
    for (const name of ["mysql", "sqlite"] as const) {
      assertEquals(query.dialect(name), {
        query: lines("?", "?"),
        parameters: ["x", 2],
      });
    }
  });

  test("mssql uses @pN", () => {
    assertEquals(query.dialect("mssql"), {
      query: lines("@p1", "@p2"),
      parameters: ["x", 2],
    });
  });

  test("oracle uses :N", () => {
    assertEquals(query.dialect("oracle"), {
      query: lines(":1", ":2"),
      parameters: ["x", 2],
    });
  });

  test("unknown name throws", () => {
    throws(() => query.dialect("db2" as "mysql"), /Unknown dialect "db2"/);
  });

  test("toString(), query and parameters are unchanged after dialect()", () => {
    query.dialect("mysql");
    assertEquals(query.query, lines("$1", "$2"));
    assertEquals(query.parameters, ["x", 2]);
  });
});

describe("dialect(): positional parameters follow the text", () => {
  test("appended clause in DML keeps numbering order", () => {
    const query = sql`UPDATE t SET a = ${1} RETURNING id`.sql`WHERE b = ${2}`;
    assertEquals(query.dialect("mysql"), {
      query: "UPDATE t SET a = ?\nWHERE b = ?\nRETURNING id",
      parameters: [1, 2],
    });
  });

  test("clause spliced before an earlier placeholder reorders", () => {
    const query = sql`SELECT * FROM t LIMIT ${10}`.sql`WHERE a = ${"x"}`;
    assertEquals(query.parameters, [10, "x"]);
    assertEquals(query.dialect("mysql"), {
      query: [
        "SELECT",
        "  *",
        "FROM",
        "  t",
        "WHERE",
        "  a = ?",
        "LIMIT ?",
      ].join("\n"),
      parameters: ["x", 10],
    });
    // Numbered styles keep numbers and parameters.
    assertEquals(query.dialect("mssql").parameters, [10, "x"]);
    assertEquals(
      query.dialect("oracle").query,
      ["SELECT", "  *", "FROM", "  t", "WHERE", "  a = :2", "LIMIT :1"].join(
        "\n",
      ),
    );
  });

  test("$1 in quoted text or dollar quotes is not a placeholder", () => {
    const query = sql`SELECT '$1' AS a, $$ $1 $$ AS b FROM t WHERE c = ${7}`;
    assertEquals(query.dialect("mysql"), {
      query: [
        "SELECT",
        "  '$1' AS a,",
        "  $$ $1 $$ AS b",
        "FROM",
        "  t",
        "WHERE",
        "  c = ?",
      ].join("\n"),
      parameters: [7],
    });
    assertEquals(query.dialect("mssql").query.split("\n").slice(1, 3), [
      "  '$1' AS a,",
      "  $$ $1 $$ AS b",
    ]);
  });
});

describe("Backtick identifiers are opaque", () => {
  test("keywords inside backticks are not clauses", () => {
    const query = q("SELECT `order by`, `where` FROM `from` t")
      .sql`WHERE a = ${1}`;
    assertEquals(
      query.dialect("mysql").query,
      [
        "SELECT",
        "  `order by`,",
        "  `where`",
        "FROM",
        "  `from` t",
        "WHERE",
        "  a = ?",
      ].join("\n"),
    );
  });

  test("a doubled backtick escapes; $1 inside is not a placeholder", () => {
    const query = sql`SELECT ${"v"} AS ${q("`a``b $1, FROM c`")} FROM t`;
    assertEquals(query.dialect("mysql"), {
      query: ["SELECT", "  ? AS `a``b $1, FROM c`", "FROM", "  t"].join("\n"),
      parameters: ["v"],
    });
  });
});

describe("SQL Server bracket identifiers are opaque", () => {
  test("[order by] and [select] are not clauses", () => {
    const query = q("SELECT [order by], [select] FROM [where] t")
      .sql`WHERE a = ${1}`.sql`ORDER BY [order by]`;
    assertEquals(
      query.dialect("mssql").query,
      [
        "SELECT",
        "  [order by],",
        "  [select]",
        "FROM",
        "  [where] t",
        "WHERE",
        "  a = @p1",
        "ORDER BY",
        "  [order by]",
      ].join("\n"),
    );
  });
});
