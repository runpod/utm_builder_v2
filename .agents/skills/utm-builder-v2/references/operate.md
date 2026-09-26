# Governed operation workflow

Use this workflow only when the repository's GTM Data MCP tools are available and authenticated for the current user. The exact schemas and current tool list live in `../../../../docs/mcp.md`; read that document before calling tools.

## Read-only work

1. List current reference data before selecting taxonomy, initiatives, or campaigns.
2. Search existing links and campaigns before proposing a new record.
3. Keep identifiers returned by the registry; do not infer them from display names.

Read-only requests do not require confirmation unless the host environment imposes a stricter rule.

## Create or issue

1. Resolve the user's destination, initiative, campaign, taxonomy, and optional content or term values from current registry data.
2. Search for the expected campaign and destination to expose existing records and duplicates.
3. Preview the link. Show the normalized URL, validation errors or warnings, duplicate result, and any material defaults.
4. Ask for explicit confirmation of the exact write when the user has not already confirmed that exact result.
5. Call the matching create or issue tool with `confirmed=true`. For single issuance, reuse one stable idempotency key for retries of the same intended write.
6. Return the registered ID and final URL supplied by the service. State clearly whether the result was newly issued or an existing exact duplicate was reused.

Never bypass preview or confirmation, hand-construct a URL and call it issued, or retry with a new idempotency key after an uncertain response.

## Batch issuance

Preview and summarize the batch first, including row-level errors and duplicate outcomes. Confirm the concrete batch before issuing it. Preserve the service's per-row results and do not imply that failed rows were written.

## Reporting and audit

Use exact `utm_id` values as durable join keys and keep raw observed values as evidence. Treat downstream capture and warehouse transformation as separate from registry issuance. Read `../../../../docs/reporting-contract.md` before recommending queries, attribution logic, or recovery behavior.

## Stop conditions

Stop before writing when authentication is missing, permissions are insufficient, required registry values cannot be resolved, preview reports validation errors, or the user's confirmation no longer matches the proposed write. Explain the blocker and the next safe action.
