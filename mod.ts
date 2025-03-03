/**
 * A lightweight, raw SQL query builder that prioritizes SQL development through template literals, rather than abstracting SQL behind programming language constructs like traditional query builders.
 *
 * This module provides tools for building SQL queries safely and incrementally.
 * It handles parameter interpolation automatically and helps prevent SQL injection.
 *
 * @example
 * ```ts
 * import { sql } from "jsr:@skedia/literal-sql";
 *
 * // Basic query with parameters (will use $1 for PostgreSQL compatibility)
 * const userId = 123;
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`; // generates: "SELECT * FROM users WHERE id = $1"
 *
 * // Incremental building with conditional clauses
 * let baseQuery = sql`SELECT * FROM products`;
 *
 * if (category) {
 *   baseQuery = baseQuery.sql`WHERE category = ${category}`;
 * }
 *
 * if (minPrice) {
 *   baseQuery = baseQuery.sql`AND price >= ${minPrice}`;
 * }
 *
 * console.log(baseQuery.query); // The SQL string with $1, $2, etc. parameters
 * console.log(baseQuery.parameters); // Array of parameter values
 *
 */

interface QueryParts {
  /** SELECT fields */
  select: string[];
  /** FROM table name */
  from: string | null;
  /** JOIN clauses */
  joins: string[];
  /** WHERE conditions */
  where: string[];
  /** GROUP BY expressions */
  groupBy: string[];
  /** ORDER BY expressions */
  orderBy: string[];
  /** LIMIT value */
  limit: string | null;
  /** OFFSET value */
  offset: string | null;
}

/**
 * Internal interface for storing parameters before converting to array
 * @private
 */
interface Params {
  [key: number]: any;
}

/**
 * Represents an SQL query with support for parameterization and incremental building
 */
export class SQLQuery {
  /** The different parts of the SQL query */
  parts: QueryParts;
  /** The parameters for the parameterized query (internal storage) */
  params: Params;
  /** Counter for generating parameter numbers ($1, $2, etc.) */
  paramCounter: number;

  /**
   * Creates a new SQLQuery instance
   *
   * @param strings - Template strings array if created with template literal
   * @param values - Values to be interpolated into the query
   */
  constructor(strings?: TemplateStringsArray, ...values: any[]) {
    this.parts = {
      select: [],
      from: null,
      joins: [],
      where: [],
      groupBy: [],
      orderBy: [],
      limit: null,
      offset: null,
    };

    this.params = {};
    this.paramCounter = 0;

    // Process initial template literal
    if (strings && strings.length > 0) {
      const fullQuery = this._interpolate(strings, values);
      this.parseInitialQuery(fullQuery);
    }
  }

  /**
   * Interpolates values into the template strings and handles parameterization
   *
   * @param strings - Template strings array
   * @param values - Values to be interpolated
   * @returns The interpolated query string with parameters
   * @private
   */
  private _interpolate(strings: TemplateStringsArray, values: any[]): string {
    return strings.reduce((result, string, i) => {
      if (i < values.length) {
        const value = values[i];

        // Handle undefined values by replacing with NULL
        if (value === undefined) {
          return result + string + "NULL";
        }

        // Handle parameter values
        if (value !== null && typeof value !== "object") {
          // For primitive values, create a numbered parameter
          this.paramCounter++;
          this.params[this.paramCounter] = value;
          return result + string + `$${this.paramCounter}`;
        } else if (
          value !== null &&
          typeof value === "object" &&
          !(value instanceof SQLQuery)
        ) {
          // Handle parameter objects - convert to numbered parameters
          this.paramCounter++;
          const paramValue = Object.values(value)[0];
          this.params[this.paramCounter] = paramValue;
          return result + string + `$${this.paramCounter}`;
        } else {
          return result + string + value;
        }
      }
      return result + string;
    }, "");
  }

