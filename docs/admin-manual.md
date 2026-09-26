# Administrator Manual — Runpod UTM Builder & Registry V2

Audience: administrators (`admin` role) and investigators (`investigator` role, read-only).

Every admin mutation described here is server-side role-checked, audited (before/after + optional reason), and bumps the global configuration version where it changes generation behavior.

---

## 1. Taxonomy management

The governed taxonomy lives in `taxonomy_mediums` and `taxonomy_sources` (seeded from `src/db/seed.ts`, editable at runtime — nothing is hard-coded).

- **Add a source:** `POST /api/admin/taxonomy` with `kind: "source"`, a slug, the owning `mediumSlug`, and optional label/description/aliases. New sources default to `active`.
- **Add a medium:** same endpoint with `kind: "medium"`.
- **Deprecate / disable:** set `status` to `deprecated` or `disabled`. Both block new issuance with that value (`source_disabled` / `medium_disabled`); the distinction is intent — `deprecated` means "being phased out", `disabled` means "do not use".
- **Aliases:** each source carries an alias list. A user typing an alias gets a `source_alias` warning and the canonical slug is written to the link. Aliases keep old muscle memory working without fragmenting reporting.

### Meta rename playbook (and any platform rename)

When a platform renames itself (Facebook → Meta, Twitter → X):

