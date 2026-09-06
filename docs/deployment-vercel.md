# Deployment — Vercel

Operational guide for deploying the UTM Builder & Registry V2 to Vercel with a managed PostgreSQL database.

---

## 1. Vercel project setup

1. Create a Vercel project from the repository (framework preset: Next.js; build command `npm run build`).
2. Configure **separate environment variable sets for Preview and Production**. Preview deployments must point at a non-production database and must never hold production credentials.
3. Keep the included `vercel.json` — it defines the outbox cron (§8).

## 2. PostgreSQL provisioning

⚠️ **The database provider must be Runpod-approved before production launch.** Candidates, pending approval:

- Neon (serverless Postgres, good Vercel integration)
- Vercel Postgres
- AWS RDS for PostgreSQL

Requirements regardless of provider:

- PostgreSQL (the app uses `pg`/node-postgres with a small pool, `max: 5` per instance — check the provider's connection limits against expected concurrency; a pooler such as PgBouncer/Neon pooling may be needed)
- Point-in-time recovery (PITR) enabled — this is the registry's only recovery path (§10)
- TLS connections; credentials only in Vercel env vars

## 3. Environment variables

| Variable | Environment | Value | Notes |
|---|---|---|---|
| `DATABASE_URL` | Production, Preview | `postgres://user:pass@host:5432/db` | Required in production. When unset, the app falls back to embedded PGlite — local dev only, never acceptable on Vercel. |
| `AUTH_PROVIDER` | Production, Preview | `google` | Recommended production provider (decision 2026-09-06). The dev provider unconditionally refuses to run in a production build, so Preview needs a real provider too. `oidc` (any OIDC IdP, e.g. Okta) and `sso` (signed-header proxy) remain supported alternatives. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Production, Preview | `<Google Workspace OAuth client>` | OAuth 2.0 Web application client created in a Runpod-owned Google Cloud project; authorized redirect URI is `<APP_URL>/api/auth/callback` (one per environment). |
| `SESSION_SECRET` | Production, Preview | `<32+ char random secret per environment>` | Signs the login session cookie (12h TTL). `openssl rand -hex 32`; never reuse across environments. |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_ALLOWED_EMAIL_DOMAINS` | Optional | — | Generic OIDC overrides. Point at Okta (or another IdP) later without code changes; defaults are Google + `runpod.io`. |
| `SSO_HEADER_SECRET` | Only with `AUTH_PROVIDER=sso` | `<independent long random secret per environment>` | Shared only with the approved identity-aware proxy. Never expose it to clients or reuse the Production value in Preview. |
| `OUTBOX_PROCESS_TOKEN` | Production, Preview | `<long random secret>` | Bearer token protecting `/api/outbox/process`. Required — the route rejects everything when no token is configured. |
| `CRON_SECRET` | Production | `<long random secret>` | Vercel automatically sends this as `Authorization: Bearer` on both scheduled routes. |
| `SOURCE_SYNC_TOKEN` | Production, Preview | `<long random secret>` | Optional separate operator token for manually invoking `/api/source-sync`; the route also accepts `CRON_SECRET`. |
| `NOTION_API_TOKEN` | Production, Preview | `<Notion integration token>` | Required only when a Notion source connector is configured. Store only here; catalog rows carry `env:NOTION_API_TOKEN`, never the token. |
| `SLACK_SIGNING_SECRET` | Production, Preview | `<Slack app signing secret>` | Verifies `/api/slack/commands` and `/api/slack/interactions`; never expose to clients. |
| `SLACK_BOT_TOKEN` | Production, Preview | `xoxb-...` | Opens modals, resolves work emails, downloads selected bulk CSV files, and DMs results. |
| `SLACK_ALLOWED_ENTERPRISE_IDS` | Production | `<Runpod Slack enterprise ID>` | Comma-separated allowlist. Production Slack access fails closed when both Slack allowlists are empty. |
| `SLACK_ALLOWED_TEAM_IDS` | Optional | `<workspace IDs>` | Supplements or narrows workspace-level installs. |
| `SLACK_USER_EMAIL_MAP_JSON` | Optional | `{"U123":"person@runpod.io"}` | Fallback identity mapping when a profile email is unavailable. |
| `APP_URL` | Production, Preview | `https://utm.runpod.io` | Canonical registry links sent in Slack batch results. |
| `HUBSPOT_ACCESS_TOKEN` | Production | `<HubSpot private-app token>` | Optional at launch: without it, HubSpot syncs stay queued/failed in the outbox and everything else works. |
| `EXTENSION_IDS` | Production | `<32-character Chrome extension ID>` | Required for the production extension PKCE redirect and CORS. Comma-separated only during a controlled ID transition. |

Reference: `.env.example`.

## 4. Sign-in providers

### 4a. Google OAuth / OIDC (recommended, decision 2026-09-06)

`AUTH_PROVIDER=google` runs the authorization-code flow directly in the app — no identity proxy is required:

1. In a Runpod-owned Google Cloud project, create an **OAuth 2.0 Client ID** (type: Web application). Authorized redirect URI: `<APP_URL>/api/auth/callback`. Use separate clients (or at least separate redirect URIs) for Production and Preview.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, and `APP_URL`.
3. Sign-in is restricted to verified `@runpod.io` accounts (`OIDC_ALLOWED_EMAIL_DOMAINS`) and to emails that already exist as **active rows in `users`** — there is no auto-provisioning, and roles are always read from the database, never from Google claims. Sign-ins are audited (`auth.signed_in`).
4. Sessions are HMAC-signed, `httpOnly`, `SameSite=Lax`, `Secure` cookies with a 12-hour TTL; sign-out clears the cookie.
5. To switch to Okta (or any OIDC IdP) later, set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` — no code change.

### 4b. Signed-header proxy (alternative)

The application also retains a fail-closed signed-principal SSO adapter for deployments behind an identity-aware proxy. An approved identity-aware proxy must authenticate the user and overwrite these headers before traffic reaches the application:

- `x-runpod-auth-email`: verified work email, normalized to lowercase
- `x-runpod-auth-timestamp`: current Unix timestamp in seconds
- `x-runpod-auth-signature`: `v1=` followed by the lowercase hex HMAC-SHA256 of `<timestamp>\n<email>` using `SSO_HEADER_SECRET`

The application rejects missing or invalid signatures and timestamps outside a five-minute window. Production and Preview must use different secrets and databases. The proxy must strip all client-supplied copies of these headers before writing its own values.

Integration contract:

1. **Verify the principal before signing** — the proxy must validate the IdP session and sign only the verified email. Never pass through browser-supplied identity headers.
2. **Map the verified principal to a `users` row** (email-keyed). No row or `active = false` → treat as unauthenticated. Decide explicitly whether to auto-provision first-time users as role `user` or require admin pre-provisioning via `POST /api/admin/users`.
3. **Return `{ id, email, name, role }` with the role read from the database**, never from IdP claims. Role management stays in /admin and stays audited.
4. All enforcement remains server-side through `requireUser`/`requireRole`. Client capabilities improve the interface but are not authorization controls.
5. Test direct access to the application origin without the proxy and confirm it returns 401.
6. Enforce shared rate limits for `/api/v1/auth/extension/token` and `/api/session` at the proxy/WAF. The application limiter is bounded and protects each instance, but is deliberately not a distributed quota store.

## 5. Migrations strategy

- Migrations live in `./drizzle` and are generated by `npm run db:generate`.
- **Auto-run on boot:** `getDb()` (`src/db/client.ts`) applies pending migrations on first database use in each fresh deployment. This keeps deploys simple, but on serverless the first request pays the cost and concurrent cold starts can race on migration locks.
- **Recommendation:** run `npm run db:migrate` as an explicit release step (CI/CD, against the production `DATABASE_URL`) before promoting a deployment. Boot-time migration then becomes a no-op safety net.
- Review generated SQL before release; prefer additive migrations (the schema history is append-friendly by design).

## 6. Seeding

- **PGlite (local dev):** seeded automatically.
- **Postgres (production/preview):** the seed does **not** run automatically. Run once after the first migration:

```bash
DATABASE_URL=postgres://... npm run db:seed
```

The seed is idempotent. On first run it installs default settings, taxonomy, presets, destination policies, and **three dev identities** (`dev-admin@runpod.io` etc.). On later runs it also backfills any missing default GTM data-field definitions and bulk-change templates without overwriting administered rows. In production, deactivate the dev identities via /admin users management immediately after seeding, then provision real users.

## 7. Domain, HTTPS, cookies

- Deploy on an **internal Runpod domain**; this is an internal tool and must not be publicly reachable without SSO.
- HTTPS is mandatory (Vercel default). The dev identity cookie is set `secure` in production, but production must use SSO anyway; ensure the SSO session mechanism uses `Secure; HttpOnly; SameSite` cookies.
- If fronted by an access proxy (e.g. Cloudflare Access / IdP-aware proxy), that proxy's signed assertion can be the SSO verification input (§4).
- Keep `/api/v1` and `/api/mcp` behind the same HTTPS host. They authenticate bearer tokens server-side; the extension receives CORS only when its ID appears in `EXTENSION_IDS`.

## 8. Scheduled processing (Vercel cron)

`vercel.json` (already in the repo):

```json
{
  "crons": [
    {
      "path": "/api/outbox/process",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/source-sync",
      "schedule": "17 * * * *"
    }
  ]
}
```

- Runs every 5 minutes. Vercel invokes the path with `Authorization: Bearer $CRON_SECRET`; the route accepts GET or POST and authorizes against `CRON_SECRET` or `OUTBOX_PROCESS_TOKEN`.
- Each run processes up to 25 due events; backoff and dead-lettering are handled by the worker (`src/services/outbox.ts`).
- Manual/operator run: `curl -X POST -H "Authorization: Bearer $OUTBOX_PROCESS_TOKEN" https://<host>/api/outbox/process`
- Non-Vercel fallback: `npm run outbox:process` from any machine with `DATABASE_URL`.

The second job scans due active GTM source connectors hourly. Each connector has its own interval and database lease; hashes make repeat delivery idempotent. Manual/operator run: `curl -X POST -H "Authorization: Bearer $SOURCE_SYNC_TOKEN" https://<host>/api/source-sync`. A source failure records a failed run and `lastError`, leaves catalog data unchanged, and remains eligible for retry. See [source-reconciliation.md](source-reconciliation.md).

## 9. Logging and monitoring

- **Health:** `GET /api/health` returns 200 `healthy` / 503 `degraded` with per-check detail (API, database). Point uptime monitoring here.
- **Logs:** route handlers return structured JSON errors; use Vercel log drains to ship function logs to the standard Runpod logging stack.
- **Alerts to configure:**
  - Outbox dead-letters: any event reaching status `dead` (visible via `GET /api/admin/outbox`, or a warehouse query on `outbox_events.status = 'dead'`)
  - Reconciliation discrepancies: `discrepancyCount > 0` on recent `reconciliation_runs`
  - Health endpoint failures
  - Cron execution failures (Vercel cron dashboard)
  - Failed GTM source sync runs, stale `lastSucceededAt`, and pending proposal backlog
- Monitoring/alerting *ownership* is an open decision — see [decisions.md](decisions.md).

### Downstream data-plane monitoring

Application monitoring stops at PostgreSQL snapshot creation. Separately monitor the approved PostgreSQL→Snowflake delivery job, GA4 and PostHog parameter capture, Snowflake model freshness/join quality, and Mode report freshness. An outbox success is not evidence that Snowflake received the snapshot. See [reporting-contract.md](reporting-contract.md).

## 10. Backups and recovery

Two separate mechanisms — do not conflate them:

- **Application rollback:** redeploy the previous build from the Vercel deployments list (instant promote). Use for bad code releases. The database is untouched; migrations are additive, so a previous build against a newer schema is generally safe — verify before relying on it for a release that included a migration.
- **Database recovery:** provider PITR. Use only for data-level incidents (bad migration, destructive mistake). Restoring the database rewinds links, audit, and outbox state — reconcile with external systems (HubSpot, warehouse) afterwards via `/api/admin/reconcile`.

Also take periodic config exports (`GET /api/admin/export`) as a lightweight, diffable config snapshot.

## 11. Smoke test checklist (after each production deploy)

1. `GET /api/health` → 200, `database: ok`
2. Sign in via SSO; `GET /api/session` returns your identity with the DB role
3. `GET /api/taxonomy` returns seeded mediums/sources
4. Create a test campaign → `201`, response includes `rpc_` ID; attempt a punctuation/spacing variant → `409 campaign_duplicate`; as an administrator, verify a reason-required override creates `campaign.duplicate_override`
5. Preview a link (`POST /api/links/preview`) → final URL has params in contract order
6. Issue the link → `201`; re-issue identical input → `409 exact_duplicate`
7. `GET /api/campaigns/{id}` → HubSpot mapping present (`pending` or `synced`)
8. Trigger `POST /api/outbox/process` with the bearer token → `200` with a result summary
9. `GET /api/admin/audit` (as admin) shows the issuance events
10. Retire the test link (`DELETE /api/links/{id}?reason=smoke-test`)
11. Create a seven-day test token under **API access**; verify `/api/v1/session`, then revoke it and verify the same request returns 401
12. From the allowlisted extension, capture a current page, preview, issue, and open the resulting registry record
13. Connect an MCP client to `/api/mcp`; list tools and call `utm_list_reference_data` before attempting any write
14. Call `gtm_get_data_definition` for `utm_id` and confirm a verified definition is returned
15. If Notion reconciliation is enabled: create a paused test connector, scan manually, verify a proposal appears without changing the catalog, then reject it with a reason
16. Import/update `slack/manifest.json`, approve it in Slack, then execute the signed-request, single-link, duplicate-reuse, two-row batch, identity-denial, and GTM MCP smoke tests in [slack.md](slack.md)

## 12. Production readiness checklist

- [ ] Runpod-approved PostgreSQL provider provisioned, PITR enabled and tested
- [ ] `DATABASE_URL`, `AUTH_PROVIDER=sso`, `SSO_HEADER_SECRET`, `OUTBOX_PROCESS_TOKEN`, and `CRON_SECRET` set in Production, with separate required values in Preview
- [ ] Any pilot-enabled optional client is approved and configured: Slack allowlist, extension ID/distribution, and/or API/MCP token ownership. Unused clients remain disabled.
- [ ] Approved identity proxy emits the signed principal headers; direct and spoofed-header access verified impossible
- [ ] `ALLOW_INSECURE_DEV` **not** set anywhere in production (it is ignored in production builds, but keep configs clean)
- [ ] `EXTENSION_IDS`, `SLACK_ALLOWED_TEAM_IDS`/`SLACK_ALLOWED_ENTERPRISE_IDS` configured — these now fail closed when unset in every environment unless `ALLOW_INSECURE_DEV=true` is explicitly set outside production
- [ ] Migrations applied via explicit release step; seed run once; dev identities deactivated
- [ ] Real admin users provisioned; roles verified
- [ ] Cron running (check Vercel cron logs); outbox drains to `succeeded`
- [ ] `HUBSPOT_ACCESS_TOKEN` set (or a documented decision to launch with sync queued)
- [ ] Alerts wired: health, dead-letters, reconciliation discrepancies
- [ ] Internal domain + SSO gate verified from outside the network
- [ ] Config export taken and stored
- [ ] Smoke test (§11) passed
- [ ] API/MCP tokens have an owner, expiry/rotation policy, and secret-storage standard
- [ ] GTM catalog/source-proposal steward and review SLA assigned
- [ ] Every enabled Notion connector mapping tested in paused/review-first mode; `NOTION_API_TOKEN` scoped only to approved sources
- [ ] Platform bulk templates remain draft until account-specific export/import certification is complete
- [ ] Production effective date, pilot cohort, governance owner, support route, and exception SLA approved per [pilot-governance.md](pilot-governance.md)
- [ ] Marketing site explicitly captures governed parameters in GA4 and PostHog; payload and downstream-row evidence retained
- [ ] PostgreSQL snapshot delivery to Snowflake is implemented, monitored, replayable, and assigned to an owner
- [ ] Certified Snowflake dimensions/fact and the initial Mode quality report pass the [reporting contract](reporting-contract.md)
- [ ] Historical traffic is labeled and mapped under [historical-migration.md](historical-migration.md); raw values remain unchanged

## 13. Runpod approval dependencies

Explicitly blocked on internal approval (tracked in [decisions.md](decisions.md) → Open decisions):

1. **SSO provider** — which IdP/proxy, and the principal-verification mechanism
2. **PostgreSQL provider** — Neon / Vercel Postgres / RDS / other
3. **HubSpot private-app token** issuance and scope review
4. **Internal domain** allocation and network policy
5. **Monitoring/alerting ownership** — which team receives dead-letter and reconciliation alerts
6. **Extension distribution** — private Chrome Web Store vs. managed enterprise deployment, plus owner/release process
7. **MCP authentication target** — personal tokens are implemented; organization-standard OAuth remains the production maturity path
8. **GTM catalog stewardship** — ownership, restricted-record policy, freshness SLA, and source proposal review coverage
9. **Notion integration scope** — approved workspaces/data sources and which fields, if any, may be authoritative
10. **Snowflake delivery** — approved connector/job, owner, freshness SLA, backfill procedure, and Mode certification path
11. **Analytics capture** — owners and verified implementation for GA4 and PostHog landing, session, and first-touch fields