  /**
   * Parses a query fragment and adds it to the appropriate query part
   *
   * @param query - The query fragment to parse
   */
  parseQuery(query: string): void {
    // Identify and classify the SQL fragment
    const trimmedQuery = query.trim();
    const lowerQuery = trimmedQuery.toLowerCase();

    if (lowerQuery.startsWith("select")) {
      // This is a SELECT statement - should not happen in append mode
      this.parseInitialQuery(trimmedQuery);
    } else if (lowerQuery.startsWith("from")) {
      // FROM clause
      this.parts.from = trimmedQuery.substring(4).trim();
    } else if (
      lowerQuery.startsWith("join") ||
      lowerQuery.startsWith("left join") ||
      lowerQuery.startsWith("right join") ||
      lowerQuery.startsWith("inner join")
    ) {
      // JOIN clause
      this.parts.joins.push(trimmedQuery);
    } else if (lowerQuery.startsWith("where")) {
      // WHERE clause
      this.parts.where.push(trimmedQuery.substring(5).trim());
    } else if (lowerQuery.startsWith("and ")) {
      // AND condition
      if (this.parts.where.length > 0) {
        this.parts.where.push("AND " + trimmedQuery.substring(3).trim());
      } else {
        this.parts.where.push(trimmedQuery.substring(3).trim());
      }
    } else if (lowerQuery.startsWith("or ")) {
      // OR condition
      if (this.parts.where.length > 0) {
        this.parts.where.push("OR " + trimmedQuery.substring(2).trim());
      } else {
        this.parts.where.push(trimmedQuery.substring(2).trim());
      }
    } else if (lowerQuery.startsWith("group by")) {
      // GROUP BY clause
      this.parts.groupBy.push(trimmedQuery.substring(8).trim());
    } else if (lowerQuery.startsWith("order by")) {
      // ORDER BY clause
      this.parts.orderBy.push(trimmedQuery.substring(8).trim());
    } else if (lowerQuery.startsWith("limit")) {
      // LIMIT clause
      this.parts.limit = trimmedQuery.substring(5).trim();
    } else if (lowerQuery.startsWith("offset")) {
      // OFFSET clause
      this.parts.offset = trimmedQuery.substring(6).trim();
    } else {
      // If it doesn't match any specific clause, assume it's a WHERE condition
      if (this.parts.where.length > 0) {
        // If we already have WHERE conditions, assume this is an AND condition
        this.parts.where.push(`AND ${trimmedQuery}`);
      } else {
        this.parts.where.push(trimmedQuery);
      }
    }
  }

  /**
   * Parses a complete SQL query and initializes the query parts
   *
   * @param query - The complete SQL query to parse
   */
  parseInitialQuery(query: string): void {
    const lines = query
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);

    let currentSection: string | null = null;

