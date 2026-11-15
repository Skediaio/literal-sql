/**
 * Robustness tests: properties, fuzzing, injection resistance, immutability,
 * and a "Known bugs" suite.
 *
 * Tests in the "Known bugs" describe block FAIL on purpose against the current
 * implementation. Each one pins a real defect (wrong, broken or silently
 * changed SQL). They are left failing so the fix can be proven by turning
 * them green.
 *
 * Most assertions use `norm()`: the formatter only inserts or changes
 * whitespace and keyword case, so a correct output must be equal to its input
 * after whitespace is collapsed and everything is uppercased. That catches
 * dropped, duplicated, reordered or split tokens without pinning layout.
 */

import {
  deepStrictEqual as assertEquals,
  doesNotThrow,
  ok,
} from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { type SQLQuery, sql } from "../mod.ts";

/** Whitespace-, case- and paren-spacing-insensitive form of a SQL string. */
function norm(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+,/g, ",")
    .trim()
    .toUpperCase();
}

/** Builds an SQLQuery from a plain string (no interpolated values). */
function q(text: string): SQLQuery {
  return sql(Object.assign([text], { raw: [text] }) as TemplateStringsArray);
}

/** Deterministic PRNG so fuzz failures are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** All `$N` placeholders in order of appearance. */
function placeholders(text: string): number[] {
  return [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
}

// --- Formatter preserves meaning on supported SELECT shapes ---

describe("Formatter preserves every token of supported SELECTs", () => {
  const corpus = [
    "SELECT * FROM users",
    "SELECT id, name, email FROM users WHERE active = true",
    "SELECT u.id, count(o.id) AS n FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id HAVING count(o.id) > 1 ORDER BY n DESC LIMIT 10 OFFSET 5",
    "SELECT * FROM t WHERE a = 1 AND b = 2 OR c = 3",
    "SELECT * FROM t WHERE (a = 1 OR b = 2) AND c = 3",
    "SELECT * FROM t WHERE x BETWEEN 1 AND 5 AND y = 2",
    "SELECT * FROM t WHERE x NOT BETWEEN 1 AND 5",
    "SELECT * FROM t WHERE id IN (SELECT id FROM u WHERE z = 1 AND w = 2)",
    "SELECT * FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.t_id = t.id)",
    "SELECT * FROM t WHERE name = 'a AND b' AND note = 'x, y'",
    "SELECT * FROM t WHERE name = 'it''s' AND id = 1",
    "SELECT row_number() OVER (PARTITION BY a ORDER BY b) AS rn FROM t",
    "SELECT sum(amount) OVER (ORDER BY created_at) AS running FROM payments",
    "SELECT CASE WHEN a > 1 THEN 'big' ELSE 'small' END AS size FROM t",
    "SELECT extract(YEAR FROM created_at) AS y FROM t",
    "SELECT DISTINCT a, b FROM t",
    "SELECT DISTINCT ON (a) a, b FROM t ORDER BY a, b DESC",
    "SELECT a FROM t1 CROSS JOIN t2",
    "SELECT a FROM t1 INNER JOIN t2 ON t2.id = t1.id AND t2.x = 1 RIGHT JOIN t3 ON t3.id = t2.id",
    "SELECT a FROM t1 FULL OUTER JOIN t2 ON t2.id = t1.id",
    "SELECT a FROM t1 JOIN t2 USING (id)",
    "SELECT data->>'key' AS k FROM docs WHERE data ? 'key'",
    "SELECT id::text FROM t WHERE created_at > now() - interval '1 day'",
    "SELECT coalesce(nickname, name) AS display FROM users",
    "SELECT * FROM schema1.table1 AS a WHERE a.id = 1",
    "select a from t where x = 1 and y = 2 order by a limit 3",
    "SELECT * FROM t WHERE ordered = true AND android = 1",
    "SELECT * FROM t WHERE vendor_id = 1",
  ];
  for (const text of corpus) {
    test(text, () => {
      assertEquals(norm(q(text).toString()), norm(text));
    });
  }
});

describe("Raw passthrough returns the statement verbatim", () => {
  const corpus = [
    "INSERT INTO t (a, b) VALUES (1, 'x') RETURNING id",
    "UPDATE t SET a = 1, b = 2 WHERE id = 3 RETURNING *",
    "DELETE FROM t WHERE id = 1",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT n FROM r",
    "SELECT a FROM t1 UNION SELECT a FROM t2",
    "SELECT a FROM t1 INTERSECT SELECT a FROM t2",
    "SELECT a FROM t1 EXCEPT SELECT a FROM t2",
    "INSERT INTO t (a)\n  SELECT a FROM u\n  WHERE x = 1",
  ];
  for (const text of corpus) {
    test(text.replace(/\n/g, " "), () => {
      assertEquals(q(text).toString(), text);
      assertEquals(q(`  \n${text}\n  `).toString(), text);
    });
  }
});

// --- Parameters ---

describe("Parameters", () => {
  test("every JS value type except undefined becomes exactly one parameter", () => {
    const date = new Date(0);
    const obj = { a: 1 };
    const arr = [1, 2];
    const big = 10n;
    const values = [0, -1, 1.5, Number.NaN, "", "x", true, false, null, date];
    const all = [...values, obj, arr, big];
    const query = sql`SELECT ${all[0]}, ${all[1]}, ${all[2]}, ${all[3]}, ${all[4]}, ${all[5]}, ${all[6]}, ${all[7]}, ${all[8]}, ${all[9]}, ${all[10]}, ${all[11]}, ${all[12]}`;
    assertEquals(query.parameters, all);
    ok(query.parameters[10] === obj, "objects are passed by reference");
    assertEquals(
      placeholders(query.toString()),
      all.map((_, i) => i + 1),
    );
  });

  test("undefined becomes the NULL literal and consumes no number", () => {
    const query = sql`SELECT * FROM t WHERE a = ${1} AND b = ${undefined} AND c = ${2}`;
    ok(query.toString().includes("b = NULL"));
    ok(query.toString().includes("c = $2"));
    assertEquals(query.parameters, [1, 2]);
  });

  test("trailing null parameter is kept (it is a real value)", () => {
    assertEquals(sql`SELECT ${1}, ${null}`.parameters, [1, null]);
  });

  test("parameters getter returns a fresh array each call", () => {
    const query = sql`SELECT * FROM t WHERE id = ${1}`;
    query.parameters.push(99);
    assertEquals(query.parameters, [1]);
  });

  test("toString is idempotent", () => {
    const query = sql`SELECT a FROM t WHERE x = ${1}`.sql`ORDER BY a`;
    assertEquals(query.toString(), query.toString());
    assertEquals(query.query, query.toString());
  });

  test("fuzz: long .sql chains keep $N aligned with their values", () => {
    const rand = rng(42);
    for (let run = 0; run < 200; run++) {
      let query = sql`SELECT * FROM t WHERE id = ${"v0"}`;
      const expected: unknown[] = ["v0"];
      const steps = 1 + Math.floor(rand() * 15);
      for (let s = 0; s < steps; s++) {
        const v = `v${expected.length}`;
        if (rand() < 0.5) {
          query = query.sql`AND c = ${v}`;
        } else {
          query = query.sql`OR c = ${v}`;
        }
        expected.push(v);
      }
      assertEquals(query.parameters, expected);
      assertEquals(
        placeholders(query.toString()),
        expected.map((_, i) => i + 1),
      );
    }
  });

  test("fuzz: arbitrarily nested fragments flatten in source order", () => {
    const rand = rng(7);
    let counter = 0;
    // Returns a fragment and the values it should contribute, in order.
    const build = (depth: number): [SQLQuery, unknown[]] => {
      const v1 = `p${counter++}`;
      if (depth === 0 || rand() < 0.3) {
        return [sql`x = ${v1}`, [v1]];
      }
      const [left, lv] = build(depth - 1);
      const v2 = `p${counter++}`;
      const [right, rv] = build(depth - 1);
      return [
        sql`(${left} AND y = ${v1} OR ${right} AND z = ${v2})`,
        [...lv, v1, ...rv, v2],
      ];
    };
    for (let run = 0; run < 100; run++) {
      counter = 0;
      const [frag, values] = build(4);
      const query = sql`SELECT * FROM t WHERE id > 0 AND ${frag}`;
      assertEquals(query.parameters, values);
      assertEquals(
        placeholders(query.toString()),
        values.map((_, i) => i + 1),
      );
    }
  });

  test("50-level deep nesting renumbers correctly", () => {
    let frag = sql`a = ${0}`;
    for (let i = 1; i < 50; i++) frag = sql`(${frag} AND b = ${i})`;
    const query = sql`SELECT * FROM t WHERE id > 0 AND ${frag}`;
    const params = query.parameters;
    assertEquals(
      params,
      Array.from({ length: 50 }, (_, i) => i),
    );
    assertEquals(
      placeholders(query.toString()),
      params.map((_, i) => i + 1),
    );
  });

  test("a nested fragment is not mutated by being inlined", () => {
    const frag = sql`status = ${"active"}`;
    const before = frag.toString();
    sql`SELECT * FROM a WHERE id = ${1} AND ${frag}`;
    sql`SELECT * FROM b WHERE x = ${1} AND y = ${2} AND ${frag}`;
    assertEquals(frag.toString(), before);
    assertEquals(frag.parameters, ["active"]);
  });
});

// --- Injection resistance ---

describe("Injection resistance", () => {
  const hostile: unknown[] = [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "1) OR (1=1",
    "$1",
    "$999",
    "-- comment",
    "/* block */",
    "\u0000",
    "S0",
    "\\'; SELECT pg_sleep(10); --",
    "x\nWHERE 1=1",
    "UNION SELECT password FROM users",
    "RETURNING *",
    { toString: () => "'; DROP TABLE x; --" },
  ];

  for (const [i, value] of hostile.entries()) {
    test(`hostile value #${i} never reaches the SQL text`, () => {
      const variants = [
        sql`SELECT * FROM t WHERE a = ${value}`,
        sql`SELECT * FROM t`.sql`WHERE a = ${value}`,
        sql`SELECT * FROM t WHERE ${sql`a = ${value}`}`,
        sql`UPDATE t SET a = ${value} WHERE id = ${1}`,
        sql`SELECT * FROM t`.sql`ORDER BY ${value}`,
        sql`SELECT * FROM t`.sql`LIMIT ${value}`,
      ];
      for (const v of variants) {
        const text = v.toString();
        ok(!text.includes(String(value)) || String(value) === "$1", text);
        ok(v.parameters.includes(value), "value must be a parameter");
        // Structure must not change: no injected clause keywords.
        ok(!/DROP|UNION|pg_sleep|1=1/.test(text), text);
      }
    });
  }

  test("parameter count always equals distinct placeholders", () => {
    for (const value of hostile) {
      const query = sql`SELECT * FROM t WHERE a = ${value} AND b = ${value}`;
      assertEquals(query.parameters.length, 2);
      assertEquals(placeholders(query.toString()), [1, 2]);
    }
  });
});

// --- Immutability ---

describe("Immutability", () => {
  test("branching from one base never leaks between branches", () => {
    const base = sql`SELECT * FROM t WHERE tenant = ${1}`;
    const baseText = base.toString();
    const a = base.sql`AND a = ${"A"}`.sql`ORDER BY a`;
    const b = base.sql`AND b = ${"B"}`.sql`LIMIT ${5}`;
    assertEquals(base.toString(), baseText);
    assertEquals(base.parameters, [1]);
    assertEquals(a.parameters, [1, "A"]);
    assertEquals(b.parameters, [1, "B", 5]);
    ok(!a.toString().includes("LIMIT"));
    ok(!b.toString().includes("ORDER BY"));
    ok(!a.toString().includes("b = "));
  });

  test("passthrough branches do not share rawQuery", () => {
    const base = sql`DELETE FROM t WHERE id = ${1}`;
    const a = base.sql`RETURNING id`;
    const b = base.sql`RETURNING *`;
    assertEquals(base.toString(), "DELETE FROM t WHERE id = $1");
    assertEquals(a.toString(), "DELETE FROM t WHERE id = $1\nRETURNING id");
    assertEquals(b.toString(), "DELETE FROM t WHERE id = $1\nRETURNING *");
  });

  test("mutating a parameter object after building is visible (by-reference, documented)", () => {
    const filter = { a: 1 };
    const query = sql`SELECT * FROM t WHERE data @> ${filter}`;
    filter.a = 2;
    assertEquals(query.parameters, [{ a: 2 }]);
  });
});

// --- Comments ---

describe("Comment stripping", () => {
  test("-- inside a string literal is kept, real comments dropped", () => {
    const query = sql`SELECT * FROM t -- trailing
      WHERE note = '-- not a comment' -- another
      AND id = ${1}`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE note = '-- not a comment' AND id = $1"),
    );
  });

  test("comment in an appended fragment cannot swallow later clauses", () => {
    const query = sql`SELECT * FROM t`.sql`WHERE a = 1 -- note`.sql`ORDER BY a`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE a = 1 ORDER BY a"),
    );
  });
});

