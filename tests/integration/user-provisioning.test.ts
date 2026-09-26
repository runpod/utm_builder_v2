/**
 * Shared sign-in provisioning: policy-gated creation of `user` rows, existing
 * roles preserved, deactivated accounts never resurrected, audited.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import { findOrProvisionUser, oidcAutoProvisionEnabled } from "@/services/user-provisioning";
import { freshDb } from "../helpers";

let db: Db;
beforeEach(async () => { db = await freshDb(); });

describe("findOrProvisionUser", () => {
  it("creates a low-privilege user on first sign-in when provisioning is enabled", async () => {
    const r = await findOrProvisionUser(db, {
      email: "New.Marketer@Runpod.io", displayName: "New Marketer", provision: true, source: "oidc",
      context: { issuer: "https://runpod.okta.com" },
    });
    expect(r.status).toBe("active");
    if (r.status !== "active") return;
    expect(r.provisioned).toBe(true);
    expect(r.user.email).toBe("new.marketer@runpod.io");
    expect(r.user.role).toBe("user");
    expect(r.user.name).toBe("New Marketer");
    const actions = (await db.select({ a: auditEvents.action }).from(auditEvents)).map((x) => x.a);
    expect(actions).toContain("auth.oidc_provisioned");
  });

  it("returns 'missing' without creating anything when provisioning is disabled", async () => {
    const r = await findOrProvisionUser(db, { email: "nobody@runpod.io", provision: false, source: "oidc" });
    expect(r.status).toBe("missing");
    const rows = await db.select().from(users).where(eq(users.email, "nobody@runpod.io"));
    expect(rows.length).toBe(0);
  });

  it("returns the existing account and role unchanged (no privilege change on sign-in)", async () => {
    const r = await findOrProvisionUser(db, { email: "dev-admin@runpod.io", provision: true, source: "oidc" });
    expect(r.status).toBe("active");
    if (r.status === "active") { expect(r.user.role).toBe("admin"); expect(r.provisioned).toBe(false); }
  });

  it("never resurrects a deactivated account, even with provisioning enabled", async () => {
    await db.update(users).set({ active: false }).where(eq(users.email, "dev-user@runpod.io"));
    const r = await findOrProvisionUser(db, { email: "dev-user@runpod.io", provision: true, source: "oidc" });
    expect(r.status).toBe("inactive");
    const rows = await db.select().from(users).where(eq(users.email, "dev-user@runpod.io"));
    expect(rows.length).toBe(1);
    expect(rows[0].active).toBe(false);
  });

  it("derives a display name from the email when none is supplied", async () => {
    const r = await findOrProvisionUser(db, { email: "first.last@runpod.io", provision: true, source: "poc" });
    if (r.status === "active") expect(r.user.name).toBe("first last");
  });

  it("reads the OIDC auto-provision policy from the environment", () => {
    const prev = process.env.OIDC_AUTO_PROVISION;
    process.env.OIDC_AUTO_PROVISION = "true"; expect(oidcAutoProvisionEnabled()).toBe(true);
    process.env.OIDC_AUTO_PROVISION = "false"; expect(oidcAutoProvisionEnabled()).toBe(false);
    delete process.env.OIDC_AUTO_PROVISION; expect(oidcAutoProvisionEnabled()).toBe(false);
    if (prev !== undefined) process.env.OIDC_AUTO_PROVISION = prev;
  });
});
