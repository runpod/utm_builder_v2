---
name: utm-builder-v2
description: >-
  Generate governed, deduplicated Runpod campaign URLs through the UTM Builder
  registry API instead of hand-crafting UTM query strings. Use whenever a task
  needs a tracked marketing/campaign link — building a UTM link, "tag this URL",
  adding utm_source/medium/campaign, a paid-ad or email or social destination
  URL, a bulk set of tracked links, or looking up an existing campaign/link in
  the registry. Also use when another workflow (e.g. a campaign builder) needs
  UTM-stamped destination URLs. Every link goes through the shared API so it
  gets a canonical campaign ID (utm_id), taxonomy validation, duplicate
  protection, and an audit record — never assemble utm_* parameters by hand.
---

# UTM Builder — governed campaign links via the registry API

The Runpod UTM Builder owns one authoritative campaign/link registry and one
server-side generation API. This skill calls `/api/v1`; it holds **no** URL,
UTM, or ID logic of its own. That is the point: identifiers, normalization,
taxonomy, duplicate fingerprints, and audit all live server-side, so links this
skill issues are consistent with the web app, the bulk grid, and Slack.

## The one rule

**Never hand-assemble `utm_*` query strings.** A hand-made link has no canonical
campaign ID, bypasses taxonomy and duplicate checks, and leaves no audit record —
which is exactly what this system exists to prevent. Always resolve/create a
campaign and issue the link through the API below.

## Setup

- **Base URL**: the deployment origin (e.g. `https://utm-builder-runpod.vercel.app`), configurable per environment.
- **Auth**: a personal access token from the app's **API access** page, sent as `Authorization: Bearer rpt_...`. Tokens are user-scoped, expire in 1–90 days, and carry only the scopes the user's role allows.
- Confirm the token and its capabilities first with `GET /api/v1/session` before offering write actions.

## Core workflow (single link)

1. **Resolve the campaign.** `GET /api/v1/campaigns`, find the intended one, and use its `id` (an `rpc_…` value). If none fits, create one explicitly with `POST /api/v1/campaigns` (`{ "name": "..." }`) — **never** invent a campaign just because a name was typed; creation is always deliberate. The campaign's `id` is what rides in `utm_id`.
2. **Preview.** `POST /api/v1/links/preview` with the destination, `campaignId`, `utmSource`, `utmMedium`, optional `utmContent`/`utmTerm`, and optional `presetKey`. The response returns the normalized destination, the assembled `finalUrl`, `validation.findings`, and any `duplicates`. Surface errors/warnings to the user before issuing.
3. **Issue.** `POST /api/v1/links` with the same body **plus an `Idempotency-Key` header** (any stable unique string for the attempt; required). On success you get the committed `link` including its `finalUrl`, `id` (`rpl_…`), and `utmId`.

`utmSource`/`utmMedium` must be values from the governed taxonomy (`GET /api/v1/taxonomy`); a `presetKey` from `GET /api/v1/presets` can fill sensible defaults.

## Bulk

`POST /api/v1/batches` with `{ "source": "csv"|"paste"|"grid", "rows": [ ...up to 200 link objects... ] }`. One batch ID is returned; a bad row fails alone without dropping the others.

## Search the registry

`GET /api/v1/links?...` (scope `utm:read`) — filter by any ID, UTM field, platform, status, dates, etc. Prefer this over guessing whether a link already exists.

## Handling responses

- **`201`** — issued. Use `link.finalUrl`; report `link.utmId` as the reporting key.
- **`409 exact_duplicate`** — an identical governed link exists (`existingLinkId`, `existingUrl`). Reuse it; do not reissue. Only override with an explicit `duplicateAction: "override"` + `duplicateReason`, and only if the token's role permits.
- **`409 campaign_duplicate`** — a near-identical campaign exists (`candidates`). Reuse one instead of creating another.
- **`422 validation_failed`** — blocked; read `findings[]` (bad domain, missing field, taxonomy miss, malformed macro). Fix and retry.
- **`400 invalid_request`** — body failed schema (`issues[]`). **`429 rate_limited`** — back off.

## Reporting

Report and group by **exact `utm_id`** equality (the `rpc_` campaign ID), never by substring-matching `utm_campaign` names. For launches spanning multiple campaigns, group by initiative. See `docs/reporting-contract.md`.

For the full endpoint table, scopes, request/response schemas, and copy-paste examples, read [reference.md](reference.md). The live OpenAPI document is at `GET /api/v1/openapi`.
