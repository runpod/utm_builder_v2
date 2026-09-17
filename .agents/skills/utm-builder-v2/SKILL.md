---
name: utm-builder-v2
description: "Use for explaining, planning, operating, debugging, or documenting this repository's governed UTM Builder v2 workflows, including initiatives, campaigns, link issuance, duplicates, bulk operations, reporting, Slack, API, and GTM Data MCP. Do not use for unrelated generic UTM advice."
---

# UTM Builder v2

Treat the repository's implementation and documentation as the source of truth. Do not invent registry records, identifiers, taxonomy values, permissions, production status, or behavior that has not been verified.

## Route the request

- For user workflows, terminology, picker behavior, campaign reassignment, presets, duplicates, and bulk issuance, read `../../../docs/user-manual.md`.
- For live agent operations and MCP tool contracts, read `../../../docs/mcp.md`, then follow [the governed operation workflow](references/operate.md).
- For attribution, joins, GA4/PostHog, Snowflake/Mode, or recovery logic, read `../../../docs/reporting-contract.md`.
- For Slack, API, administration, or deployment questions, read the matching file: `../../../docs/slack.md`, `../../../docs/api.md`, `../../../docs/admin-manual.md`, or `../../../docs/deployment-vercel.md`.
- For code changes or diagnosis, inspect the relevant implementation and tests first. Start with `../../../src/services/links.ts`, `../../../src/services/campaigns.ts`, `../../../src/contracts/public-api.ts`, and `../../../src/mcp/server.ts` as applicable. Make the smallest safe change and run proportionate tests, type checks, and builds.

## Preserve the domain model

- The implemented hierarchy is Initiative -> Campaign -> Link. A campaign belongs to at most one initiative.
- `utm_campaign` is globally unique. Represent variations within a campaign with fields such as `utm_content` or `utm_term`, not duplicate campaign names.
- Reassigning a campaign changes the grouping for future links. Existing issued links retain the initiative recorded when they were issued.
- The campaign picker favors planned and active campaigns. Completed and archived campaigns remain available through search.
- Public identifiers are immutable prefixed ULIDs: initiatives use `rpi_`, campaigns use `rpc_`, and links use `rpl_`. Issued URLs use the campaign ID in `utm_id`.
- Previewing does not write. Issuance is fail-closed and transactional.
- Exact duplicates reuse the existing link by default. Authorized overrides require a reason and remain auditable.

## Set accurate expectations

Distinguish implemented behavior from planned work. This repository documents a proof of concept and its production-readiness requirements; do not describe a personal or test deployment as the production system. When documentation and code disagree, report the mismatch and cite the current implementation rather than silently choosing one.

When the live GTM Data MCP tools are unavailable, provide guidance or prepare inputs only. Do not claim to have searched, created, moved, or issued anything.
