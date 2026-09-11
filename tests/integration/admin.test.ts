import { beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, links, platformPresets } from "@/db/schema";
import type { SessionUser } from "@/services/auth";
import { createCampaign } from "@/services/campaigns";
import { getConfig, updateSetting } from "@/services/config";
import { upsertDestinationPolicy } from "@/services/destinations";
import { issueLink } from "@/services/links";
import { upsertPreset } from "@/services/presets";
import { upsertSource } from "@/services/taxonomy";
import { upsertUser } from "@/services/users";
import { adminActor, freshDb, userActor } from "../helpers";

let db: Db;
let admin: SessionUser;
let user: SessionUser;

beforeEach(async () => {
  db = await freshDb();
  admin = await adminActor(db);
  user = await userActor(db);
});

describe("configuration versioning", () => {
  it("bumps the global config version on every admin change and stamps issued links", async () => {
    const v0 = (await getConfig(db)).configVersion;
    await updateSetting(db, admin, "bulk_limit", 100, "tighter limit");
    await upsertSource(db, admin, { slug: "tiktok-paid", mediumSlug: "paid" }, "new channel");
    await upsertPreset(db, admin, { key: "generic", verificationState: "verified" }, "recheck");
    await upsertDestinationPolicy(db, admin, { domain: "get.runpod.io", kind: "approved" }, null);
    const v1 = (await getConfig(db)).configVersion;
    expect(v1).toBe(v0 + 4);

    const campaign = await createCampaign(db, admin, { name: "Versioned" });
    const { link } = await issueLink(db, user, {
      destination: "runpod.io/v",
      campaignId: campaign.id,
      utmSource: "github",
      utmMedium: "organic",
    });
    expect(link.configVersion).toBe(v1);

    // Later config changes never rewrite the version recorded at issuance.
    await updateSetting(db, admin, "bulk_limit", 150, "again");
    const [after] = await db.select().from(links).where(eq(links.id, link.id));
    expect(after.configVersion).toBe(v1);
  });

  it("audits every administrative change with before/after and reason", async () => {
    await updateSetting(db, admin, "bulk_limit", 42, "incident follow-up");
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "setting.updated"))
      .orderBy(desc(auditEvents.ts))
      .limit(1);
    expect(event.actorEmail).toBe(admin.email);
    expect(event.before).toBe(200);
    expect(event.after).toBe(42);
    expect(event.reason).toBe("incident follow-up");
    expect(event.configVersion).toBeGreaterThan(1);
  });

  it("audits role changes", async () => {
    await upsertUser(db, admin, { email: "dev-user@runpod.io", role: "investigator" }, "rotation");
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "user.role_changed"));
    expect(events).toHaveLength(1);
    expect(events[0].before).toMatchObject({ role: "user" });
    expect(events[0].after).toMatchObject({ role: "investigator" });
  });
});

describe("taxonomy governance", () => {
  it("seeds separate X organic and paid presets with historical canonical sources", async () => {
    const presets = await db.select().from(platformPresets);
    const xPresets = presets
      .filter((preset) => preset.key === "x_organic" || preset.key === "x_paid")
      .map((preset) => ({
        key: preset.key,
        defaults: preset.defaults,
        requiredFields: preset.requiredFields,
        verificationState: preset.verificationState,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    expect(xPresets).toEqual([
      {
        key: "x_organic",
        defaults: { utm_medium: "organic", utm_source: "twitter-organic" },
        requiredFields: [],
        verificationState: "draft",
      },
      {
        key: "x_paid",
        defaults: { utm_medium: "paid", utm_source: "twitter-paid" },
        requiredFields: ["utm_content"],
        verificationState: "draft",
      },
    ]);
  });

  it("new links respect newly disabled sources without touching issued links", async () => {
    const campaign = await createCampaign(db, admin, { name: "Tax" });
    const { link } = await issueLink(db, user, {
      destination: "runpod.io/t",
      campaignId: campaign.id,
      utmSource: "github",
      utmMedium: "organic",
    });
    await upsertSource(db, admin, { slug: "github", mediumSlug: "organic", status: "disabled" }, "abuse");
    await expect(
      issueLink(db, user, {
        destination: "runpod.io/t2",
        campaignId: campaign.id,
        utmSource: "github",
        utmMedium: "organic",
      }),
    ).rejects.toThrow(/disabled/i);
    // The already-issued link is untouched.
    const [existing] = await db.select().from(links).where(eq(links.id, link.id));
    expect(existing.utmSource).toBe("github");
    expect(existing.status).toBe("issued");
  });

  it("resolves aliases to canonical sources at issuance (Meta rename safety)", async () => {
    const campaign = await createCampaign(db, admin, { name: "Meta" });
    const { link } = await issueLink(db, user, {
      destination: "runpod.io/meta",
      campaignId: campaign.id,
      utmSource: "meta-paid", // alias of facebook-paid in the seed
      utmMedium: "paid",
    });
    expect(link.utmSource).toBe("facebook-paid");
    expect(new URL(link.finalUrl).searchParams.get("utm_source")).toBe("facebook-paid");
  });
});

describe("audit immutability surface", () => {
  it("exposes no service or API that updates or deletes audit events", async () => {
    const auditModule = await import("@/services/audit");
    expect(Object.keys(auditModule).sort()).toEqual(["recordAudit", "redact"]);
  });

  it("redacts sensitive keys in audit payloads", async () => {
    const { redact } = await import("@/services/audit");
    expect(
      redact({ apiKey: "x", nested: { authorization: "Bearer y", ok: 1 }, token: "z" }),
    ).toEqual({ apiKey: "[redacted]", nested: { authorization: "[redacted]", ok: 1 }, token: "[redacted]" });
  });
});
