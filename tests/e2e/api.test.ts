/**
 * End-to-end tests at the HTTP boundary: real Next.js route handlers invoked
 * with real Request objects against an isolated in-memory database, with the
 * auth cookie layer mocked to select seeded identities.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

let currentIdentity = "dev-admin@runpod.io";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "rp_dev_identity" ? { name, value: currentIdentity } : undefined,
    set: (_name: string, value: string) => { currentIdentity = value; },
    delete: () => { currentIdentity = "dev-admin@runpod.io"; },
  }),
}));

process.env.PGLITE_DATA_DIR = ":memory:";
process.env.OUTBOX_PROCESS_TOKEN = "test-cron-token";
process.env.SOURCE_SYNC_TOKEN = "test-source-sync-token";

const asUser = (email: string) => {
  currentIdentity = email;
};

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  const { getDb } = await import("@/db/client");
  await getDb(); // migrate + seed the shared in-memory database once
});

describe("API end-to-end", () => {
  let campaignId: string;
  let linkId: string;
  let apiToken: string;
  let apiCredentialId: string;
  let versionedLinkId: string;

  it("health endpoint reports database status", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).checks.database).toBe("ok");
  });

  it("returns role capabilities and safely recovers a local dev identity", async () => {
    const sessionRoute = await import("@/app/api/session/route");
    asUser("dev-investigator@runpod.io");
    const readOnly = await sessionRoute.GET();
    expect((await readOnly.json()).capabilities.canIssue).toBe(false);

    asUser("dev-admin@runpod.io");
    const invalid = await sessionRoute.POST(
      jsonRequest("/api/session", "POST", { email: "missing@runpod.io" }),
    );
    expect(invalid.status).toBe(400);

    asUser("missing@runpod.io");
    const reset = await sessionRoute.DELETE();
    expect(reset.status).toBe(200);
    expect(currentIdentity).toBe("dev-admin@runpod.io");
  });

  it("creates a campaign and issues a link through the shared API", async () => {
    asUser("dev-user@runpod.io");
    const campaignsRoute = await import("@/app/api/campaigns/route");
    const created = await campaignsRoute.POST(
      jsonRequest("/api/campaigns", "POST", { name: "E2E Campaign" }),
    );
    expect(created.status).toBe(201);
    campaignId = (await created.json()).campaign.id;
    expect(campaignId).toMatch(/^rpc_/);

    const picker = await campaignsRoute.GET(
      jsonRequest("/api/campaigns?view=picker", "GET"),
    );
    expect((await picker.json()).groups.mine.map((campaign: { id: string }) => campaign.id))
      .toContain(campaignId);
    const search = await campaignsRoute.GET(
      jsonRequest("/api/campaigns?q=e2e", "GET"),
    );
    expect((await search.json()).campaigns.map((campaign: { id: string }) => campaign.id))
      .toContain(campaignId);

    const linksRoute = await import("@/app/api/links/route");
    const issued = await linksRoute.POST(
      jsonRequest("/api/links", "POST", {
        destination: "runpod.io/e2e?ref=keep",
        campaignId,
        utmSource: "github",
        utmMedium: "organic",
      }),
    );
    expect(issued.status).toBe(201);
    const body = await issued.json();
    linkId = body.link.id;
    expect(body.link.finalUrl).toContain(`utm_id=${campaignId}`);
    expect(body.link.finalUrl).toContain("ref=keep");
  });

  it("authenticates the versioned API with a user-scoped bearer token", async () => {
    asUser("dev-user@runpod.io");
    const accessTokens = await import("@/app/api/v1/access-tokens/route");
    const created = await accessTokens.POST(
      jsonRequest("/api/v1/access-tokens", "POST", { label: "E2E API", clientType: "api", expiresInDays: 7 }),
    );
    expect(created.status).toBe(201);
    apiToken = (await created.json()).token;

    const session = await import("@/app/api/v1/session/route");
    const response = await session.GET(new Request("http://localhost/api/v1/session", {
      headers: { Authorization: `Bearer ${apiToken}` },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.session.email).toBe("dev-user@runpod.io");
    expect(body.session.authMethod).toBe("bearer");
    expect(body.capabilities.canIssue).toBe(true);
    apiCredentialId = body.session.tokenId;
    expect(response.headers.get("X-Request-ID")).toBeTruthy();
  });

  it("makes versioned link issuance safely idempotent", async () => {
    const route = await import("@/app/api/v1/links/route");
    const request = () => new Request("http://localhost/api/v1/links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": "e2e-versioned-issuance-001",
      },
      body: JSON.stringify({
        destination: "runpod.io/versioned-e2e",
        campaignId,
        utmSource: "github",
        utmMedium: "organic",
      }),
    });
    const first = await route.POST(request());
    const retry = await route.POST(request());
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    const firstBody = await first.json();
    versionedLinkId = firstBody.link.id;
    expect((await retry.json()).link.id).toBe(versionedLinkId);
  });

  it("returns 409 with the existing record for exact duplicates", async () => {
    asUser("dev-user@runpod.io");
    const linksRoute = await import("@/app/api/links/route");
    const dup = await linksRoute.POST(
      jsonRequest("/api/links", "POST", {
        destination: "runpod.io/e2e?ref=keep",
        campaignId,
        utmSource: "github",
        utmMedium: "organic",
      }),
    );
    expect(dup.status).toBe(409);
    const body = await dup.json();
    expect(body.code).toBe("exact_duplicate");
    expect(body.existingLinkId).toBe(linkId);
  });

  it("returns 422 with findings for validation failures", async () => {
    const linksRoute = await import("@/app/api/links/route");
    const bad = await linksRoute.POST(
      jsonRequest("/api/links", "POST", {
        destination: "http://192.168.0.1/internal",
        campaignId,
        utmSource: "github",
        utmMedium: "organic",
      }),
    );
    expect(bad.status).toBe(422);
    expect((await bad.json()).findings.length).toBeGreaterThan(0);
  });

  it("searches the registry by free text and by ID", async () => {
    const linksRoute = await import("@/app/api/links/route");
    const byId = await linksRoute.GET(jsonRequest(`/api/links?q=${linkId}`, "GET"));
    const { rows } = await byId.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].creatorName).toBe("Dev User");
    expect(rows[0].creatorEmail).toBe("dev-user@runpod.io");
    expect(rows[0].link.createdBy).toMatch(/^rpu_/);
    const byText = await linksRoute.GET(jsonRequest("/api/links?q=e2e", "GET"));
    expect((await byText.json()).rows.length).toBeGreaterThan(0);
  });

  it("exports CSV with formula-injection protection headers", async () => {
    const exportRoute = await import("@/app/api/export/links/route");
    const res = await exportRoute.GET(jsonRequest("/api/export/links", "GET"));
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toContain("link_id");
    expect(csv.split("\r\n")[0]).toContain("generated_by_email");
    expect(csv).toContain("dev-user@runpod.io");
    expect(csv).toContain(linkId);
  });

  it("enforces roles server-side: non-admins get 403 on admin mutations", async () => {
    asUser("dev-user@runpod.io");
    const settings = await import("@/app/api/admin/settings/route");
    const denied = await settings.POST(
      jsonRequest("/api/admin/settings", "POST", { key: "bulk_limit", value: 5 }),
    );
    expect(denied.status).toBe(403);

    const usersRoute = await import("@/app/api/admin/users/route");
    expect((await usersRoute.GET()).status).toBe(403);

    // Investigator can read audit but not mutate settings.
    asUser("dev-investigator@runpod.io");
    const audit = await import("@/app/api/admin/audit/route");
    expect((await audit.GET(jsonRequest("/api/admin/audit", "GET"))).status).toBe(200);
    expect(
      (await settings.POST(jsonRequest("/api/admin/settings", "POST", { key: "bulk_limit", value: 5 }))).status,
    ).toBe(403);

    asUser("dev-admin@runpod.io");
    const allowed = await settings.POST(
      jsonRequest("/api/admin/settings", "POST", { key: "bulk_limit", value: 150, reason: "e2e" }),
    );
    expect(allowed.status).toBe(200);
  });

  it("processes bulk batches through the same API surface", async () => {
    asUser("dev-user@runpod.io");
    const batchesRoute = await import("@/app/api/batches/route");
    const res = await batchesRoute.POST(
      jsonRequest("/api/batches", "POST", {
        source: "paste",
        rows: [
          { destination: "runpod.io/b1", campaignId, utmSource: "github", utmMedium: "organic" },
          { destination: "invalid domain", campaignId, utmSource: "github", utmMedium: "organic" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.batchId).toMatch(/^rpb_/);
    expect(body.rows[0].status).toBe("issued");
    expect(body.rows[1].status).toBe("error");
  });

  it("protects the outbox worker with a bearer token", async () => {
    const worker = await import("@/app/api/outbox/process/route");
    const denied = await worker.POST(jsonRequest("/api/outbox/process", "POST"));
    expect(denied.status).toBe(401);
    const allowed = await worker.POST(
      new Request("http://localhost/api/outbox/process", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-token" },
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("protects the GTM source reconciliation worker with a bearer token", async () => {
    const worker = await import("@/app/api/source-sync/route");
    const denied = await worker.POST(jsonRequest("/api/source-sync", "POST"));
    expect(denied.status).toBe(401);
    const allowed = await worker.POST(
      new Request("http://localhost/api/source-sync", {
        method: "POST",
        headers: { Authorization: "Bearer test-source-sync-token" },
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("audit trail is queryable and exportable by investigators", async () => {
    asUser("dev-investigator@runpod.io");
    const audit = await import("@/app/api/admin/audit/route");
    const res = await audit.GET(jsonRequest(`/api/admin/audit?entityId=${linkId}`, "GET"));
    const body = await res.json();
    expect(body.events.some((e: { action: string }) => e.action === "link.issued")).toBe(true);
    const apiEventResponse = await audit.GET(
      jsonRequest(`/api/admin/audit?entityId=${versionedLinkId}`, "GET"),
    );
    const apiEventBody = await apiEventResponse.json();
    expect(apiEventBody.events[0].context.credentialId).toBe(apiCredentialId);
    const csv = await audit.GET(jsonRequest(`/api/admin/audit?format=csv`, "GET"));
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
  });
});
