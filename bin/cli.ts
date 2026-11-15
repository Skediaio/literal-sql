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
    let query = new SQLQuery();
    query.parseInitialQuery(baseQuery);

    // Apply conditions in the order they were provided on the command line
    for (let i = 0; i < argsList.length; i++) {
      const arg = argsList[i];

      // Function to directly append SQL clauses without parameters
      const appendClause = (clause: string, condition: string) => {
        query.parseQuery(`${clause} ${condition}`);
        return query;
      };

      if (arg === "--where" && i + 1 < argsList.length) {
        query = appendClause("WHERE", argsList[++i]);
      } else if (arg === "--and" && i + 1 < argsList.length) {
        query = appendClause("AND", argsList[++i]);
      } else if (arg === "--or" && i + 1 < argsList.length) {
        query = appendClause("OR", argsList[++i]);
      } else if (arg === "--join" && i + 1 < argsList.length) {
        query = appendClause("JOIN", argsList[++i]);
      } else if (arg === "--left-join" && i + 1 < argsList.length) {
        query = appendClause("LEFT JOIN", argsList[++i]);
      } else if (arg === "--right-join" && i + 1 < argsList.length) {
        query = appendClause("RIGHT JOIN", argsList[++i]);
      } else if (arg === "--inner-join" && i + 1 < argsList.length) {
        query = appendClause("INNER JOIN", argsList[++i]);
      } else if (arg === "--group-by" && i + 1 < argsList.length) {
        query = appendClause("GROUP BY", argsList[++i]);
      } else if (arg === "--order-by" && i + 1 < argsList.length) {
        query = appendClause("ORDER BY", argsList[++i]);
      } else if (arg === "--limit" && i + 1 < argsList.length) {
        query = appendClause("LIMIT", argsList[++i]);
      } else if (arg === "--offset" && i + 1 < argsList.length) {
        query = appendClause("OFFSET", argsList[++i]);
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
  --no-format           Disable query formatting
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
