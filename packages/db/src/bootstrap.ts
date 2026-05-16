import { createClient } from "@libsql/client";

const migrationTableName = "__feedelity_migrations";

export interface SqlMigrationInput {
  readonly databaseUrl: string;
  readonly migrationId: string;
  readonly sql: string;
}

function splitMigrationStatements(sql: string): readonly string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export async function runSqlMigration(input: SqlMigrationInput): Promise<void> {
  const client = createClient({ url: input.databaseUrl });

  try {
    await client.execute("BEGIN IMMEDIATE");
    await client.execute(
      `CREATE TABLE IF NOT EXISTS ${migrationTableName} (id text PRIMARY KEY NOT NULL, applied_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)`,
    );

    const existing = await client.execute({ sql: `SELECT id FROM ${migrationTableName} WHERE id = ?`, args: [input.migrationId] });
    if (existing.rows.length > 0) {
      await client.execute("COMMIT");
      return;
    }

    for (const statement of splitMigrationStatements(input.sql)) {
      await client.execute(statement);
    }

    await client.execute({ sql: `INSERT INTO ${migrationTableName} (id) VALUES (?)`, args: [input.migrationId] });
    await client.execute("COMMIT");
  } catch (error) {
    try {
      await client.execute("ROLLBACK");
    } catch (rollbackError) {
      throw new Error(
        `Migration ${input.migrationId} failed and rollback also failed: ${error instanceof Error ? error.message : String(error)}; rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }

    throw error;
  } finally {
    client.close();
  }
}
