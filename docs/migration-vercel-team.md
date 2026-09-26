# Migration runbook — personal Vercel → Runpod team Vercel

Status: **Phases 1–3 executed 2026-09-23 → 2026-09-25; cutover live.** (Plan written 2026-09-22.) Moves the running UTM Builder deployment from
the personal Vercel account (`kenlim-mops/utm-builder-test`) to the Runpod team
(`runpod/utm-builder`, `https://utm-builder-runpod.vercel.app`) while the current
deployment stays live and **both deployments share the same database**.

## Starting state (verified 2026-09-22)

| | Personal (current) | Runpod team (target) |
|---|---|---|
| Project | `kenlim-mops/utm-builder-test` | `runpod/utm-builder` |
| URL | `utm-builder-test-kenlim-mops.vercel.app` | `utm-builder-runpod.vercel.app` |
| Code | current `main` | **stale** (2026-09-06 build) — must redeploy |
| Auth | `AUTH_PROVIDER=poc` | `AUTH_PROVIDER=google` (to become `oidc`/Okta) |
| Database | Neon via Vercel Marketplace resource `neon-rose-car` (owned by the personal team) | none |
| Crons (`*/5` outbox, hourly source-sync) | active | active but pointless (no DB) |
| Deployment Protection | on (personal-team Viewers) | on |

Facts the plan relies on: boot-time migrations are **off** (`RUN_MIGRATIONS_ON_BOOT` unset) so
both deployments only connect and query; the outbox/source-sync worker **fails closed when both
`CRON_SECRET` and `OUTBOX_PROCESS_TOKEN` are unset**, which is the switch for which deployment
owns background jobs; session cookies are per-origin, so each deployment keeps its own
`SESSION_SECRET`; API tokens live in the shared `users`/`api_access_tokens` tables and work
against either URL.

## Phase 0 — decisions (made)

1. **Access:** Okta SSO (`AUTH_PROVIDER=oidc`) with in-app provisioning — IT decision 2026-09-22.
   Okta app-integration spec: [deployment-vercel.md §4a](deployment-vercel.md#4a-okta--runpod-sso-selected-by-it-2026-09-22).
2. **Database:** stays on the existing Neon project during the move; long-term home is a
   separate decision in progress.

## Phase 1 — stand up the team deployment (no user impact)

On `runpod/utm-builder`:

1. Set `DATABASE_URL` to the existing **pooled** Neon connection string, pasted as a plain env
   var (this deliberately decouples the team project from the personal team's Marketplace
   integration). Same value for both deployments = shared database.
2. Until the Okta client arrives, set `AUTH_PROVIDER=poc` as a temporary stand-in so the
   deployment can be verified end-to-end; keep `APP_URL=https://utm-builder-runpod.vercel.app`
   and the project's own `SESSION_SECRET`.
3. **Unset `CRON_SECRET` and `OUTBOX_PROCESS_TOKEN`** so this deployment's scheduled jobs 401.
   Exactly one deployment may process the shared outbox at a time (the worker has no row
   locking; external effects are idempotent, but attempts and logs would double).
4. Deploy current `main`. Verify: `/api/health`; sign in on the new URL (existing admin row);
   the same campaigns/links are visible; issue a test link on the new URL and confirm it appears
   on the old URL.

## Phase 2 — parallel operation

Both deployments live against one database. Users sign in separately per URL (different
cookies) — expected. Confirm cron runs are landing from only the personal deployment.

## Phase 3 — Okta + cutover (a set of env flips, no data movement)

1. When IT delivers the Okta client: set `AUTH_PROVIDER=oidc`, `OIDC_ISSUER=https://runpod.okta.com`,
   `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_ALLOWED_EMAIL_DOMAINS=runpod.io` on the team
   project; redeploy; verify sign-in end to end (including a user *not* yet provisioned →
   `no_account`, then provision in `/admin` → success).
2. Turn **off** Vercel Deployment Protection on the team project — Okta + in-app provisioning
   is now the gate. Verify anonymously that unauthenticated requests reach only the sign-in
   page and every API route still returns 401.
3. Move cron ownership: set `CRON_SECRET`/`OUTBOX_PROCESS_TOKEN` on the team project, **unset
   them on the personal project**; redeploy both.
4. Point people, the skill's example base URL (already the team URL), and any integrations at
   the new URL. Provision users as they sign in.

## Phase 4 — decommission the old deployment (carefully)

1. Keep the personal project deployed but idle for ~1 week as rollback, then delete the
   **deployment/project only**.
2. ⚠️ **Do not uninstall the Neon Marketplace integration or delete the `neon-rose-car`
   resource** — that deletes the shared database. Until the database moves, the Neon project
   must remain attached to the personal team (or be claimed/transferred out first).
3. Follow-up (separate decision): move the data to Runpod-owned Postgres via `pg_dump`/restore
   during a short write freeze, or transfer the Neon project into a Runpod-owned Neon org.

## Progress log

- **2026-09-23 — Phase 1 done.** Team project deployed at current `main`, `DATABASE_URL` set to the shared pooled Neon string, `AUTH_PROVIDER=poc` stand-in, cron secrets removed on the team project (personal deployment remains the sole outbox owner).
- **2026-09-25 — Okta live (Phase 3 steps 1–2).** IT delivered the Okta app (client `0oa27bybihppwDw3Q1d8`, issuer `https://runpod.okta.com`, assigned to the initial admin only; further users requested via IT). Set `AUTH_PROVIDER=oidc` + `OIDC_*`, redeployed, admin sign-in verified end to end. Vercel Deployment Protection switched to **preview-only** (`ssoProtection.deploymentType=preview`); anonymous verification: `/`, `/api/health`, `/api/session` reachable, all data/admin/write routes 401, `/api/auth/login` redirects to Okta with correct client/redirect URI/scopes.
- **Deferred by decision:** cron ownership stays with the personal (testers') deployment — moving it requires changing that deployment, which is frozen while testers use it. Move crons to the team project at decommission time (Phase 3 step 3 / Phase 4).
- **Onboarding model (2026-09-25):** Okta app assigned to the **Marketing group** (requested via IT). `OIDC_AUTO_PROVISION=true` on the team project: anyone in the group signs in and is created as `user` (campaigns, initiatives, links); admin/investigator are promoted in `/admin`; deactivating a user in `/admin` blocks them even while still assigned in Okta.

## Rollback

Trivial at any point through Phase 3: the personal deployment stays untouched and live; revert
by flipping the cron secrets back and directing people to the old URL. Data is never copied
or moved.

## Housekeeping

- Deploy the same commit to both projects; keep `RUN_MIGRATIONS_ON_BOOT` unset on both and run
  schema changes once via `npm run db:migrate` against the shared database.
- `APP_URL` and the Okta redirect URI change together if a custom domain is added later.
