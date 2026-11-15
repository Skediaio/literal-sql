#!/usr/bin/env node

/**
 * Command line interface for the Literal SQL Query Builder.
 *
 * This module provides a CLI tool to build and manipulate SQL queries using
 * command line arguments. It allows reading SQL queries from files or direct input
 * and supports adding various SQL clauses such as WHERE, JOIN, ORDER BY, etc.
 *
 * @example
 * ```ts
 * // Read query from a file and add conditions
 * node bin/cli.ts --file query.sql --where "active = true"
 *
 * // Build a query from scratch
 * node bin/cli.ts --query "SELECT * FROM users" --limit 10
 * ```
 *
 * @module cli
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SQLQuery } from "../mod.ts";

/** Clause flags and the SQL keyword each one appends. */
const CLAUSE_FLAGS: Record<string, string> = {
  "--where": "WHERE",
  "--and": "AND",
  "--or": "OR",
  "--join": "JOIN",
  "--left-join": "LEFT JOIN",
  "--right-join": "RIGHT JOIN",
  "--inner-join": "INNER JOIN",
  "--group-by": "GROUP BY",
  "--order-by": "ORDER BY",
  "--limit": "LIMIT",
  "--offset": "OFFSET",
};

/**
 * Builds an SQL query based on provided arguments
 */
export async function buildQuery(argsList: string[]): Promise<SQLQuery> {
  const { values: args } = parseArgs({
    args: argsList,
    options: {
      file: { type: "string", short: "f" },
      query: { type: "string", short: "q" },
      help: { type: "boolean", short: "h" },
    },
    // Clause flags (--where, --and, ...) are walked in order below.
    strict: false,
  });

  // Show help if requested or if no file/query provided
  if (args.help || (!args.file && !args.query)) {
    printHelp();
    process.exit(0);
  }

  try {
    // Start with base query from file or direct input
    let baseQuery = "";
    if (args.file) {
      try {
        baseQuery = readFileSync(String(args.file), "utf8");
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Error reading file: ${errorMessage}`);
        process.exit(1);
      }
    } else if (args.query) {
      baseQuery = String(args.query);
    }

    // Initialize the SQL query
    const query = new SQLQuery();
    query.parseInitialQuery(baseQuery);

    // Apply clauses in the order they were provided on the command line.
    // Both `--where COND` and `--where=COND` are accepted.
    for (let i = 0; i < argsList.length; i++) {
      const eq = argsList[i].indexOf("=");
      const inline = argsList[i].startsWith("--") && eq > 0;
      const clause =
        CLAUSE_FLAGS[inline ? argsList[i].slice(0, eq) : argsList[i]];
      if (!clause) continue;
      if (inline) query.parseQuery(`${clause} ${argsList[i].slice(eq + 1)}`);
      else if (i + 1 < argsList.length) {
        query.parseQuery(`${clause} ${argsList[++i]}`);
      }
    }

    // Return the query
    return query;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    throw error;
  }
}

function printHelp() {
  console.log(`
Literal SQL CLI - SQL Query Builder

USAGE:
  literal-sql [OPTIONS]

OPTIONS:
  -f, --file FILE       Read base SQL query from FILE
  -q, --query QUERY     Specify SQL query directly
  --where CONDITION     Add a WHERE clause
  --and CONDITION       Add an AND condition to the WHERE clause
  --or CONDITION        Add an OR condition to the WHERE clause
  --join TEXT           Add a JOIN clause
  --left-join TEXT      Add a LEFT JOIN clause
  --right-join TEXT     Add a RIGHT JOIN clause
  --inner-join TEXT     Add an INNER JOIN clause
  --group-by EXPR       Add a GROUP BY clause
  --order-by EXPR       Add an ORDER BY clause
  --limit NUMBER        Add a LIMIT clause
  --offset NUMBER       Add an OFFSET clause
  -h, --help            Show this help message

EXAMPLES:
  # Read query from a file and add conditions
  literal-sql --file query.sql --where "active = true" --and "created_at > '2023-01-01'"

  # Build a query from scratch
  literal-sql --query "SELECT * FROM users" --where "id > 100" --order-by "created_at DESC" --limit 10
  `);
}

/**
 * Parses command line arguments and builds an SQL query based on them
 */
async function main() {
  try {
    const query = await buildQuery(process.argv.slice(2));

    // Output the query
    console.log(query.toString());

    // Output parameters if present and not empty
    if (query.parameters.length > 0) {
      console.log("\nParameters:");
      console.log(JSON.stringify(query.parameters, null, 2));
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

// Run only when executed directly (also via the npm bin symlink), not on import.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
