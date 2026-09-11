/**
 * POC email sign-in (AUTH_PROVIDER=poc): provisions/returns a user, enforces
 * the domain allowlist and active flag, and stays disabled otherwise.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { AuthError } from "@/services/auth";
import { pocSignIn } from "@/services/poc-login";
import { freshDb } from "../helpers";

let db: Db;
const prev = process.env.AUTH_PROVIDER;

beforeEach(async () => {
  db = await freshDb();
  process.env.AUTH_PROVIDER = "poc";
});
afterEach(() => {
  process.env.AUTH_PROVIDER = prev;
});

describe("pocSignIn", () => {
  it("provisions a first-time runpod.io colleague as a low-privilege user", async () => {
    const actor = await pocSignIn(db, "New.Person@Runpod.io");
    expect(actor.email).toBe("new.person@runpod.io");
    expect(actor.role).toBe("user");
    const [row] = await db.select().from(users).where(eq(users.email, "new.person@runpod.io"));
    expect(row.active).toBe(true);
  });

  it("returns the existing role for a seeded user (no privilege change)", async () => {
    const actor = await pocSignIn(db, "dev-admin@runpod.io");
    expect(actor.role).toBe("admin");
  });

  it("rejects non-allowlisted domains and malformed emails", async () => {
    await expect(pocSignIn(db, "someone@gmail.com")).rejects.toThrow(AuthError);
    await expect(pocSignIn(db, "not-an-email")).rejects.toThrow(AuthError);
  });

  it("refuses to run when POC mode is disabled", async () => {
    process.env.AUTH_PROVIDER = "google";
    await expect(pocSignIn(db, "x@runpod.io")).rejects.toThrow(/not enabled/i);
  });
});
