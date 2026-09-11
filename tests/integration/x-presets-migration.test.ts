import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("X preset data migration", () => {
  it("adds the two presets to an initialized database exactly once", async () => {
    const client = new PGlite();
    await client.exec(`
      CREATE TABLE config_versions (
        id integer PRIMARY KEY,
        version integer NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE platform_presets (
        id text PRIMARY KEY,
        key text NOT NULL UNIQUE,
        name text NOT NULL,
        output_type text NOT NULL,
        defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
        supported_macros jsonb NOT NULL DEFAULT '[]'::jsonb,
        required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
        static_params jsonb NOT NULL DEFAULT '{}'::jsonb,
        validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
        verification_state text NOT NULL DEFAULT 'draft',
        docs_url text,
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE audit_events (
        id text PRIMARY KEY,
        actor_id text NOT NULL,
        actor_email text NOT NULL,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        after jsonb,
        reason text,
        config_version integer,
        context jsonb,
        ts timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO config_versions (id, version) VALUES (1, 7);
    `);

    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0005_add_x_presets.sql"),
      "utf8",
    );
    await client.exec(migration);
    await client.exec(migration);

    const presets = await client.query<{
      key: string;
      defaults: Record<string, string>;
      required_fields: string[];
      verification_state: string;
    }>(`
      SELECT key, defaults, required_fields, verification_state
      FROM platform_presets
      ORDER BY key
    `);
    expect(presets.rows).toEqual([
      {
        key: "x_organic",
        defaults: { utm_medium: "organic", utm_source: "twitter-organic" },
        required_fields: [],
        verification_state: "draft",
      },
      {
        key: "x_paid",
        defaults: { utm_medium: "paid", utm_source: "twitter-paid" },
        required_fields: ["utm_content"],
        verification_state: "draft",
      },
    ]);

    const versions = await client.query<{ version: number }>(
      "SELECT version FROM config_versions WHERE id = 1",
    );
    expect(versions.rows[0]?.version).toBe(8);

    const audit = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM audit_events",
    );
    expect(audit.rows[0]?.count).toBe(2);

    await client.close();
  });
});
