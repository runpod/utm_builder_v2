# Pilot, Governance, and Adoption Plan

This is the operating plan for moving UTM Builder & Registry V2 from a working application to a trusted company process. Product capability and organizational adoption are separate deliverables; production readiness requires both.

## Current maturity

**Status: pilot-ready software, not yet an operational standard.** The shared generation service, registry, identifiers, validation, duplicate controls, audit trail, bulk workflow, and optional clients are implemented. Production use still depends on Runpod decisions for SSO, PostgreSQL, ownership, taxonomy approval, downstream capture, and support.

| Stage | Meaning | Exit evidence |
|---|---|---|
| Built | Core functions exist and automated tests pass | Application test/build evidence |
| Pilot-ready | Security, data, and operating owners approve a limited pilot | Named owners, approved environment, pilot cohort, measurement plan |
| Operational | Governed links are the default for in-scope work | Adoption and data-quality thresholds met for two review cycles |
| Scaled | More channels and clients can be enabled safely | Per-channel certification, support capacity, stable reporting joins |

The browser extension, API, MCP, repository Codex skill, Slack, source reconciliation, and bulk-template library remain modular clients or capabilities. They do not need to be activated together. The Codex skill may be used for repository guidance without MCP; live registry use follows the same MCP approval and token controls as any other client.

## Pilot scope

The first pilot should prove the smallest end-to-end system that improves reporting:

- one production Builder/Registry service and PostgreSQL database;
- SSO-backed users and named administrators;
- canonical campaigns and `utm_id`, optional initiatives, one-link and bulk issuance;
- approved source/medium taxonomy and two certified channel presets;
- registry snapshots delivered to Snowflake;
- `utm_id` and supporting parameters captured in GA4 and PostHog;
- one Mode validation report and one operating-quality scorecard.

Choose 5–10 campaign managers across Marketing Operations, paid media, lifecycle/email, and one agency or vendor workflow. Use live but bounded campaigns whose reporting can be independently checked. The web application is the baseline entry point. Add Slack during the pilot only if the internal app, scopes, identity mapping, and owner are approved; otherwise it becomes the first adoption expansion.

## Minimum governance policy

1. **Mandatory use:** All new in-scope external campaign links must be issued by the registry after the pilot effective date. Exceptions require an owner and expiry date.
2. **Reuse before create:** Users search for an existing initiative, campaign, and link first. Exact links are reused. Semantically equivalent campaign names are blocked; only an administrator can create a separate campaign with an audited reason.
3. **Stable identity:** `rpc_` campaign IDs and issued `rpl_` link IDs are never reassigned. Display names may change; reporting joins use IDs.
4. **Controlled taxonomy:** Administrators own source, medium, preset, domain, and public-parameter changes. Deprecate values instead of rewriting historical records.
5. **Bulk parity:** Bulk rows receive the same validation, duplicate checks, identifiers, audit, and failure isolation as one-link issuance.
6. **No quiet bypass:** A hand-built or platform-created URL discovered after the effective date is labeled `unregistered`, triaged, and either registered/remediated or documented as an exception. It is not silently treated as governed.
7. **Agency/vendor access:** Each external user maps to an accountable internal owner, receives least-privilege access, and has a documented onboarding/offboarding date.
8. **Change control:** Production configuration changes require a reason, reviewer for high-impact changes, and a post-change smoke test. Audit history is never edited.

## Roles and responsibilities

| Role | Accountable for |
|---|---|
| Executive sponsor | Mandate, conflict resolution, adoption support |
| Marketing Operations owner | Product/process owner, taxonomy, training, exceptions, support |
| Analytics owner | GA4/PostHog capture, Snowflake models, Mode definitions, data QA |
| Platform/Engineering owner | SSO, database, deployment, monitoring, recovery, integrations |
| Channel owner | Preset certification and platform-specific operating procedure |
| Campaign manager | Correct campaign selection, link issuance, pre-launch verification |
| Agency/vendor lead | External-user compliance and issue escalation |
| Security/IT reviewer | Access model, Slack/extension/API approvals, secret handling |

Names and backups must be recorded before the pilot starts. “Marketing” or “Data” alone is not an owner.

## Pilot acceptance scorecard

Report these weekly, by entry point and channel:

| Measure | Initial pilot target |
|---|---|
| Governed adoption | ≥90% of new in-scope campaign URLs issued or reused through the registry |
| Capture completeness | ≥98% of eligible GA4 landing sessions and PostHog landing events with a governed URL retain valid `utm_id` |
| Registry join coverage | ≥98% of captured `rpc_` values join to exactly one campaign snapshot in Snowflake |
| Initiative coverage | 100% of pilot launch campaigns that require roll-up map to one intended initiative |
| Duplicate control | 100% of exact duplicates reused/blocked; every campaign override has an administrator and reason |
| Speed | Median single-link completion ≤2 minutes; accepted 200-row file completes without manual row-by-row entry |
| Reliability | No issued URL without a committed registry row; no unresolved dead letter older than one business day |
| Exceptions | All unregistered or malformed pilot URLs have an owner and disposition within two business days |

Targets are starting gates, not immutable SLAs. Change them only through the pilot review with evidence.

## Rollout phases

### Phase 1 — foundation pilot

Approve SSO/database, owners, effective date, taxonomy, two presets, GA4/PostHog capture, Snowflake ingestion, and one Mode report. Train the cohort and run two weekly reviews.

### Phase 2 — channel expansion

Certify additional presets against current platform behavior, add campaign teams and agencies, then enable the lowest-friction approved clients (Slack, extension, and/or Codex with MCP). Keep web and CSV as recovery paths. Codex onboarding follows [codex-skill.md](codex-skill.md); the skill itself does not grant production access.

### Phase 3 — operational reporting

Publish the governed dimensions for general Mode use, add exception/drift monitoring, establish a monthly taxonomy review and quarterly recovery exercise, and retire legacy generators for in-scope users.

## Assumptions to validate

These are hypotheses, not established facts:

- campaign managers will accept registry selection when search and bulk creation are fast;
- `utm_id` reaches GA4 and PostHog before a redirect or application route removes it;
- the approved Snowflake ingestion path can meet the agreed freshness SLA;
- campaign and initiative definitions align with Finance, Marketing, RevOps, and analytics reporting needs;
- Slack or the extension materially improves adoption enough to justify its approval and support cost.

Record results in the pilot scorecard. A failed hypothesis should change the rollout, not be hidden by changing the metric.

## Required reviews before “operational” status

- Marketing Operations: governance, taxonomy, exception workflow
- Analytics/Data: capture contract, warehouse model, Mode outputs, historical posture
- Platform/Engineering: deployment, monitoring, backups, recovery evidence
- Security/IT: SSO and any Slack, extension, API, or MCP access
- Two pilot campaign managers plus one agency/vendor representative: usability and operating fit

Related documents: [reporting-contract.md](reporting-contract.md), [historical-migration.md](historical-migration.md), [deployment-vercel.md](deployment-vercel.md), and [admin-manual.md](admin-manual.md).
