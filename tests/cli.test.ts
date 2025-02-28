import { assertEquals } from "https://deno.land/std@0.221.0/testing/asserts.ts";

Deno.test({
  name: "CLI should parse a query and add conditions",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    // Create a temporary SQL file
    const tempDir = await Deno.makeTempDir();
    const sqlFilePath = `${tempDir}/query.sql`;

    try {
      // Write test SQL to file
      await Deno.writeTextFile(sqlFilePath, "SELECT id, name FROM users");

      // Run CLI command
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "bin/cli.ts",
          "--file",
          sqlFilePath,
          "--where",
          "active = true",
          "--limit",
          "10",
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const { stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout);
      const error = new TextDecoder().decode(stderr);

      // Check for expected output
      const expected = [
        "SELECT",
        "  id, name FROM users",
        "WHERE active = true",
        "LIMIT 10",
      ].join("\n");

      assertEquals(output.trim(), expected);
    } finally {
      // Clean up
      try {
        await Deno.remove(sqlFilePath);
        await Deno.remove(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "CLI should handle direct query parameter",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    // Run CLI command with direct query
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT * FROM products",
        "--where",
        "price > 100",
        "--order-by",
        "name ASC",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    // Check for expected output
    const expected = [
      "SELECT",
      "  * FROM products",
      "WHERE price > 100",
      "ORDER BY name ASC",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle JOIN clauses",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT users.name, orders.amount FROM users",
        "--join",
        "orders ON users.id = orders.user_id",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  users.name, orders.amount FROM users",
      "JOIN orders ON users.id = orders.user_id",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle multiple JOIN types",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT users.*, orders.* FROM users",
        "--left-join",
        "orders ON users.id = orders.user_id",
        "--right-join",
        "user_profiles ON users.id = user_profiles.user_id",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  users.*, orders.* FROM users",
      "LEFT JOIN orders ON users.id = orders.user_id",
      "RIGHT JOIN user_profiles ON users.id = user_profiles.user_id",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle GROUP BY clauses",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT department, COUNT(*) as employee_count FROM employees",
        "--group-by",
        "department",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  department, COUNT(*) as employee_count FROM employees",
      "GROUP BY department",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle combined WHERE conditions with AND",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT * FROM products",
        "--where",
        "price > 50",
        "--and",
        "category = 'electronics'",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  * FROM products",
      "WHERE price > 50",
      "  AND category = 'electronics'",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle combined WHERE conditions with OR",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT * FROM products",
        "--where",
        "price < 20",
        "--or",
        "on_sale = true",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  * FROM products",
      "WHERE price < 20",
      "  OR on_sale = true",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle LIMIT and OFFSET together",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT * FROM logs",
        "--order-by",
        "created_at DESC",
        "--limit",
        "100",
        "--offset",
        "200",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  * FROM logs",
      "ORDER BY created_at DESC",
      "LIMIT 100",
      "OFFSET 200",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle queries with complex multi-line fields",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const tempDir = await Deno.makeTempDir();
    const sqlFilePath = `${tempDir}/complex_query.sql`;

    try {
      // Write test SQL with multi-line fields to file
      await Deno.writeTextFile(
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
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "bin/cli.ts",
          "--file",
          sqlFilePath,
          "--where",
          "active = true",
        ],
        stdout: "piped",
        stderr: "piped",
      });

      const { stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      // The fields should be properly formatted
      const expected = [
        "SELECT",
        "  id,",
        "  first_name,",
        "  last_name,",
        "  CONCAT(first_name, ' ', last_name) as full_name,",
        "  DATE_FORMAT(created_at, '%Y-%m-%d') as joined_date",
        "FROM users",
        "WHERE active = true",
      ].join("\n");

      assertEquals(output.trim(), expected);
    } finally {
      // Clean up
      try {
        await Deno.remove(sqlFilePath);
        await Deno.remove(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});

Deno.test({
  name: "CLI should handle complex INNER JOIN with aliased tables",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "bin/cli.ts",
        "--query",
        "SELECT u.id, u.name, o.order_id, o.amount FROM users u",
        "--inner-join",
        "orders o ON u.id = o.user_id",
        "--where",
        "o.amount > 1000",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  u.id, u.name, o.order_id, o.amount FROM users u",
      "INNER JOIN orders o ON u.id = o.user_id",
      "WHERE o.amount > 1000",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

Deno.test({
  name: "CLI should handle SELECT with multiple complex conditions",
  permissions: {
    read: true,
    write: true,
    run: true,
  },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
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
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout } = await command.output();
    const output = new TextDecoder().decode(stdout);

    const expected = [
      "SELECT",
      "  * FROM products",
      "WHERE category IN ('electronics', 'computers')",
      "  AND price BETWEEN 100 AND 500",
      "  AND inventory_count > 0",
      "ORDER BY price ASC",
    ].join("\n");

    assertEquals(output.trim(), expected);
  },
});

