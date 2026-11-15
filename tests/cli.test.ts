import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/** Runs the real CLI binary under the current Node and captures its output. */
function runCli(args: string[]) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("CLI should parse a query and add conditions", async () => {
  // Create a temporary SQL file
  const tempDir = mkdtempSync(join(tmpdir(), "literal-sql-"));
  const sqlFilePath = `${tempDir}/query.sql`;

  try {
    // Write test SQL to file
    writeFileSync(sqlFilePath, "SELECT id, name FROM users");

    // Run CLI command
    const command = runCli([
      "bin/cli.ts",
      "--file",
      sqlFilePath,
      "--where",
      "active = true",
      "--limit",
      "10",
    ]);

    const { stdout } = command;
    const output = stdout;

    // Check for expected output
    const expected = [
      "SELECT",
      "  id,",
      "  name",
      "FROM",
      "  users",
      "WHERE",
      "  active = true",
      "LIMIT 10",
    ].join("\n");

    assertEquals(output.trim(), expected);
  } finally {
    // Clean up
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

test("CLI should handle direct query parameter", async () => {
  // Run CLI command with direct query
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT * FROM products",
    "--where",
    "price > 100",
    "--order-by",
    "name ASC",
  ]);

  const { stdout } = command;
  const output = stdout;

  // Check for expected output
  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  products",
    "WHERE",
    "  price > 100",
    "ORDER BY",
    "  name ASC",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle JOIN clauses", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT users.name, orders.amount FROM users",
    "--join",
    "orders ON users.id = orders.user_id",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  users.name,",
    "  orders.amount",
    "FROM",
    "  users",
    "JOIN",
    "  orders ON users.id = orders.user_id",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle multiple JOIN types", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT users.*, orders.* FROM users",
    "--left-join",
    "orders ON users.id = orders.user_id",
    "--right-join",
    "user_profiles ON users.id = user_profiles.user_id",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  users.*,",
    "  orders.*",
    "FROM",
    "  users",
    "LEFT JOIN",
    "  orders ON users.id = orders.user_id",
    "RIGHT JOIN",
    "  user_profiles ON users.id = user_profiles.user_id",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle GROUP BY clauses", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT department, COUNT(*) as employee_count FROM employees",
    "--group-by",
    "department",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  department,",
    "  COUNT(*) as employee_count",
    "FROM",
    "  employees",
    "GROUP BY",
    "  department",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle combined WHERE conditions with AND", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT * FROM products",
    "--where",
    "price > 50",
    "--and",
    "category = 'electronics'",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  products",
    "WHERE",
    "  price > 50",
    "AND",
    "  category = 'electronics'",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle combined WHERE conditions with OR", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT * FROM products",
    "--where",
    "price < 20",
    "--or",
    "on_sale = true",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  products",
    "WHERE",
    "  price < 20",
    "OR",
    "  on_sale = true",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle LIMIT and OFFSET together", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT * FROM logs",
    "--order-by",
    "created_at DESC",
    "--limit",
    "100",
    "--offset",
    "200",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  logs",
    "ORDER BY",
    "  created_at DESC",
    "LIMIT 100",
    "OFFSET 200",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle queries with complex multi-line fields", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "literal-sql-"));
  const sqlFilePath = `${tempDir}/complex_query.sql`;

  try {
    // Write test SQL with multi-line fields to file
    writeFileSync(
      sqlFilePath,
      `
      SELECT 
        id,
        first_name,
        last_name,
        CONCAT(first_name, ' ', last_name) as full_name,
        DATE_FORMAT(created_at, '%Y-%m-%d') as joined_date
      FROM users
      `,
    );

    // Run CLI command
    const command = runCli([
      "bin/cli.ts",
      "--file",
      sqlFilePath,
      "--where",
      "active = true",
    ]);

    const { stdout } = command;
    const output = stdout;

    // The fields should be properly formatted
    const expected = [
      "SELECT",
      "  id,",
      "  first_name,",
      "  last_name,",
      "  CONCAT(",
      "    first_name,",
      "    ' ',",
      "    last_name",
      "  ) as full_name,",
      "  DATE_FORMAT(",
      "    created_at,",
      "    '%Y-%m-%d'",
      "  ) as joined_date",
      "FROM",
      "  users",
      "WHERE",
      "  active = true",
    ].join("\n");

    assertEquals(output.trim(), expected);
  } finally {
    // Clean up
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

test("CLI should handle complex INNER JOIN with aliased tables", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT u.id, u.name, o.order_id, o.amount FROM users u",
    "--inner-join",
    "orders o ON u.id = o.user_id",
    "--where",
    "o.amount > 1000",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  u.id,",
    "  u.name,",
    "  o.order_id,",
    "  o.amount",
    "FROM",
    "  users u",
    "INNER JOIN",
    "  orders o ON u.id = o.user_id",
    "WHERE",
    "  o.amount > 1000",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle SELECT with multiple complex conditions", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT * FROM products",
    "--where",
    "category IN ('electronics', 'computers')",
    "--and",
    "price BETWEEN 100 AND 500",
    "--and",
    "inventory_count > 0",
    "--order-by",
    "price ASC",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  products",
    "WHERE",
    "  category IN ('electronics', 'computers')",
    "AND",
    "  price BETWEEN 100 AND 500",
    "AND",
    "  inventory_count > 0",
    "ORDER BY",
    "  price ASC",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI should handle LEFT and RIGHT JOIN flags", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "SELECT * FROM a",
    "--left-join",
    "b ON a.id = b.a_id",
    "--right-join",
    "c ON b.id = c.b_id",
  ]);

  const { stdout } = command;
  const output = stdout;

  const expected = [
    "SELECT",
    "  *",
    "FROM",
    "  a",
    "LEFT JOIN",
    "  b ON a.id = b.a_id",
    "RIGHT JOIN",
    "  c ON b.id = c.b_id",
  ].join("\n");

  assertEquals(output.trim(), expected);
});

test("CLI --help prints usage and exits successfully", async () => {
  const command = runCli(["bin/cli.ts", "--help"]);

  const { code, stdout } = command;
  const output = stdout;

  assertEquals(code, 0);
  assertEquals(output.includes("USAGE:"), true);
  assertEquals(output.includes("--where CONDITION"), true);
});

test("CLI with no query and no file prints help", async () => {
  const command = runCli(["bin/cli.ts"]);

  const { code, stdout } = command;
  const output = stdout;

  assertEquals(code, 0);
  assertEquals(output.includes("USAGE:"), true);
});

test("CLI reports an error and exits 1 for a missing file", async () => {
  const command = runCli(["bin/cli.ts", "--file", "/nonexistent/query.sql"]);

  const { code, stderr } = command;
  const errorOutput = stderr;

  assertEquals(code, 1);
  assertEquals(errorOutput.includes("Error reading file"), true);
});

test("CLI passes a DML query through raw with appended RETURNING", async () => {
  const command = runCli([
    "bin/cli.ts",
    "--query",
    "DELETE FROM users",
    "--where",
    "id = 1",
  ]);

  const { stdout } = command;
  const output = stdout;

  // DML is raw passthrough; the appended clause attaches verbatim below.
  const expected = ["DELETE FROM users", "WHERE id = 1"].join("\n");

  assertEquals(output.trim(), expected);
});