// --- Performance ---

describe("Performance", () => {
  test("5000 appended AND conditions build and format quickly", () => {
    const start = performance.now();
    let query = sql`SELECT * FROM t WHERE id > ${0}`;
    for (let i = 0; i < 5000; i++) query = query.sql`AND c = ${i}`;
    const text = query.toString();
    const ms = performance.now() - start;
    assertEquals(query.parameters.length, 5001);
    ok(text.includes("$5001"));
    ok(ms < 10_000, `took ${ms.toFixed(0)} ms`);
  });

  test("IN list of 1000 fragments builds quickly", () => {
    const start = performance.now();
    const ids = Array.from({ length: 1000 }, (_, i) => i);
    const list = ids
      .map((id) => sql`${id}`)
      .reduce((acc, f) => sql`${acc}, ${f}`);
    const query = sql`SELECT * FROM t WHERE id IN (${list})`;
    const text = query.toString();
    const ms = performance.now() - start;
    assertEquals(query.parameters, ids);
    ok(text.includes("$1000)"));
    ok(ms < 2_000, `took ${ms.toFixed(0)} ms`);
  });
});

// --- Guards for parser fixes ---

describe("Guards for parser fixes", () => {
  const base = sql`SELECT * FROM t WHERE id = ${1}`;
  for (const cond of [
    "order_id = 2",
    "selected = true",
    "limit_x = 3",
    "android = 1",
  ]) {
    test(`bare condition '${cond}' is not mistaken for a keyword`, () => {
      const out = base.sql(
        Object.assign([cond], { raw: [cond] }) as TemplateStringsArray,
      );
      assertEquals(
        norm(out.toString()),
        norm(`SELECT * FROM t WHERE id = $1 AND ${cond}`),
      );
    });
  }

  test("'/*' inside a line comment does not open a block comment", () => {
    const query = q("SELECT a FROM t -- note /* not open\nWHERE x = 1");
    assertEquals(norm(query.toString()), norm("SELECT a FROM t WHERE x = 1"));
  });

  test("comment markers and ';' inside strings are kept", () => {
    for (const text of [
      "SELECT a FROM t WHERE s = 'a;'",
      "SELECT a FROM t WHERE s = 'x /* y */ -- z'",
    ]) {
      assertEquals(norm(q(text).toString()), norm(text));
    }
  });

  test("already parenthesised OR is not wrapped twice", () => {
    const query = q("SELECT * FROM t WHERE (a OR b)").sql`WHERE c`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE (a OR b) AND c"),
    );
  });

  test("existing top-level OR is wrapped when the builder adds AND", () => {
    const query = q("SELECT * FROM t WHERE public OR owner = 1")
      .sql`WHERE tenant = ${2}`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE (public OR owner = 1) AND tenant = $1"),
    );
  });

  test("explicit .sql`AND ...` is kept as written", () => {
    const query = q("SELECT * FROM t WHERE a OR b").sql`AND c`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE a OR b AND c"),
    );
  });
});

