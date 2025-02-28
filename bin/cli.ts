#!/usr/bin/env -S deno run --allow-read

/**
 * Command line interface for the psql-lib SQL Query Builder.
 *
 * This module provides a CLI tool to build and manipulate SQL queries using
 * command line arguments. It allows reading SQL queries from files or direct input
 * and supports adding various SQL clauses such as WHERE, JOIN, ORDER BY, etc.
 *
 * @example
 * ```ts
 * // Read query from a file and add conditions
 * deno run --allow-read bin/cli.ts --file query.sql --where "active = true"
 *
 * // Build a query from scratch
 * deno run --allow-read bin/cli.ts --query "SELECT * FROM users" --limit 10
 * ```
 *
 * @module cli
 */

import { sql, SQLQuery } from "../mod.ts";
import { parseArgs } from "jsr:@std/cli@1.0.13/parse-args";

/**
 * Parses command line arguments and builds an SQL query based on them
 */
async function main() {
  const args = parseArgs(Deno.args, {
    string: [
      "file",
      "query",
      "where",
      "and",
      "or",
      "join",
      "left-join",
      "right-join",
      "inner-join",
      "group-by",
      "order-by",
      "limit",
      "offset",
    ],
    boolean: ["help", "no-format"],
    alias: {
      f: "file",
      q: "query",
      h: "help",
    },
  });

  // Show help if requested or if no file/query provided
  if (args.help || (!args.file && !args.query)) {
    printHelp();
    Deno.exit(0);
  }

  try {
    // Start with base query from file or direct input
    let baseQuery = "";
    if (args.file) {
      try {
        baseQuery = await Deno.readTextFile(args.file);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`Error reading file: ${errorMessage}`);
        Deno.exit(1);
      }
    } else if (args.query) {
      baseQuery = args.query;
    }

    // Initialize the SQL query
    let query = new SQLQuery();
    query.parseInitialQuery(baseQuery);

    // Apply conditions in the order they were provided on the command line
    for (let i = 0; i < Deno.args.length; i++) {
      const arg = Deno.args[i];

      // Function to directly append SQL clauses without parameters
      const appendClause = (clause: string, condition: string) => {
        query.parseQuery(`${clause} ${condition}`);
        return query;
      };

      if (arg === "--where" && i + 1 < Deno.args.length) {
        query = appendClause("WHERE", Deno.args[++i]);
      } else if (arg === "--and" && i + 1 < Deno.args.length) {
        query = appendClause("AND", Deno.args[++i]);
      } else if (arg === "--or" && i + 1 < Deno.args.length) {
        query = appendClause("OR", Deno.args[++i]);
      } else if (arg === "--join" && i + 1 < Deno.args.length) {
        query = appendClause("JOIN", Deno.args[++i]);
      } else if (arg === "--left-join" && i + 1 < Deno.args.length) {
        query = appendClause("LEFT JOIN", Deno.args[++i]);
      } else if (arg === "--right-join" && i + 1 < Deno.args.length) {
        query = appendClause("RIGHT JOIN", Deno.args[++i]);
      } else if (arg === "--inner-join" && i + 1 < Deno.args.length) {
        query = appendClause("INNER JOIN", Deno.args[++i]);
      } else if (arg === "--group-by" && i + 1 < Deno.args.length) {
        query = appendClause("GROUP BY", Deno.args[++i]);
      } else if (arg === "--order-by" && i + 1 < Deno.args.length) {
        query = appendClause("ORDER BY", Deno.args[++i]);
      } else if (arg === "--limit" && i + 1 < Deno.args.length) {
        query = appendClause("LIMIT", Deno.args[++i]);
      } else if (arg === "--offset" && i + 1 < Deno.args.length) {
        query = appendClause("OFFSET", Deno.args[++i]);
      }
    }

    // Output the query
    console.log(query.toString());

    // Output parameters if present and not empty
    if (Object.keys(query.parameters).length > 0) {
      console.log("\nParameters:");
      console.log(JSON.stringify(query.parameters, null, 2));
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    Deno.exit(1);
  }
}

function printHelp() {
  console.log(`
psql-lib CLI - SQL Query Builder

USAGE:
  deno run --allow-read bin/cli.ts [OPTIONS]

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
  deno run --allow-read bin/cli.ts --file query.sql --where "active = true" --and "created_at > '2023-01-01'"

  # Build a query from scratch
  deno run --allow-read bin/cli.ts --query "SELECT * FROM users" --where "id > 100" --order-by "created_at DESC" --limit 10
  `);
}

if (import.meta.main) {
  await main();
}