1. **Add the new name as an alias** of the existing canonical source (e.g. add `meta-paid` to `facebook-paid`'s aliases — already seeded).
2. **Keep the canonical slug unchanged.** Historical reporting continuity beats naming fashion; the canonical value is what lands on URLs.
3. **Never delete the old source.** Deleting breaks the alias resolution and orphans historical links. If you eventually want the new name to be canonical, create the new source, move the old slug into the *new* source's aliases, and set the old source to `deprecated` — but treat that as a migration project with reporting sign-off, not a rename.

### Disabling bad taxonomy values safely

**Disable ≠ delete.** Setting a source or medium to `disabled`:

- Blocks all *new* links from using it.
- Leaves every existing link untouched — issued URLs are self-describing and the registry rows keep their raw values.
- Is reversible and fully audited.

There is no delete path in the application, deliberately.

## 2. Initiatives and campaigns

- Campaigns are created explicitly (`POST /api/campaigns`); the `rpc_` ID and the canonical `utm_campaign` slug are immutable after creation. Metadata (display name, owner, dates, lifecycle, product, description, initiative attachment) is editable via `PATCH /api/campaigns/{id}`.
- Administrators can assign an active write-capable owner during creation or transfer ownership later from the campaign/initiative detail page. Transfers require a reason and emit `campaign.owner_transferred` or `initiative.owner_transferred`. Investigators cannot own writable records.
- Initiatives (`rpi_`) are the optional layer above campaigns; same immutability rule for the ID.
- Lifecycle values: `planned`, `active`, `completed`, `archived`. Lifecycle is metadata — it does not currently block issuance; retire individual links or disable taxonomy values to stop usage.
- `utm_campaign` slugs are globally unique (DB constraint). Before insertion, the service also checks active/non-archived campaign names and slugs using a conservative semantic key that collapses case, punctuation, periods, underscores, spaces, and hyphens. Users receive candidates to reuse.
- Only an administrator may bypass a semantic campaign duplicate warning. A non-empty reason is required and `campaign.duplicate_override` records the new campaign, actor, candidate IDs, and reason. Do not override merely to satisfy separate platform naming; one reporting campaign may have many links and external mappings.

## 3. External mappings (HubSpot)

Campaign creation automatically creates a `hubspot` mapping shell (`pending`) plus an outbox event; the HubSpot campaignGuid arrives asynchronously.

- The DB enforces: one non-null external ID (system + type + ID) maps to **at most one** campaign.
- HubSpot is a *mapping*, not the identity: the Runpod `rpc_` ID is canonical, the GUID is a foreign key into HubSpot.
- Mapping states: `pending → syncing → synced`, with `failed` (auto-retry) and `dead` (manual attention) on the error path; `detached` marks intentionally unmapped campaigns.
- View mappings on the campaign detail (`GET /api/campaigns/{id}`); manage failures in /admin/integrations (see §8).

## 4. Destination policies

`destination_policies` holds domains with kind:

- **`approved`** — normal issuance target (seeded: `runpod.io`, `runpod.ai`, `docs.runpod.io`). Subdomains match automatically (`foo.runpod.io` matches `runpod.io`).
- **`exception`** — permitted external domain (e.g. a partner landing page). Issues with a `domain_exception` warning instead of silently passing, so exceptions stay visible.

Any other domain fails with `domain_not_approved` (only enforced once at least one approved domain exists). Manage via `POST /api/admin/destinations` (`domain`, `kind`, optional notes/status/reason). Disabling a policy row removes it from enforcement without deleting history.

Note: private-network/localhost destinations are blocked in code regardless of policy.

## 5. Preset management

Presets (`platform_presets`) define per-platform behavior: default source/medium, required fields, supported macros, static params (which participate in duplicate fingerprints), output type, and docs URL. Manage via `POST /api/admin/presets`.

Verification states:

| State | Effect |
|---|---|
| `draft` | Usable; every issuance carries a `preset_draft` warning ("not verified against platform documentation") |
| `verified` | Clean issuance. Set this only after a human has checked the preset against current platform docs (macro list, parameter behavior) |
| `deprecated` | Blocks issuance (`preset_deprecated`) |

Only `generic` and `event_qr` ship as `verified`. Certifying the rest (checking macros against Google/Meta/LinkedIn/Reddit/CM360/HubSpot docs) is an open decision — see [decisions.md](decisions.md).

## 6. Public-ID policy

Setting: `public_param_policy` (defaults `{ rp_link_id: true, rp_initiative_id: false }`).

| Toggle | Enabling means | Cost / risk |
|---|---|---|
| `rp_initiative_id` ON | Initiative rollups work directly in GA4 (once the custom dimension is registered) without registry joins | Longer URLs; exposes initiative existence/timing in public URLs; requires GTM/gtag capture work before it's useful (see [reporting-contract.md](reporting-contract.md)) |
| `rp_link_id` OFF | Shortest possible URLs | Loses per-link (per-placement) analytics granularity; per-link click attribution then requires distinct utm_content values |

The policy is evaluated at issuance: changing it affects **future** links only. Each link records which params it actually emitted (`rp_link_id_param`, `rp_initiative_id_param`), so mixed-policy history stays interpretable. Revisions retain the params the link was issued with.

Change via `POST /api/admin/settings` with `key: "public_param_policy"`. Other settings on the same endpoint: `bulk_limit` (default 200), `required_fields` (e.g. `["utm_content"]` globally), `duplicate_override_roles` (default `["admin"]`), `recommended_max_url_length` (default 900), `feature_flags`.

## 7. Roles and users

| Role | Can |
|---|---|
| `user` | Create initiatives/campaigns/links/batches, revise/retire links, search/export the registry |
| `admin` | Everything, plus: all /admin configuration, user/role management, duplicate override (by default), outbox retry, reconciliation, config export |
| `investigator` | Read-only access to search, previews, audit events, outbox/integration state, settings, and reconciliation runs. No mutations — enforced server-side and reflected in the web, Slack, extension, and API-token interfaces. Investigator-minted tokens are restricted to read-only scopes. |

Manage users via `POST /api/admin/users` (email-keyed upsert: name, role, active). Deactivating (`active: false`) blocks sign-in without deleting history. Role changes are audited with the distinct action `user.role_changed`.

All enforcement is server-side (`requireUser` / `requireRole` in every route); there are no client-only checks to bypass.

## 8. Failed integrations (outbox operations)

Screen: /admin/integrations, backed by `GET/POST /api/admin/outbox` and `GET/POST /api/admin/reconcile`.

**Outbox event states:** `pending` (due/queued) → `processing` → `succeeded`, or `failed` (auto-retry after backoff) → `dead` (after `maxAttempts`, default 8).

**Retry schedule:** exponential backoff, base 30 s, doubling per attempt, capped at 6 h (30s, 1m, 2m, 4m, ... 6h). Every attempt is recorded in `sync_attempts`.

**Manual retry:** `POST /api/admin/outbox` with `{ "action": "retry", "eventId": "rpo_..." }` marks a failed/dead event due immediately and processes the queue. Retries are safe: idempotency keys are unique in the DB and the HubSpot client looks up by exact campaign name before creating, so a retried event never creates a second HubSpot campaign.

**Reconciliation:** `POST /api/admin/reconcile` runs a full comparison and stores an `rpx_` run. It flags:

- `hubspot_mapping_unsynced` — campaigns whose HubSpot mapping never reached `synced`
- `missing_warehouse_snapshot` — issued links without the application PostgreSQL staging snapshot (backfillable via outbox retry). This check does not prove downstream Snowflake delivery.
- `outbox_dead_letter` — events that failed permanently, with the final error

Investigators can read runs; only admins trigger them.

## 9. Audit investigations

### API, extension, and MCP access

- Users create and revoke personal API/MCP tokens under **API access**. Plaintext is shown once; only a hash is stored. Each token is user-scoped, expiring, and its use remains attributable through normal audit events.
- Browser-extension tokens are issued through the SSO + PKCE flow, expire after eight hours, and are visible/revocable in the same token list.
- Set `EXTENSION_IDS` in production. An empty allowlist disables production extension redirects/CORS.
- For an incident, revoke the affected token first, then filter audit events by actor and time. Bearer-authenticated writes store the access-token record as `context.credentialId`; `lastUsedAt` narrows the activity window, and issued records identify every URL affected.
- MCP exposes no admin/configuration tools. Any future administrative integration requires a separate decision and narrower scopes.
- The repository's Codex skill is instruction-only and grants no access by itself. Live operations still use the MCP token's Builder user, role, and scopes; onboarding and verification are documented in [codex-skill.md](codex-skill.md).

Audit events (`rpa_`) are append-only, written in the same transaction as the change they describe, with before/after snapshots (secret-looking keys are redacted) and optional reason and correlation ID. Query via `GET /api/admin/audit`; add `format=csv` for export.

Filter recipes:

| Question | Query |
|---|---|
| Who overrode duplicates? | `?action=link.duplicate_override` — each event carries the actor, reason, new link ID, and the overridden link in `context.existingLinkId` |
| Who created a duplicate campaign? | `?action=campaign.duplicate_override` — event carries the administrator, reason, new campaign, and candidate campaign IDs |
| All changes to a link | `?entityType=link&entityId=rpl_...` — issuance, revisions, retirement, overrides; revisions also carry the field-level diff |
| Role changes | `?action=user.role_changed` — before/after role, actor, reason |
| Everything one person did | `?actor=<email or rpu_ id>` plus `after`/`before` date bounds |
| All config changes in a window | `?entityType=setting&after=...&before=...` (also `taxonomy_source`, `taxonomy_medium`, `platform_preset`, `destination_policy`) |
| One bulk batch end-to-end | `?q=rpb_...` — batch events plus per-row issuance via correlation IDs `rpb_...:<rowIndex>` |

Useful action names: `link.issued`, `link.draft_created`, `link.revised`, `link.retired`, `link.duplicate_override`, `link.duplicate_reused`, `batch.created`, `batch.completed`, `campaign.created`, `campaign.duplicate_override`, `campaign.updated`, `campaign.owner_transferred`, `initiative.created`, `initiative.updated`, `initiative.owner_transferred`, `taxonomy.source.created/updated`, `taxonomy.medium.created/updated`, `preset.created/updated`, `destination_policy.created/updated`, `setting.updated`, `user.created/updated/role_changed`, `outbox.retry_requested`, `reconciliation.run`, `config.exported`, `registry.exported`.

Slack actions use these same events rather than a parallel log. Their correlation IDs begin with `slack:`; the actor is the existing Builder user resolved from the signed Slack user. Review the batch ID for CSV requests. Slack request bodies, bot tokens, signing secrets, and uploaded CSV contents are not copied wholesale into audit events.

## GTM Data MCP administration

Screen: `/admin/gtm-data`, backed by `GET/POST /api/admin/gtm-data`.

### Catalog

The catalog supports these record types: `person`, `team`, `agency`, `vendor`, `system`, `account`, `integration`, `data_term`, `data_field`, `measurement_asset`, `runbook`, `policy`, and `report`.

Every record has a stable type/key, display name, summary, flexible JSON attributes, lifecycle, sensitivity, verification state, source/freshness metadata, version, and audited creator/updater. Use `restricted` only for operationally sensitive information; never put tokens, secrets, passwords, or authentication headers in attributes.

Recommended account attributes include platform account ID, account name, environment, rep/CSM names and contact routes, APIs in use, billing owner, and support tier. Store a link/reference to secrets, never the secret itself.

### Relationships

Relationships form the ownership and lineage graph. Recommended types:

| Purpose | Relationship types |
|---|---|
| Accountability | `owns`, `operates`, `approves`, `backup_for`, `escalates_to` |
| Organization | `member_of`, `agency_for`, `vendor_for`, `account_of` |
| Systems and data | `integrates_with`, `upstream_of`, `downstream_of`, `consumes`, `produces`, `uses_api` |
| Documentation | `documented_by`, `defined_by` |

Write relationships in the direction that reads naturally: `team owns system`, `system documented_by runbook`, `source_field upstream_of report`. Do not create duplicate inverse edges unless the inverse carries distinct meaning.

### Readiness

The MCP readiness check currently requires an active lifecycle and an owner/operator to avoid an error; lack of verification, runbook, or reviewed source changes produces warnings. Treat this as a minimum control, not proof that a platform integration or report is technically healthy.

### Bulk templates

The library seeds one verified internal review format plus draft platform starting points. Draft means usable for planning and validation, not certified for upload. Before promoting one to `verified`:

1. Export a current file from the target Runpod account.
2. Compare headers, object scope, row limits, encoding, identity columns, and update semantics.
3. Test a small reversible change in a non-critical object.
4. Link the exact official documentation and record reviewer/date.
5. Add a rollback template or procedure where the platform supports it.

Google Ads Editor supports CSV import with a proposed-changes review flow; LinkedIn bulk tools may be limited to eligible managed accounts; CM360 uses exported campaign spreadsheets; HubSpot record updates should use unique record IDs. Meta and Reddit seed entries are intentionally planning formats pending account-specific workflow verification.

### Source connectors and detected updates

New connectors start paused and review-first. Configure the Notion source, mapping, and token reference, scan manually, review results, then activate. Approve/reject requires a reason and is audited. Never turn on auto-apply without a narrow authoritative-field allowlist and an owner sign-off.

The scheduled route uses connector leases and deterministic hashes, so repeat or overlapping cron deliveries are safe. A failed source scan leaves the governed catalog untouched and retries on the next due schedule. Full setup and failure semantics: [source-reconciliation.md](source-reconciliation.md).

Additional audit actions include `gtm_catalog.created/updated`, `gtm_relationship.created/updated`, `gtm_bulk_template.created/updated`, `gtm_connector.created/updated`, and `gtm_source_update.applied/rejected`.

## 10. Configuration versioning semantics

- A single global counter (`config_versions`, row id=1) is bumped inside the same transaction as **every** admin change that affects generation: settings, taxonomy, presets, destination policies.
- Every issued link records the `configVersion` in force at issuance, and audit events record the version at change time.
- This gives you an exact answer to "what rules produced this link": find the link's `configVersion`, then query audit events with that `configVersion` and earlier to reconstruct the config state.
- Revisions deliberately retain the link's issuance-time config version.
- Individual rows (settings, taxonomy entries, presets, policies) also carry their own per-row `version` counters.

## 11. Backup and recovery expectations

- **Database:** production runs on managed PostgreSQL with point-in-time recovery (PITR) — see [deployment-vercel.md](deployment-vercel.md). The registry (links, campaigns, revisions, audit) is only recoverable via database backups; treat PITR configuration as a launch blocker.
- **Configuration export:** `GET /api/admin/export` returns a JSON snapshot of settings, taxonomy, destination policies, and presets (audited as `config.exported`). Take one after any significant config change and before risky changes. It is a convenience for rebuild/diff — not a substitute for PITR.
- **Audit export:** `GET /api/admin/audit?format=csv` with date bounds, for investigations and retention snapshots.
- Issued URLs keep working during any recovery — they never depend on the registry at click time. The recovery risk is registry data (audit, mappings), not live traffic.

## 12. Incident procedures

### Registry outage (DB down)

1. Impact: no new issuance (fails closed), no registry reads. **Existing links keep working** — no click-time dependency.
2. Do not hand-build URLs as a workaround; they would bypass fingerprints, IDs, and audit.
3. Restore the database (provider PITR/failover). On recovery, verify `GET /api/health`, then run reconciliation (§8) to confirm outbox/snapshot consistency.

### HubSpot outage or token expiry

1. Impact: campaign syncs accumulate as `failed` in the outbox. Issuance, links, and reporting by `utm_id` are unaffected.
2. Fix credentials (`HUBSPOT_ACCESS_TOKEN`) or wait out the outage; backoff retries continue automatically for up to 8 attempts.
3. For `dead` events after a long outage: manual retry from /admin/integrations, then run reconciliation and confirm zero `hubspot_mapping_unsynced` discrepancies.

### Bad configuration change

1. Identify the change: audit query `?entityType=setting` (or taxonomy/preset/policy entity types), newest first. The event holds the exact before/after values and the config version it created.
2. Roll back by re-applying the `before` value through the same admin endpoint — this is a *new* audited change that bumps the version again. Never edit the database directly; that would break the version/audit chain.
3. Links issued while the bad config was live are identifiable by `configVersion` (registry search/export includes it). Assess whether any need revision or retirement.
4. If the config export (§11) predates the incident, diff against it to catch collateral changes.

## Onboarding via Okta (Marketing rollout)

Access has two layers. **Okta app assignment** decides who can authenticate (managed by IT; the app is assigned to the Marketing group). **The `users` table** decides roles. With `OIDC_AUTO_PROVISION=true` (the rollout setting), a first-time Okta sign-in creates the person as a low-privilege `user` automatically and records `auth.oidc_provisioned` in the audit log — no administrator action is needed for them to create campaigns, initiatives, and links. Promote to `admin` or `investigator` in **Admin → Users**. To remove someone's access before IT unassigns them in Okta, **deactivate** them in Admin → Users: deactivated accounts are never re-created or reactivated by signing in.
