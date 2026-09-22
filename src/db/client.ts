/**
 * Database client factory.
 *
 * Production / any environment with DATABASE_URL: node-postgres against a
 * managed PostgreSQL instance. Local development without DATABASE_URL:
 * embedded PGlite (real Postgres compiled to WASM) persisted at .data/pglite —
 * same dialect, same migrations, zero local infrastructure.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

let dbPromise: Promise<Db> | null = null;

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 5 });
    const db = drizzle(pool, { schema });
    // Migrations are applied out-of-band as a deploy step (npm run db:migrate),
    // not at request time — running them per cold-start adds latency, risks
    // concurrent-boot races, and needs the migration files bundled into every
    // serverless function. Opt in explicitly only if you want boot-time migrate.
    if (process.env.RUN_MIGRATIONS_ON_BOOT === "true") {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db, { migrationsFolder: "./drizzle" });
    }
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
  if (dataDir !== ":memory:") {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const pglite = new PGlite(dataDir === ":memory:" ? undefined : dataDir);
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { ensureSeed } = await import("./seed");
  await ensureSeed(db as unknown as Db);
  return db as unknown as Db;
}

/** Shared singleton for the app process. Tests build their own instances. */
export function getDb(): Promise<Db> {
  if (!dbPromise) dbPromise = createDb();
  return dbPromise;
}

/** Test helper: fresh in-memory PGlite with migrations + seed applied. */
export async function createTestDb(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { ensureSeed } = await import("./seed");
  await ensureSeed(db as unknown as Db);
  return db as unknown as Db;
}
