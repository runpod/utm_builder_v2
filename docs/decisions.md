# Architecture Decision Records

Format per entry: Status / Context / Options / Decision / Justification / Tradeoffs / Revisit trigger.

---

## 1. Runpod-owned canonical campaign ID

- **Status:** Accepted
- **Context:** Campaigns need an identity that survives renames, platform migrations, and tool churn. Candidates for "the" campaign ID: a human-typed name, an external system's ID (HubSpot GUID, Google Ads ID), or a Runpod-minted ID.
- **Options:** (a) name-as-identity; (b) adopt HubSpot GUID; (c) Runpod-minted immutable ID.
- **Decision:** Runpod mints `rpc_<ULID>` at campaign creation (`src/core/ids.ts`); it is the primary key and never changes.
- **Justification:** Names drift and collide. External IDs couple identity to one vendor's lifecycle and availability. Owning the ID makes every external system a mapping.
- **Tradeoffs:** One more ID for humans to encounter; requires the registry to exist before any campaign does.
- **Revisit trigger:** None foreseeable; this is the system's foundation.

## 2. `utm_id` as the public campaign-ID parameter

- **Status:** Accepted
- **Context:** The canonical campaign ID must ride on URLs and be readable by analytics without custom setup.
- **Options:** (a) custom param (`rp_campaign_id`); (b) overload `utm_campaign`; (c) `utm_id`.
- **Decision:** Carry `rpc_...` in `utm_id`, first parameter in the contract order.
- **Justification:** GA4 ingests `utm_id` natively (session campaign ID) — zero tag configuration. Overloading `utm_campaign` would destroy human readability; a custom param would need capture work everywhere.
- **Tradeoffs:** `utm_id` semantics are "campaign ID" by convention — teams accustomed to putting other values there must be onboarded.
- **Revisit trigger:** GA4 changing `utm_id` handling, or adopting an analytics stack without `utm_id` support.

## 3. HubSpot GUID as external mapping

- **Status:** Accepted
- **Context:** HubSpot has its own campaign objects with GUIDs; marketing attribution in HubSpot needs them linked to registry campaigns.
- **Options:** (a) HubSpot GUID as the primary campaign ID; (b) synchronous create-in-HubSpot during campaign creation; (c) GUID stored as an external mapping, synced asynchronously.
- **Decision:** `external_campaign_mappings` stores the GUID (unique when non-null, DB-enforced), populated asynchronously via the outbox.
- **Justification:** A HubSpot outage must never block campaign creation or roll back registry writes; identity stays Runpod-owned (ADR 1).
- **Tradeoffs:** A campaign can exist unmapped for minutes-to-hours (or until an admin fixes a dead-letter); HubSpot-side reports lag registry truth.
- **Revisit trigger:** HubSpot replacing GUID-based campaign identity, or a requirement for synchronous HubSpot consistency.

## 4. Optional initiative layer

- **Status:** Accepted
- **Context:** Launches often span several campaigns and want a rollup, but most day-to-day work is a single campaign.
- **Options:** (a) mandatory three-level hierarchy; (b) no grouping (tags only); (c) optional initiative above campaign.
- **Decision:** Initiatives (`rpi_`) are optional; campaigns may attach to one (`campaigns.initiative_id`), and the mapping — not URL capture — is the contractual rollup path.
- **Justification:** Mandatory hierarchy taxes simple work; tags reintroduce name-matching. Optional structure matches actual usage (simple launch = one campaign; complex launch = initiative + campaigns).
- **Tradeoffs:** Two ways to model a launch means a judgment call (documented in the user manual §4).
- **Revisit trigger:** Consistent need for a level above initiatives (portfolio/quarter), or initiatives going unused entirely.

## 5. One registry / one API, multiple clients