    for (const line of lines) {
      const lowerLine = line.toLowerCase();

      if (lowerLine.startsWith("select")) {
        currentSection = "select";
        // Extract all fields after SELECT
        const fieldsText = line.substring(6).trim();
        // Only add if there's content after SELECT
        if (fieldsText) {
          this.parts.select = [fieldsText];
        } else {
          this.parts.select = [];
        }
      } else if (lowerLine.startsWith("from")) {
        currentSection = "from";
        this.parts.from = line.substring(4).trim();
      } else if (
        lowerLine.startsWith("join") ||
        lowerLine.startsWith("left join") ||
        lowerLine.startsWith("right join") ||
        lowerLine.startsWith("inner join")
      ) {
        currentSection = "joins";
        this.parts.joins.push(line);
      } else if (lowerLine.startsWith("where")) {
        currentSection = "where";
        this.parts.where.push(line.substring(5).trim());
      } else if (lowerLine.startsWith("group by")) {
        currentSection = "groupBy";
        this.parts.groupBy.push(line.substring(8).trim());
      } else if (lowerLine.startsWith("order by")) {
        currentSection = "orderBy";
        this.parts.orderBy.push(line.substring(8).trim());
      } else if (lowerLine.startsWith("limit")) {
        this.parts.limit = line.substring(5).trim();
      } else if (lowerLine.startsWith("offset")) {
        this.parts.offset = line.substring(6).trim();
      } else if (currentSection) {
        // Continuation of previous section
        if (currentSection === "select") {
          // Remove any empty or just-comma lines
          if (line !== "," && !line.match(/^\s*,\s*$/)) {
            // Clean up any leading commas
            const cleanedLine = line.replace(/^,\s*/, "");
            // Clean up any trailing commas
            const finalLine = cleanedLine.replace(/,\s*$/, "");
            if (finalLine) {
              this.parts.select.push(finalLine);
            }
          }
        } else if (currentSection === "where") {
          this.parts.where.push(line);
        } else if (currentSection === "groupBy") {
          this.parts.groupBy.push(line);
        } else if (currentSection === "orderBy") {
          this.parts.orderBy.push(line);
        }
      }
    }
  }

  /**
   * Converts the query object to a formatted SQL string
   *
   * @returns The formatted SQL query string
   */
  toString(): string {
    const parts: string[] = [];

    // SELECT
    if (this.parts.select.length > 0) {
      parts.push(`SELECT\n  ${this.parts.select.join(",\n  ")}`);
    } else {
      parts.push("SELECT *");
    }

    // FROM
    if (this.parts.from) {
      parts.push(`FROM ${this.parts.from}`);
    }

    // JOINs
    if (this.parts.joins.length > 0) {
      parts.push(this.parts.joins.join("\n"));
    }

    // WHERE
    if (this.parts.where.length > 0) {
      parts.push(`WHERE ${this.parts.where.join("\n  ")}`);
    }

    // GROUP BY
    if (this.parts.groupBy.length > 0) {
      // Filter out any undefined or empty strings
      const validGroupBy = this.parts.groupBy.filter(
        (part) => part && !part.includes(":undefined") && part !== ",",
      );
      if (validGroupBy.length > 0) {
        parts.push(`GROUP BY ${validGroupBy.join(", ")}`);
      }
    }

    // ORDER BY
    if (this.parts.orderBy.length > 0) {
      // Filter out any undefined or empty strings
      const validOrderBy = this.parts.orderBy.filter(
        (part) => part && !part.includes(":undefined") && part !== ",",
      );
      if (validOrderBy.length > 0) {
        parts.push(`ORDER BY ${validOrderBy.join(", ")}`);
      }
    }

    // LIMIT
    if (this.parts.limit !== null && !this.parts.limit.includes(":undefined")) {
      parts.push(`LIMIT ${this.parts.limit}`);
    }

    // OFFSET
    if (
      this.parts.offset !== null &&
      !this.parts.offset.includes(":undefined")
    ) {
      parts.push(`OFFSET ${this.parts.offset}`);
    }

    return parts.join("\n");
  }

  /**
   * Gets the SQL query string
   *
   * @returns The SQL query string
   */
  get query(): string {
    return this.toString();
  }

  /**
   * Gets the parameters for the parameterized query as an array,
   * compatible with node-postgres expectations
   *
   * @returns The query parameters as an array
   */
  get parameters(): any[] {
    // Check if there are any parameters
    if (Object.keys(this.params).length === 0) {
      return [];
    }

    // Convert the numbered object params to an array
    const maxParam = Math.max(...Object.keys(this.params).map(Number));
    const paramsArray = new Array(maxParam);
    for (let i = 1; i <= maxParam; i++) {
      paramsArray[i - 1] = this.params[i];
    }
    return paramsArray;
  }

  /**
   * Adds a new query fragment to the current query
   *
   * @param strings - Template strings array
   * @param values - Values to be interpolated
   * @returns A new SQLQuery instance with the added fragment
   */
  sql(strings: TemplateStringsArray, ...values: any[]): SQLQuery {
    // Create a new copy of the query to avoid mutating the original
    const newQuery = new SQLQuery();

    // Copy all parts and parameters from the current query
    newQuery.parts = structuredClone(this.parts);
    newQuery.params = { ...this.params };
    newQuery.paramCounter = this.paramCounter;

    // Parse and add the new fragment
    const fragment = newQuery._interpolate(strings, values);
    newQuery.parseQuery(fragment);

    return newQuery;
  }
}

/**
 * Creates a SQL query using template literals with automatic parameter handling
 *
 * @example
 * ```ts
 * // Basic query
 * const query = sql`SELECT * FROM users WHERE id = ${userId}`;
 *
 * // Incremental building
 * let query = sql`SELECT * FROM users`;
 *
 * // Conditionally add clauses
 * if (userId) {
 *   query = query.sql`WHERE user_id = ${userId}`;
 * }
 *
 * // Chain multiple conditions safely (parameters will be $1, $2)
 * if (searchTerm) {
 *   query = query.sql`AND (name ILIKE ${'%' + searchTerm + '%'} OR email ILIKE ${'%' + searchTerm + '%'})`;
 * }
 *
 * // Add sorting and pagination
 * query = query.sql`ORDER BY ${sortColumn} ${sortDirection}`;
 * query = query.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
 * ```
 *
 * @param strings - Template strings array
 * @param values - Values to be interpolated and converted to parameters
 * @returns An SQLQuery instance
 */
export function sql(strings: TemplateStringsArray, ...values: any[]): SQLQuery {
  return new SQLQuery(strings, ...values);
}