// --- Known bugs (these FAIL until fixed) ---

describe("Known bugs", () => {
  // maskParenGroups blanks paren content, then the `[1].trim()` emptiness
  // check sees nothing and the whole clause is DROPPED. A WHERE (...) filter
  // vanishing means the query returns every row; params are still sent.
  describe("clause whose content is fully parenthesised is dropped", () => {
    const cases = [
      "SELECT * FROM t WHERE (a = 1 OR b = 2)",
      "SELECT * FROM t WHERE (tenant_id = $1)",
      "SELECT (a) FROM t",
      "SELECT * FROM t ORDER BY (a)",
      "SELECT * FROM t LIMIT (5)",
      "SELECT a FROM t GROUP BY a HAVING (count(*) > 1)",
    ];
    for (const text of cases) {
      test(text, () => assertEquals(norm(q(text).toString()), norm(text)));
    }

    test("nested parenthesised fragment: WHERE vanishes, params remain", () => {
      const filter = sql`(owner = ${1} OR public = ${true})`;
      const query = sql`SELECT * FROM docs WHERE ${filter}`;
      ok(/WHERE/.test(query.toString()), query.toString());
    });
  });

  test("perf: building a 10000-item IN list is quadratic", () => {
    const start = performance.now();
    const ids = Array.from({ length: 10_000 }, (_, i) => i);
    const list = ids
      .map((id) => sql`${id}`)
      .reduce((acc, f) => sql`${acc}, ${f}`);
    const query = sql`SELECT * FROM t WHERE id IN (${list})`;
    query.toString();
    const ms = performance.now() - start;
    ok(ms < 3_000, `took ${ms.toFixed(0)} ms`);
  });

  // splitConditions matches AND/OR without a left word boundary, so any
  // identifier ending in "and"/"or" is cut in two and the SQL breaks.
  describe("identifiers ending in 'and' / 'or' are split", () => {
    const cases = [
      "SELECT * FROM t WHERE color = $1",
      "SELECT * FROM t WHERE author_name = 'x' OR major = 1",
      "SELECT * FROM t WHERE floor(x) > 1 AND y = 2",
      "SELECT * FROM t WHERE x BETWEEN 1 AND 5 AND color = 'r'",
      "SELECT * FROM a JOIN b ON b.brand = a.brand",
      "SELECT flavor FROM t GROUP BY flavor HAVING flavor <> 'x'",
      "SELECT * FROM t WHERE id = 1 FOR UPDATE",
    ];
    for (const text of cases) {
      test(text, () => assertEquals(norm(q(text).toString()), norm(text)));
    }

    test("a real AND after 'vendor' is silently DROPPED", () => {
      const text = "SELECT * FROM a JOIN v ON v.vendor = a.vendor AND v.x = 1";
      const out = q(text).toString();
      ok(/\bAND\b/i.test(out), `AND lost:\n${out}`);
      assertEquals(norm(out), norm(text));
    });
  });

  // maskParenGroups skips parens inside strings but does NOT hide the
  // string's content, so clause keywords inside literals split clauses.
  describe("clause keywords inside string literals", () => {
    const cases = [
      "SELECT * FROM t WHERE note = 'see ORDER BY x' AND id = 1",
      "SELECT * FROM t WHERE msg = 'no limit here'",
      "SELECT * FROM t WHERE name = 'left join me'",
      "SELECT * FROM t WHERE label = 'group by me' AND id = 2",
    ];
    for (const text of cases) {
      test(text, () => {
        const out = q(text).sql`AND zz = 1`.toString();
        assertEquals(
          norm(out),
          norm(`${text} ${/WHERE/.test(text) ? "AND" : "WHERE"} zz = 1`),
        );
      });
    }

    test("'returning' inside a string makes a SELECT throw", () => {
      doesNotThrow(() =>
        sql`SELECT * FROM t WHERE note = 'returning soon'`.toString(),
      );
    });
  });

  // parseQuery matches "where " / "order by " etc. with a literal space, so a
  // newline or tab after the keyword falls through to the WHERE default.
  describe("appended keyword followed by newline or tab", () => {
    test("WHERE + newline", () => {
      const query = sql`SELECT * FROM t`.sql`WHERE
        id = ${1}`;
      assertEquals(
        norm(query.toString()),
        norm("SELECT * FROM t WHERE id = $1"),
      );
    });

    test("ORDER BY + tab", () => {
      const query = sql`SELECT * FROM t`.sql`ORDER BY\tid`;
      assertEquals(norm(query.toString()), norm("SELECT * FROM t ORDER BY id"));
    });

    test("LIMIT + newline", () => {
      const query = sql`SELECT * FROM t`.sql`LIMIT
        ${10}`;
      assertEquals(norm(query.toString()), norm("SELECT * FROM t LIMIT $1"));
    });
  });

  test("ORDER and BY on separate lines: appended WHERE lands after ORDER BY", () => {
    const query = q("SELECT * FROM t ORDER\nBY id").sql`WHERE x = 1`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE x = 1 ORDER BY id"),
    );
  });

  test("GROUP  BY with two spaces: appended WHERE lands after GROUP BY", () => {
    const query = q("SELECT a FROM t GROUP  BY a").sql`WHERE x = 1`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT a FROM t WHERE x = 1 GROUP BY a"),
    );
  });

  test("appended LEFT OUTER JOIN is treated as a WHERE condition", () => {
    const query = sql`SELECT * FROM a`.sql`LEFT OUTER JOIN b ON b.id = a.id`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM a LEFT OUTER JOIN b ON b.id = a.id"),
    );
  });

  test("appended RIGHT OUTER JOIN is treated as a WHERE condition", () => {
    const query = sql`SELECT * FROM a`.sql`RIGHT OUTER JOIN b ON b.id = a.id`;
    ok(!/WHERE/.test(query.toString()), query.toString());
  });

  // The builder inserts AND itself, but does not parenthesise, so an OR in
  // either side escapes the filter (e.g. a tenant check).
  describe("auto-inserted AND does not respect OR precedence", () => {
    test("second WHERE with OR escapes the first filter", () => {
      const query = sql`SELECT * FROM docs WHERE tenant = ${1}`
        .sql`WHERE a = 1 OR b = 2`;
      ok(norm(query.toString()).includes("(A = 1 OR B = 2)"), query.toString());
    });

    test("bare fragment with OR escapes the first filter", () => {
      const query = sql`SELECT * FROM docs WHERE tenant = ${1}`
        .sql`a = 1 OR b = 2`;
      ok(norm(query.toString()).includes("(A = 1 OR B = 2)"), query.toString());
    });

    test("second HAVING with OR escapes the first HAVING", () => {
      const query = q("SELECT a FROM t GROUP BY a HAVING count(*) > 1")
        .sql`HAVING sum(x) > 1 OR min(x) < 0`;
      ok(
        norm(query.toString()).includes("(SUM(X) > 1 OR MIN(X) < 0)"),
        query.toString(),
      );
    });
  });

  test("multi-clause fragment: later AND is glued after ORDER BY", () => {
    const query = sql`SELECT * FROM t`.sql`WHERE a = 1 ORDER BY b`
      .sql`AND c = 2`;
    assertEquals(
      norm(query.toString()),
      norm("SELECT * FROM t WHERE a = 1 AND c = 2 ORDER BY b"),
    );
  });

  test("OFFSET before LIMIT (valid Postgres) duplicates LIMIT", () => {
    const out = q("SELECT * FROM t OFFSET 5 LIMIT 10").toString();
    assertEquals(out.match(/LIMIT/g)?.length, 1, out);
  });

  test("block comment containing -- truncates the whole query", () => {
    const out = sql`SELECT a /* -- note */ FROM t WHERE id = ${1}`.toString();
    ok(norm(out).includes("FROM T"), out);
    ok(norm(out).includes("WHERE ID = $1"), out);
  });

  test("outer JOIN identical to one inside a subquery is silently dropped", () => {
    const text =
      "SELECT * FROM x LEFT JOIN (SELECT * FROM x JOIN y ON y.id = x.id) s ON true JOIN y ON y.id = x.id";
    assertEquals(norm(q(text).toString()), norm(text));
  });

  test("trailing semicolon: appended WHERE lands after the ';'", () => {
    const out = q("SELECT * FROM t;").sql`WHERE x = 1`.toString();
    ok(!/;[\s\S]*\S/.test(out), out);
  });

  test("trailing semicolon: appended RETURNING on DML lands after the ';'", () => {
    const out = sql`DELETE FROM t WHERE id = ${1};`
      .sql`RETURNING id`.toString();
    ok(!/;[\s\S]*\S/.test(out), out);
  });

  test("parenthesised SELECT is replaced by 'SELECT *'", () => {
    const out = q("(SELECT a FROM t)").toString();
    ok(norm(out).includes("SELECT A FROM T"), out);
  });

  test("VALUES statement gets a SELECT prefix and mangled parens", () => {
    const text = "VALUES (1), (2)";
    assertEquals(norm(q(text).toString()), norm(text));
  });

  test("MERGE (Postgres 15+ DML) is prefixed with SELECT", () => {
    const text =
      "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = s.x";
    assertEquals(q(text).toString(), text);
  });

  test("appended SELECT list ends up in WHERE", () => {
    const out = q("FROM t").sql`SELECT a`.toString();
    ok(!/WHERE/.test(out), out);
  });

  describe("CLI", () => {
    const run = (args: string[]) =>
      spawnSync(process.execPath, ["bin/cli.ts", ...args], {
        encoding: "utf8",
      });

    test("--help lists no unimplemented flag (--no-format did nothing)", () => {
      const r = run(["--help"]);
      ok(!r.stdout.includes("--no-format"), r.stdout);
    });

    test("--where=COND (accepted by parseArgs) is silently ignored", () => {
      const r = run(["--query", "SELECT a FROM t", "--where=active = true"]);
      ok(r.stdout.includes("active = true"), r.stdout);
    });
  });
});