- **Status:** Accepted
- **Context:** Single builder, bulk grid, paste, CSV, and future clients (browser helper, platform integrations) all generate links.
- **Options:** (a) per-surface generation logic; (b) shared client-side library; (c) one server-side service every entry point calls.
- **Decision:** All entry points call `previewLink`/`issueLink` in `src/services/links.ts`; bulk (`src/services/batches.ts`) wraps the same call per row.
- **Justification:** Exactly one implementation of normalization, validation, fingerprints, ID minting, duplicate policy, and audit — divergence is structurally impossible. Client-side logic couldn't enforce DB-backed duplicate checks or mint trusted IDs.
- **Tradeoffs:** Every client needs network access to the registry to create links (accepted: issuance is rare, clicks are common, and clicks don't need the registry).
- **Revisit trigger:** An offline-issuance requirement (would need signed deferred issuance, not client minting).

## 6. Direct landing URLs, no V2 redirect dependency

- **Status:** Accepted
- **Context:** Short links/redirects give vanity URLs and click-time control but add a runtime dependency to every click.
- **Options:** (a) redirect domain in front of all links; (b) optional redirects; (c) direct, self-describing URLs.
- **Decision:** V2 issues direct destination URLs carrying all identifiers. No registry, HubSpot, warehouse, or redirect lookup at click time; a registry outage never breaks existing links; issuance fails closed instead.
- **Justification:** The failure domain of "every click on every past campaign" is far worse than "cannot issue new links right now". Self-describing URLs also keep analytics capture independent of our infrastructure.
- **Tradeoffs:** Long URLs; no post-issuance destination switching (revisions regenerate the URL, but already-placed copies don't update); no vanity domains in V2.
- **Revisit trigger:** A hard requirement for vanity short links — explicitly a future availability-tier decision (see Open decisions), layered *on top of* self-describing URLs, never replacing them.

## 7. Human-readable UTMs + stable machine IDs

- **Status:** Accepted
- **Context:** Analysts eyeball URLs and platform UIs; machines need join keys.
- **Options:** (a) IDs only; (b) names only; (c) both on every URL.
- **Decision:** Every URL carries canonical human-readable `utm_source`/`utm_medium`/`utm_campaign` slugs *and* machine IDs (`utm_id`, optional `rp_*`).
- **Justification:** Debuggability and platform-UI legibility require names; reporting integrity requires IDs. The bytes are cheap.
- **Tradeoffs:** Redundancy invites the anti-pattern of reporting on names — countered by explicit contract language ([reporting-contract.md](reporting-contract.md) §8).
- **Revisit trigger:** Channel URL-length limits forcing a diet (mitigated first by the `url_length` warning and per-param policy).

## 8. Deterministic duplicate fingerprints

- **Status:** Accepted
- **Context:** Duplicate links silently split or double-count reporting. Detection must be immune to cosmetic variation and race conditions.
- **Options:** (a) UI-level warnings from list comparison; (b) app-level uniqueness checks; (c) canonicalized SHA-256 fingerprint with a DB partial unique index.
- **Decision:** `exactFingerprint` (`src/core/fingerprint.ts`) hashes canonicalized {destination (governed-stripped, query-sorted, trailing-slash-trimmed), initiative, campaign, canonical source/medium/campaign/content/term, preset, static params}; a partial unique index blocks exact dupes for active non-override links. Near-fingerprints and one-field-difference checks produce warnings.
- **Justification:** DB enforcement closes TOCTOU races that app checks leave open; canonicalization catches "same intent, different typing"; the override path (role-gated, reason-required, audited) preserves legitimate exceptions without weakening the default.
- **Tradeoffs:** Fingerprint inputs are versioned (`v: 1`) — changing canonicalization rules changes fingerprints and needs a migration story; overridden links are thereafter exempt from the unique index.
- **Revisit trigger:** Adding identity-relevant fields (new governed params, per-link static params) → bump the fingerprint version.

## 9. Immutable post-issuance revisions

- **Status:** Accepted
- **Context:** Issued links get edited (fixed destinations, corrected content); history must remain trustworthy.
- **Options:** (a) free in-place edits; (b) immutable links (edits = new links); (c) in-place current state + immutable revision records.
- **Decision:** Drafts edit in place. Issued links: every material change writes an immutable `rpr_` revision (full prior snapshot + field diff + reason + actor); the link ID and `utm_id` never change; registry edits never auto-update external platforms.
- **Justification:** New-link-per-edit would fragment reporting identity; free edits would destroy auditability. Keeping IDs stable across revisions preserves every already-placed URL's meaning.
- **Tradeoffs:** A revised URL differs from copies already pasted into platforms — deliberate (no remote mutation of external systems), but requires user awareness.
- **Revisit trigger:** If revision volume shows users treating revisions as versioned placements, reconsider guided "issue new link" flows.

## 10. Append-only audit history

- **Status:** Accepted
- **Context:** Governance claims are only as good as the history behind them.
- **Options:** (a) mutable activity log; (b) external audit service; (c) append-only table written transactionally with each change.
- **Decision:** `audit_events` (`rpa_`) written inside the same transaction as the change, with before/after snapshots, reason, correlation ID, config version, and secret-key redaction. The application exposes no update/delete path; production hardening (revoking UPDATE/DELETE at the DB role level) is an ops task.
- **Justification:** Same-transaction writes make "change without audit" impossible; append-only keeps investigations trustworthy.
- **Tradeoffs:** Unbounded growth (retention policy is an open decision); redaction is pattern-based, not exhaustive.
- **Revisit trigger:** Compliance requirements for tamper-evidence (hash chaining) or formal retention windows.

## 11. Versioned taxonomy & presets

- **Status:** Accepted
- **Context:** Governed vocabularies and platform adapters change over time; links issued under old rules must stay interpretable.
- **Options:** (a) hard-coded lists in code; (b) editable rows, no history; (c) DB-backed, versioned, audited rows + a global config version stamped onto links.
- **Decision:** Taxonomy, presets, destination policies, and settings live in versioned tables; every admin change bumps the global config version; links record `configVersion` at issuance. Seed data (`src/db/seed.ts`) is a starting point, fully editable in /admin. Disable/deprecate, never delete.
- **Justification:** Code deploys are the wrong cadence for vocabulary changes; version stamping answers "what rules produced this link" precisely.
- **Tradeoffs:** Config state reconstruction requires walking audit history rather than reading a snapshot table.
- **Revisit trigger:** If reconstruction becomes routine, add materialized config snapshots per version.

## 12. PostgreSQL + Vercel-compatible architecture (PGlite for dev, Drizzle)

- **Status:** Accepted
- **Context:** Needs relational integrity (partial unique indexes carry core invariants), Vercel serverless compatibility, and zero-friction local dev.
- **Options:** DBs: Postgres vs. SQLite vs. hosted-proprietary. ORM: Drizzle vs. Prisma vs. raw SQL. Dev DB: Docker Postgres vs. SQLite vs. PGlite.
- **Decision:** PostgreSQL in production (`DATABASE_URL`, node-postgres). Local dev without `DATABASE_URL` uses PGlite — real Postgres compiled to WASM, persisted at `.data/pglite` — running the *same* Drizzle migrations from `./drizzle`. Drizzle ORM + drizzle-kit for schema/migrations; migrations auto-apply on boot via `getDb()`.
- **Justification:** Partial unique indexes (duplicate blocking, HubSpot GUID uniqueness) are Postgres features the design depends on. PGlite gives `git clone && npm run dev` with zero infrastructure *and* dialect fidelity — no "works on SQLite, fails on Postgres" drift. Drizzle stays close to SQL and supports both drivers with one schema.
- **Tradeoffs:** PGlite is single-process (fine for dev); boot-time migration on serverless has cold-start/race caveats (mitigated by the explicit release-step recommendation in [deployment-vercel.md](deployment-vercel.md) §5).
- **Revisit trigger:** Provider approval outcome (Open decisions) may add pooling requirements; PGlite maturity issues would push dev to Docker Postgres.

## 13. Export-first platform support

- **Status:** Accepted
- **Context:** Links ultimately live in Google Ads, Meta, LinkedIn, HubSpot, etc. Writing into those platforms requires OAuth apps, scopes, review processes, and per-platform failure handling.
- **Options:** (a) live API writes per platform; (b) browser extension auto-fill; (c) presets shaping output + CSV/copy export.
- **Decision:** V2 is export-first: presets produce platform-shaped output (URL, tracking template, email link, QR target) with macro validation; users paste/upload into platforms. No live ad-platform writes.
- **Justification:** Ships governance value now without a per-platform integration program; keeps the failure domain small; the single-service architecture (ADR 5) leaves a clean seam for future adapters.
- **Tradeoffs:** Manual paste step; no automatic detection of URL drift inside platforms (partially covered by reconciliation against observed touches).
- **Revisit trigger:** Volume/error data justifying certified write integrations for specific platforms (see Open decisions: preset certification).

## 14. Async idempotent integrations with reconciliation

- **Status:** Accepted
- **Context:** External systems (HubSpot, warehouse) fail independently of the registry; retries must not create duplicates.
- **Options:** (a) synchronous calls in the request path; (b) fire-and-forget background jobs; (c) transactional outbox + idempotent processing + reconciliation.
- **Decision:** Outbox events (`rpo_`) are enqueued in the same transaction as the registry write (unique idempotency keys, duplicate enqueues are no-ops). A cron worker processes with exponential backoff (base 30 s, cap 6 h), max 8 attempts, then dead-letters. External clients are idempotent (HubSpot: lookup-before-create; warehouse: conflict-ignoring keyed insert). /admin offers manual retry; reconciliation runs (`rpx_`) enumerate unsynced mappings, missing snapshots, and dead-letters.
- **Justification:** Registry writes never wait on or roll back for third parties; retries are safe; drift is detectable rather than silent.
- **Tradeoffs:** Eventual consistency with external systems; operational surface (worker, cron, dead-letter handling).
- **Revisit trigger:** Event volume outgrowing the polling worker (→ queue infrastructure), or integrations needing ordering guarantees.

## 15. Raw identifier retention & repairable reporting

- **Status:** Accepted
- **Context:** Analytics capture fails in practice (missed custom dimensions, tag gaps). Reports must be repairable after the fact.
- **Options:** (a) store only normalized/derived state; (b) store raw emitted values verbatim, forever.
- **Decision:** `links` stores raw destination, final URL, and every emitted `utm_*`/`rp_*` value verbatim (including which policy-gated params were actually emitted); `warehouse_snapshots` versions registry state; `reconstructInitiativeReport` (`src/services/reconciliation.ts`) recovers initiative attribution from `utm_id` alone.
- **Justification:** You can always re-derive from raw; you can never un-lose it. Repairable-by-design turns capture failures from data loss into a join.
- **Tradeoffs:** Modest storage redundancy.
- **Revisit trigger:** A formal data-retention policy (Open decisions) may bound *audit* retention, but raw link values should outlive it.

## 16. Administrator-controlled public link/initiative IDs

- **Status:** Accepted (defaults: `rp_link_id` ON, `rp_initiative_id` OFF)
- **Context:** Extra public params buy analytics granularity at the cost of URL length and information exposure; the right balance may change.
- **Options:** (a) hard-code the param set; (b) per-link user choice; (c) global admin policy.
- **Decision:** `public_param_policy` setting, admin-editable, evaluated at issuance. Defaults: emit `rp_link_id`, omit `rp_initiative_id`. Links record what they actually emitted.
- **Justification:** Per-link choice would fragment analytics semantics; hard-coding would need a deploy to change. Link-level granularity is broadly useful (ON); initiative capture needs GA4 setup before it's worth URL bytes (OFF until then).
- **Tradeoffs:** Mixed-policy history requires reading the per-link emitted values; policy flips affect only future links.
- **Revisit trigger:** GA4 custom dimension registered and validated → consider enabling `rp_initiative_id` (the "public-param final policy" open decision).

## 17. Google OAuth (OIDC) as the production sign-in provider

- **Status:** Accepted (updated 2026-09-06; supersedes "interim" status)
- **Context:** Every Runpod employee has a Google Workspace account; Runpod's SaaS SSO catalog runs on Okta, but the UTM Builder pilot should not block on an Okta app registration. The earlier signed-header proxy adapter required standing up an identity-aware proxy that does not exist yet.
- **Options:** (a) identity-aware proxy with signed headers (previous decision); (b) in-app Google OAuth; (c) generic in-app OIDC defaulting to Google.
- **Decision:** (c). `AUTH_PROVIDER=google` runs the authorization-code flow in-app (`src/services/oidc.ts`): confidential-client code exchange over TLS, strict claim validation (iss/aud/exp/nonce/email_verified/allowed domain), HMAC-signed 12-hour session cookie. Issuer/client are env-configurable (`OIDC_*`), so switching to Okta later is configuration, not code. No auto-provisioning: sign-in requires an existing active `users` row, and roles are read from the database, never from IdP claims. The `dev` provider still refuses production, and the signed-header `sso` adapter is retained as an alternative.
- **Justification:** Removes the proxy dependency (the last deploy blocker), uses an IdP every employee already has, and keeps all route enforcement (`requireUser`/`requireRole`) provider-independent.
- **Tradeoffs:** Needs a Google Cloud OAuth client per environment and a `SESSION_SECRET`; id_token signature verification relies on the TLS-authenticated token endpoint rather than JWKS (acceptable for a confidential client receiving tokens directly from the issuer; JWKS verification is a hardening candidate). If IT later standardizes on Okta, the OIDC_* switch must be scheduled.
- **Revisit trigger:** IT/security standardizes internal-tool SSO on Okta, or a requirement emerges for JWKS signature verification / refresh-token sessions.

## 18. Browser side panel as the primary one-off adoption surface

- **Status:** Accepted
- **Context:** Campaign managers work across many browser-based platforms and will avoid a separate web app for one or two links.
- **Options:** (a) web app only; (b) DOM-injected platform controls; (c) a platform-neutral Chrome side panel capturing the current page/right-clicked link.
- **Decision:** Ship a Manifest V3 side panel using `activeTab`, context menus, and optional access only to the configured registry host. It calls `/api/v1`; it contains no UTM generation logic and never submits third-party forms.
- **Justification:** It removes tab-switch/copy friction across platforms without coupling V1 to frequently changing third-party DOMs or requiring broad permissions.
- **Tradeoffs:** Users still paste the issued link into the platform; private extension distribution and browser-management ownership are required.
- **Revisit trigger:** Measured usage identifies one platform workflow where certified autofill or a native API integration materially reduces errors.

## 19. Supported versioned API with idempotent issuance

- **Status:** Accepted
- **Context:** Extension, MCP, spreadsheet, and future adapters need a stable boundary, and network retries must not mint duplicate link records.
- **Options:** (a) reuse unversioned UI routes; (b) expose service code per client; (c) `/api/v1` with bearer scopes, stable errors, and idempotency.
- **Decision:** `/api/v1` delegates to existing services. Single issuance requires an actor-scoped `Idempotency-Key`; request hash and result link are stored in the same transaction. OpenAPI describes the supported surface.
- **Justification:** One boundary keeps clients thin and independently releasable. Transactional idempotency makes ambiguous retries safe without weakening semantic duplicate detection.
- **Tradeoffs:** API compatibility and token lifecycle become owned product commitments; idempotency records require retention cleanup later.
- **Revisit trigger:** A breaking contract change requires `/api/v2`; sustained high concurrency may justify a more explicit in-progress retry protocol.

## 20. PKCE extension auth and scoped personal tokens

- **Status:** Accepted (interim until organization OAuth is approved)
- **Context:** Machine and extension clients cannot safely rely on web cookies or long-lived shared secrets.
- **Options:** (a) shared API key; (b) personal tokens only; (c) short extension tokens via SSO/PKCE plus expiring personal tokens for API/MCP.
- **Decision:** The extension uses one-time, five-minute PKCE S256 authorization codes and eight-hour session-stored bearer tokens. API/MCP users mint per-user tokens (maximum 90 days). Only hashes are stored; tokens are scoped, revocable, usage-stamped, and audited at creation/revocation.
- **Justification:** Compromise is attributable and containable; the extension never persists its credential across browser restart. No organization OAuth provider is assumed prematurely.
- **Tradeoffs:** Personal token rotation is manual; a compromised browser session remains valid until expiry or revocation.
- **Revisit trigger:** Runpod approves an OAuth authorization server/client registration path for MCP and other machine clients.

## 21. MCP as a complementary governed client

- **Status:** Accepted
- **Context:** Agents can efficiently prepare/search many links, but granting a second implementation or silent write authority would undermine governance.
- **Options:** (a) no AI integration; (b) MCP with independent logic; (c) stateless MCP tools calling the shared registry services.
- **Decision:** Expose read/search/preview and narrowly scoped create/issue tools through authenticated Streamable HTTP. Every write tool requires explicit `confirmed=true`; single issuance also requires idempotency. No admin tools are exposed.
- **Justification:** Agents reduce clerical work while validation, duplicates, IDs, audit, and transactions remain server-enforced. MCP and browser extension solve different adoption moments.
- **Tradeoffs:** Client approval UX varies, and personal tokens are an interim authentication model.
- **Revisit trigger:** MCP client adoption, organization OAuth availability, or demand for a separately reviewed administrative tool surface.

## 22. Expand to a GTM Data MCP, keep PostgreSQL authoritative

- **Status:** Accepted
- **Context:** UTM creation is only one repeated GTM workflow. Agents and operators also need ownership, personnel/team/vendor mappings, platform accounts, integration context, data definitions, lineage, runbooks, reports, policies, and reusable bulk-change guidance. Putting all prose into MCP-specific storage would create another knowledge silo; putting operational identity into Notion would weaken relational controls.
- **Options:** (a) UTM-only MCP; (b) make Notion the sole MCP database; (c) broaden the existing MCP while preserving authority by data class.
- **Decision:** Rename the server **GTM Data MCP**. PostgreSQL owns stable operational records, relationships, source evidence, review state, templates, and UTM registry data. Notion remains a linked rich-document source. Secrets remain in approved secret storage. Live platform state remains authoritative in each platform/API.
- **Justification:** One governed access layer improves discovery without pretending every data class has the same authority. The typed record-plus-edge model accommodates new GTM domains without a schema migration per platform while preserving stable IDs, lifecycle, verification, version, sensitivity, and audit.
- **Tradeoffs:** Flexible JSON attributes need conventions and validation by record type; search quality depends on disciplined catalog maintenance; broad context increases permission-design importance.
- **Revisit trigger:** Attribute drift justifies dedicated typed tables for a high-volume record type, or a company data catalog becomes the approved operational authority.

## 23. Review-first source reconciliation with explicit field authority

- **Status:** Accepted
- **Context:** Notion and other internal sources change over time. Periodic blind mirroring could silently overwrite governed data, while manual-only maintenance goes stale. Scheduled delivery can also overlap or repeat.
- **Options:** (a) no scanning; (b) source overwrites registry; (c) evidence-preserving reconciliation with proposals and narrow auto-apply.
- **Decision:** Poll configured sources incrementally, retain raw normalized evidence and hashes, compute field-level proposals, and require approval by default. Auto-apply is allowed only for updates to existing matched records when every changed top-level field is explicitly allowlisted as authoritative. Connector leases, deterministic hashes, supersession, and optimistic record-version checks handle repeat/overlap/conflict safely.
- **Justification:** Detection and authority are separate questions. Review-first catches drift without promoting accidental edits to truth. Narrow field authority supports eventual low-friction maintenance after a source proves reliable.
- **Tradeoffs:** A review queue requires ownership and SLA; changes are eventually consistent; top-level `attributes` cannot yet be safely auto-applied at nested-field granularity.
- **Revisit trigger:** Stable high-volume connector history supports attribute-level policies, Notion webhooks become operationally approved, or review latency exceeds the business SLA.

## 24. Governed bulk-template library without platform write authority

- **Status:** Accepted
- **Context:** Teams need repeatable mass changes across Google Ads, LinkedIn, CM360, HubSpot, Meta, Reddit, and future platforms, but file formats and eligibility vary and live writes require separate OAuth/security reviews.
- **Options:** (a) prose-only instructions; (b) direct platform mutation tools; (c) versioned templates with generation, validation, documentation, and verification state.
- **Decision:** Store versioned bulk templates in PostgreSQL. MCP can list, generate, and validate them but cannot upload or mutate a platform. Seeded platform formats are `draft` until verified against a current account export and official docs; the internal Runpod review format is `verified`.
- **Justification:** Users gain reusable, Runpod-specific starting points and preflight checks without widening the MCP failure domain or claiming volatile third-party formats are permanently correct.
- **Tradeoffs:** A human still exports/imports files; draft templates need periodic certification; validation catches structural errors, not every platform business rule.
- **Revisit trigger:** Repeated usage data supports a separately approved write adapter for one platform, or a platform offers a stable, testable dry-run API.

## 25. One Slack app, two independent service paths

- **Status:** Accepted
- **Context:** Slack can reduce adoption friction for both deterministic UTM creation and exploratory GTM questions. Treating both as one conversational workflow would make link issuance depend on model tool choice; merging both backends would enlarge the failure domain.
- **Options:** (a) Slackbot MCP only; (b) `/utm` only; (c) one Slack app presenting deterministic UTM commands/shortcuts plus the separate GTM Data MCP.
- **Decision:** Use the **Runpod GTM Ops** Slack app. `/utm` and shortcuts call Builder services directly; Slackbot connects to the GTM Data MCP with Slack identity auth. Both repos and their non-Slack interfaces remain independent.
- **Justification:** Campaign managers get a predictable preview/confirm/reuse experience and 200-row CSV path, while users can ask contextual GTM questions without local agent setup. Shared backend services preserve validation, IDs, duplicate controls, roles, and audit behavior.
- **Tradeoffs:** Slack administrator approval and cross-service configuration are required; the bot needs narrowly justified scopes; batch completion relies on a follow-up DM.
- **Revisit trigger:** Slack workflow telemetry shows a different primary entry point, or Runpod standardizes an internal agent platform that can host deterministic forms without weakening issuance controls.

## 26. Map Slack identity to existing Builder users

- **Status:** Accepted
- **Context:** A signed Slack user ID proves the Slack caller but does not itself define UTM Builder roles or audit identity.
- **Options:** (a) auto-create users from Slack; (b) use a shared service account; (c) map verified Slack profiles to active Builder accounts.
- **Decision:** Resolve the signed Slack user through `users.info` work email, with an explicit administrator JSON mapping as fallback. Require an active Builder user and keep all roles in the Builder database.
- **Justification:** This preserves server-side authorization and per-person audit attribution without a second role system.
- **Tradeoffs:** Provisioning must keep work emails aligned; email lookup requires `users:read.email`; mapping drift can temporarily block a legitimate user, failing closed.
- **Revisit trigger:** Runpod SSO exposes a supported Slack-to-employee subject mapping or SCIM-backed identity service.

## 27. Pilot the reporting spine before activating every client

- **Status:** Accepted
- **Context:** The repository contains a broad set of useful interfaces, but organizational adoption, security approval, analytics capture, and operations mature at different speeds.
- **Options:** (a) launch every capability together; (b) remove later-stage capabilities; (c) preserve the shared architecture and activate capabilities in evidence-based phases.
- **Decision:** Call the product pilot-ready until operating gates are met. Pilot the web service, registry, IDs, bulk flow, taxonomy, GA4/PostHog capture, Snowflake delivery, and Mode QA first. Enable Slack, extension, API/MCP, reconciliation, and templates independently as approvals and adoption evidence justify them.
- **Justification:** This proves the reporting outcome without turning optional clients into launch blockers or discarding already isolated capabilities.
- **Tradeoffs:** Some users initially use a less embedded entry point; rollout state must be documented clearly.
- **Revisit trigger:** Two pilot review cycles meet the scorecard in `pilot-governance.md`.

## 28. Application snapshots are a staging contract, not Snowflake delivery

- **Status:** Accepted
- **Context:** The outbox currently writes `warehouse_snapshots` into application PostgreSQL. Calling that “warehouse sync” can lead analysts to assume Snowflake and Mode are already covered.
- **Options:** (a) treat Postgres snapshots as final reporting storage; (b) query the live app from Mode; (c) define a separately owned, monitored delivery boundary into Snowflake.
- **Decision:** Keep PostgreSQL snapshots as an idempotent staging boundary. Require an approved delivery job/connector, raw Snowflake landing table, conformed models, freshness checks, and Mode-facing views before reporting is production-ready.
- **Justification:** It separates application durability from analytics-pipeline delivery and makes the missing operational owner visible.
- **Tradeoffs:** Production reporting requires work outside this repository.
- **Revisit trigger:** Runpod chooses and implements the Snowflake ingestion path.

## 29. Explicit PostHog capture and cross-system verification

- **Status:** Accepted
- **Context:** A correctly generated URL can still lose parameters in redirects, routing, tag configuration, SDK persistence, or downstream exports.
- **Options:** (a) infer capture from the URL; (b) rely on undocumented SDK defaults; (c) explicitly parse/store governed fields and verify each stage.
- **Decision:** Require landing-event, session/current-touch, first-touch, and raw-URL semantics to be implemented explicitly for PostHog, with equivalent GA4 evidence and Snowflake join tests.
- **Justification:** Attribution durability depends on observed data, not generator output alone.
- **Tradeoffs:** Marketing-site and data-pipeline owners must implement and maintain the contract.
- **Revisit trigger:** SDK or analytics architecture changes, or capture completeness falls below the pilot threshold.

## 30. Conservative campaign duplicate detection with audited escape hatch

- **Status:** Accepted
- **Context:** Link fingerprints prevent duplicate URLs, but small campaign-name variations could still mint multiple `rpc_` IDs for one reporting concept.
- **Options:** (a) rely only on unique exact slugs; (b) fuzzy-match and auto-merge; (c) conservatively block deterministic punctuation/spacing variants and allow justified administrator overrides.
- **Decision:** Compare active/non-archived campaign names and slugs after case/punctuation normalization. Return candidates before creation. Only administrators may override, with a reason stored in `campaign.duplicate_override`.
- **Justification:** It closes a common registry-quality gap without risking opaque fuzzy auto-merges.
- **Tradeoffs:** More sophisticated semantic similarities remain a governance/search problem; legitimate variants require an admin exception.
- **Revisit trigger:** Pilot duplicate reviews show material false positives or missed patterns.

## 31. Production Slack workspace authorization fails closed

- **Status:** Accepted
- **Context:** Signed Slack requests authenticate a Slack app installation, but an empty tenant allowlist in production would otherwise accept any workspace able to reach the endpoints.
- **Decision:** Deny all production Slack identities unless `SLACK_ALLOWED_ENTERPRISE_IDS` or `SLACK_ALLOWED_TEAM_IDS` contains a match. Preserve unconfigured behavior only in local/test environments.
- **Justification:** A missed environment variable cannot silently widen the authorized organization.
- **Tradeoffs:** Misconfiguration blocks legitimate Slack use until corrected; web/API recovery paths remain available.
- **Revisit trigger:** Slack identity is enforced by an approved organization-wide gateway with equivalent or stronger controls.

---

## Open decisions

Not yet decided; each blocks or shapes production rollout:

1. **Approved SSO provider/proxy** — choose and configure the Runpod IdP integration that will emit the signed principal contract. Configuration and spoofing validation block production launch.
2. **Approved PostgreSQL provider** — Neon vs. Vercel Postgres vs. RDS vs. other; determines pooling, PITR mechanics, and network policy. Blocks production launch.
3. **Public-param final policy** — whether to enable `rp_initiative_id` (after GA4 custom dimension work) and whether `rp_link_id` stays on for all channels.
4. **Data retention** — retention windows for audit events, outbox/sync-attempt history, and reconciliation runs; raw link values are expected to be retained indefinitely.
5. **Approved destination domains list** — the production `approved`/`exception` domain set beyond the seeded `runpod.io` / `runpod.ai` / `docs.runpod.io`.
6. **Meta taxonomy convention** — whether `facebook-paid` remains canonical with `meta-*` aliases, or a governed migration to `meta-paid` canonical is scheduled.
7. **Preset adapter certification** — which presets get human-verified against current platform docs (macros, parameter behavior) and promoted from `draft` to `verified`, and on what review cadence.
8. **Monitoring/alerting ownership** — which team owns health, dead-letter, and reconciliation-discrepancy alerts, and in which alerting system.
9. **Vanity-domain availability tier** — requirements (uptime, ownership, fallback semantics) a redirect/short-link layer would have to meet. **Explicitly future work, not V2**: any such layer sits in front of self-describing URLs and must never become a click-time dependency for attribution.
10. **Extension distribution ownership** — private Chrome Web Store vs. enterprise browser policy, signing/release owner, and update SLA.
11. **MCP/API OAuth** — approved authorization server, client registration, token audience, and refresh/revocation expectations that can replace manual personal tokens.
12. **GTM catalog stewardship** — owner and review SLA for catalog records, restricted-data access, source proposals, and stale verification.
13. **Notion connector authority** — which Notion data sources/fields may progress from review-first to auto-apply, and who signs off.
14. **Bulk-template certification cadence** — owner and recertification frequency for each platform/account workflow.
15. **Snowflake snapshot delivery** — approved job/connector, raw table, owner, freshness SLA, schema-change policy, and replay/backfill runbook.
16. **GA4/PostHog capture ownership** — implementation owner, exact landing/session/first-touch semantics, consent behavior, and validation evidence.
17. **Mode certification** — owners and definitions for campaign, initiative, attribution, and operating-quality reports.
18. **V2 effective date and legacy posture** — pilot start date, historical crosswalk review owner, confidence thresholds, and treatment of active legacy links.
