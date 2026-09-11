# User Manual — Runpod UTM Builder & Registry V2

Audience: campaign managers and anyone issuing governed campaign URLs.

---

## 1. Core concepts

- **Campaign** — the canonical reporting unit. Created explicitly (never implicitly from a typed name). Gets an immutable ID `rpc_...` that is carried publicly in `utm_id`, and a canonical `utm_campaign` slug that is also immutable after creation. The display name can change freely.
- **Initiative** — an optional grouping layer above campaigns (`rpi_...`) for launches and GTM motions.
- **Link** — one governed URL (`rpl_...`) belonging to exactly one campaign. Immutable ID; edits to issued links create revisions, never new IDs.
- **The registry is the source of truth.** Issued URLs are self-describing — nothing resolves at click time — but the registry is the only place identifiers are minted and the only authoritative record of what was issued.

## 2. Creating a single link

1. **Search, then pick (or create) the campaign.** Links cannot be issued without a canonical campaign. The campaign supplies `utm_id` (its `rpc_` ID) and `utm_campaign` (its canonical slug); you do not type either. When a spacing/punctuation variant already exists, creation returns a candidate to reuse. Only an administrator can create a genuinely separate campaign, and must record why.
2. **Pick a preset** (defaults to `generic`). Presets can pre-fill `utm_source`/`utm_medium` and may require extra fields (e.g. Google Ads, LinkedIn, X Ads, Meta, and HubSpot/Email require `utm_content`).
3. **Enter the destination.** Bare domains, `www.` hosts, and `http://` URLs are accepted and normalized to HTTPS. Any query params or fragment you include are preserved — except governed params, which are replaced.
4. **Enter source / medium / content / term.** Source and medium must exist in the governed taxonomy (aliases are accepted with a warning and resolved to the canonical value).
5. **Preview.** The preview (`POST /api/links/preview`) is a dry run: it validates, checks for duplicates, and shows the final URL with a placeholder link ID (`rpl_PREVIEW`). It never writes anything.
6. **Issue.** Issuance is transactional and fail-closed: the real `rpl_` ID is minted server-side and the URL exists only if the registry commit succeeds. You can also save as **draft** — drafts are editable in place and are not counted as issued.

Investigators have a read-only version of this workflow: they can search, validate, preview, and copy an existing governed URL, while create, issue, reuse-recording, revise, retire, and bulk controls are unavailable.

The final URL always has governed parameters in this exact order:

```
utm_id, utm_source, utm_medium, utm_campaign, utm_content?, utm_term?,
rp_initiative_id? (admin policy, default OFF), rp_link_id? (admin policy, default ON)
```

## 3. Bulk creation

### Fast access from other tools

Use the browser extension when you need one URL while working in HubSpot or an ad platform: click the toolbar button for the current page, or right-click a link, then preview and issue from the side panel. In Slack, use `/utm [destination]` for one link or `/utm bulk` for a CSV of up to 200 rows. Use the web bulk flow for grid editing and exception repair. Approved scripts and AI tools use the versioned API/MCP server; every entry point creates the same registry records and cannot bypass validation or duplicate checks. See [browser-extension.md](browser-extension.md), [slack.md](slack.md), and [mcp.md](mcp.md).

All bulk paths produce one **batch** (`rpb_...`) and run every row through the exact same issuance service as the single builder. The batch limit is admin-configurable (default **200** rows).

Three input modes:

- **Grid** — type rows directly; use **fill-down** to copy a value (destination, source, medium, ...) down the column.
- **Spreadsheet paste** — paste tab-separated rows straight from a spreadsheet. Column order: `destination, source, medium, content, term`.
- **CSV upload** — same columns; standard CSV quoting is supported.

Behavior:

- Each row is its own transaction. **A bad row records a row-level error and never blocks or rolls back other rows.**
- Row statuses: `issued`, `error`, `skipped_duplicate` (an identical governed link already exists — the existing link's ID and URL are returned so you can reuse it).
- Batch status ends as `completed` or `completed_with_errors`.
- Use the **exception filter** to show only failed/skipped rows, fix them, and resubmit just those rows.
- **Export** the batch results to CSV to distribute the final URLs. Exports neutralize spreadsheet formula injection (cells starting with `=`, `+`, `-`, `@` are prefixed with `'`).

## 4. Initiative vs. campaign — which do I need?

| Situation | Structure |
|---|---|
| Simple launch, one story to tell | **One campaign**, many channels (many links under it). Report on `utm_id`. |
| Complex launch spanning several distinct motions (paid push, email sequence, event) that you also want to roll up | **One initiative + several campaigns.** Report per campaign on `utm_id`, roll up via the campaign→initiative mapping (or `rp_initiative_id` if enabled). |
| Evergreen/always-on activity | One campaign per motion; no initiative needed unless you want a rollup. |

Rule of thumb: if you'd ever want a single rollup number for "the launch" across multiple campaigns, create the initiative first and attach campaigns to it.

## 5. Reporting with exact IDs

- **Campaign performance:** filter on **equality** of `utm_id` (= the `rpc_` campaign ID). This is GA4's native session campaign ID dimension.
- **Launch/initiative rollup:** use `rp_initiative_id` (if the admin has enabled it and configured GA4 capture), or join observed `utm_id` values to the registry's campaign→initiative mapping.
- **PostHog:** the Runpod marketing site must explicitly retain `utm_id` and supporting URL values on landing and downstream events. Generation does not prove capture; confirm the event payload and Snowflake row.
- **Name filters (`utm_campaign` contains "...") are exploratory only.** Never build a recurring report on name substring matching — names drift, IDs don't. See [reporting-contract.md](reporting-contract.md).

## 6. Presets

Seeded presets (all editable by admins):

| Key | Output type | Default source/medium | Requires | Verification |
|---|---|---|---|---|
| `generic` | url | — | — | verified |
| `google_ads` | url | `google-ads` / `paid` | `utm_content` | draft |
| `linkedin` | url | `linkedin-paid` / `paid` | `utm_content` | draft |
| `x_organic` | url | `twitter-organic` / `organic` | — | draft |
| `x_paid` | url | `twitter-paid` / `paid` | `utm_content` | draft |
| `meta` | url | `facebook-paid` / `paid` | `utm_content` | draft |
| `reddit` | url | `reddit-paid` / `paid` | — | draft |
| `cm360` | tracking_template | `programmatic` / `paid` | — | draft |
| `hubspot_email` | email_link | `hubspot-email` / `email` | `utm_content` | draft |
| `event_qr` | qr_target | — / `event` | — | verified |

- Preset defaults fill blanks; anything you type explicitly wins.
- X keeps the historical canonical sources `twitter-organic` and `twitter-paid`; `x-organic` and `x-paid` remain accepted aliases that normalize to those values.
- Presets whitelist **macros** (e.g. `{keyword}` for Google Ads, `{{ad.id}}` for Meta). Using a macro the preset doesn't support is a blocking error.
- A `draft` preset issues links with a warning: it has not been verified against current platform documentation. A `deprecated` preset blocks issuance.

## 7. Normalization rules (before → after)

| Rule | Before | After |
|---|---|---|
| Bare domain → HTTPS | `runpod.io/gpu` | `https://runpod.io/gpu` |
| http → HTTPS | `http://runpod.io/gpu` | `https://runpod.io/gpu` |
| Host lowercased | `https://RunPod.io/GPU` | `https://runpod.io/GPU` (path case preserved) |
| Default ports stripped | `https://runpod.io:443/` | `https://runpod.io/` |
| Existing governed params replaced | `runpod.io/?utm_source=old&ref=x` | `https://runpod.io/?ref=x&utm_source=<governed>...` |
| Unrelated params preserved | `runpod.io/?ref=hn` | `https://runpod.io/?ref=hn&utm_id=...` |
| Fragments preserved | `runpod.io/gpu#pricing` | `https://runpod.io/gpu?utm_id=...#pricing` |
| UTM values canonicalized | `Summer Launch` | `summer-launch` (trim, lowercase, whitespace → hyphens) |

Rejected outright (blocking errors): empty destination, unparseable URLs, non-http(s) schemes, embedded credentials (`user:pass@`), localhost/private-network hosts, invalid hosts.

## 8. Errors vs. warnings catalog

**Errors block issuance.** **Warnings do not** — the link issues with `validationState = warnings`.

### Errors

| Code | Meaning |
|---|---|
| `destination_empty` | Destination URL is required |
| `destination_unparseable` | Not a valid URL |
| `destination_unsupported_scheme` | Only http/https supported |
| `destination_credentials_in_url` | Destination embeds credentials |
| `destination_private_network` | localhost / private-network address |
| `destination_invalid_host` | Host looks invalid |
| `destination_invalid` | Destination could not be normalized (fallback) |
| `domain_not_approved` | Host is not in the approved-domain list (ask an admin) |
| `missing_required_field` | `utm_source`/`utm_medium`/`utm_campaign` missing, or a field required by policy/preset (e.g. `utm_content`) |
| `missing_campaign` | No governed campaign selected — links cannot be issued without a canonical campaign ID |
| `medium_not_in_taxonomy` | Medium is not in the governed taxonomy |
| `medium_disabled` | Medium is deprecated/disabled |
| `source_not_in_taxonomy` | Source (and no alias) is not in the taxonomy |
| `source_disabled` | Source is deprecated/disabled |
| `source_medium_mismatch` | Source belongs to a different medium |
| `unknown_preset` | Preset key does not exist |
| `preset_deprecated` | Preset is deprecated |
| `malformed_macro` | Empty macro placeholder like `{}` |
| `unsupported_macro` | Macro not in the preset's supported list |
| `exact_duplicate` | Identical governed link already exists (see §9) |

### Warnings

| Code | Meaning |
|---|---|
| `governed_params_replaced` | Destination already had UTM/rp params; they will be replaced |
| `domain_exception` | Host is a permitted external-domain exception, not standard approved |
| `source_alias` | You typed an alias (e.g. `meta-paid`); the canonical source will be used |
| `value_contains_whitespace` | Value will be canonicalized with hyphens |
| `value_not_lowercase` | Value will be lowercased |
| `preset_draft` | Preset has not been verified against platform docs |
| `url_length` | Final URL exceeds the recommended maximum (default 900 chars) |
| `near_duplicate` | A very similar link exists (see §9) |

## 9. Duplicates: reuse vs. override vs. revision

Campaign creation also checks semantically equivalent names/slugs after normalizing case, punctuation, underscores, periods, spaces, and hyphens. Reuse the returned campaign whenever it represents the same reporting unit. An administrator may create a separate campaign only with a written justification; the new campaign, candidate IDs, actor, and reason are recorded as `campaign.duplicate_override`.

**Exact duplicates** — same fingerprint: normalized destination (governed params stripped, query sorted, trailing slash trimmed), initiative, campaign, canonical source/medium/campaign/content/term, preset, and preset static params. Blocked by a database unique index; timing games can't slip one through.

**Near duplicates** — warnings only: casing/punctuation/trailing-slash/query-order variants of the same intent, plus links in the same campaign differing in exactly one field.

| You want to... | Do this | What happens |
|---|---|---|
| Use the same URL again (email + social post, another doc) | **Reuse** the existing link | No new link; the reuse decision is recorded and audited. Same URL = same reporting rollup. |
| Track the same parameters as a genuinely separate placement | **Override** (if your role allows it) | New link with `duplicateOverride = true`; requires a written reason; fully audited. Both links now report under identical UTM values — use sparingly. |
| Fix or change an existing link (new destination, corrected content) | **Revise** the existing link | Immutable revision recorded (diff + reason + actor); link ID and `utm_id` unchanged; URL regenerated. |
| The "duplicate" is actually a different campaign/content | Change the differing field and issue normally | Different fingerprint — not a duplicate. |

Override authorization defaults to the `admin` role (admin-configurable). In bulk batches, exact duplicates become `skipped_duplicate` rows rather than failing the batch.

**Who can revise or retire:** the link's creator, the owning campaign's owner, or an administrator. Investigator accounts are read-only everywhere.

Campaign and initiative ownership may be transferred only by an administrator. The new owner must be an active `user` or `admin`, a written reason is required, and the before/after ownership state is recorded in the audit log.

**Revisions:** drafts are edited in place (still audited). Issued links get an immutable `rpr_` revision containing the prior snapshot, the field diff, your reason, and your identity. Revising **never** changes the link ID, `utm_id`, or any URL already placed in an external platform — the registry never auto-updates external platforms. If the revised URL matters, you must re-paste it wherever it is used.

## 10. Registry search and export

`GET /api/links` (and the registry UI) supports:

- **Free text** across final URL, destination, and all UTM fields.
- **Direct ID lookup** — paste any `rp*_` ID (link, campaign, initiative, batch) into the search box.
- Filters: campaign, initiative, batch, status (`draft`/`issued`/`retired`), validation state, platform preset, creator, source, medium, duplicate-override flag, created before/after.

**CSV export** (`GET /api/export/links`) honors the same filters and includes all identifiers, raw UTM values, the emitted `rp_*` params, platform, validation state, revision, and config version. Exports are audited. Note: an export returns at most 200 rows per request — narrow your filters for large registries.

## 11. ID glossary

| Prefix | Entity | Public exposure |
|---|---|---|
| `rpi_` | Initiative | Optionally on URLs as `rp_initiative_id` (default OFF) |
| `rpc_` | Campaign | Always on URLs as `utm_id` |
| `rpl_` | Link | Optionally on URLs as `rp_link_id` (default ON) |
| `rpb_` | Batch | Internal/registry |
| `rpr_` | Revision | Internal/registry |
| `rpv_` | Validation run | Internal/registry |
| `rpa_` | Audit event | Internal/registry |
| `rpu_` | User | Internal/registry |
| `rpo_` | Outbox event | Internal/registry |
| `rpx_` | Reconciliation run | Internal/registry |

All are prefixed ULIDs: 128-bit, collision-resistant, non-sequential (no counting of campaigns from IDs), sortable by creation time, and immutable.

## 12. State meanings

**Link validation state:**

| State | Meaning |
|---|---|
| `unvalidated` | No validation recorded (shouldn't occur for app-issued links) |
| `passed_syntactic` | All syntactic checks passed with no warnings |
| `warnings` | Issued with non-blocking warnings |
| `failed` | Validation failed (link was not issuable) |

Syntactic validation never marks a link "live" or "verified" — that vocabulary is reserved for future executed checks (HTTP/render/tag) with stored evidence.

**Campaign HubSpot sync state:**

| State | Meaning |
|---|---|
| `pending` | Queued, not yet attempted |
| `syncing` | Attempt in progress |
| `synced` | HubSpot campaignGuid recorded |
| `failed` | Last attempt failed; will retry automatically with backoff |
| `dead` | Gave up after max attempts; needs admin attention in /admin/integrations |
| `detached` | Intentionally not mapped |

A campaign that isn't synced to HubSpot is still fully usable — sync is asynchronous and never blocks link issuance.

## 13. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Identical governed link already exists" (409) | Exact duplicate. Reuse the existing link, or override with a reason if authorized. |
| `domain_not_approved` | Destination domain isn't on the approved list. Ask an admin to add it (as approved or exception). |
| `source_not_in_taxonomy` | Typo, or a genuinely new source. Check aliases first; ask an admin to add it. |
| `source_medium_mismatch` | E.g. `google-ads` with medium `organic`. Fix the medium or the source. |
| Batch shows `completed_with_errors` | Open the batch, apply the exception filter, fix the listed rows, resubmit only those. |
| Preview URL shows `rpl_PREVIEW` | Expected: real link IDs are minted only at issuance. |
| HubSpot state stuck at `pending`/`failed` | Worker/backoff timing or missing token. Links are unaffected; admins can retry from /admin/integrations. |
| Issuance fails entirely | Registry cannot commit (fail-closed by design). Retry once the registry is healthy; never hand-build URLs in the meantime. |
| Link edited but ad platform still shows old URL | Expected: registry edits never auto-update external platforms. Re-paste the revised URL. |
| `/utm` does not open a modal | The Slack app may need approval/reinstallation, the request URL may be stale, or the Builder may be unavailable. Use the web app and notify an administrator. |
| Slack says no active account is mapped | Your signed Slack profile email does not match an active Builder user. Ask an administrator to align the account or add an explicit mapping. |
| Bulk CSV was accepted but no DM arrived | Search the web registry by the batch ID if shown, then ask an administrator to inspect Slack delivery and function logs. Issued rows remain authoritative in the registry. |

## 14. GA4 examples

**Campaign report by exact ID** — GA4 natively reads `utm_id` into *session campaign ID* (`sessionCampaignId`):

- Explore → free-form → dimension **Session campaign ID** → filter `sessionCampaignId exactly matches rpc_01J9XYZABC...` → metrics: sessions, conversions.

**Initiative rollup via custom dimension** (requires the admin to enable `rp_initiative_id` and analytics to register the custom dimension — see [reporting-contract.md](reporting-contract.md)):

- Filter dimension **rp_initiative_id** `exactly matches rpi_01J9ABC...`.

**Recovery when `rp_initiative_id` wasn't captured** — join on `utm_id` instead. Export GA4 rows keyed by session campaign ID and map them through the registry:

```sql
SELECT r.initiative_id, SUM(g.sessions) AS sessions
FROM ga4_export g
JOIN registry_campaigns r ON r.campaign_id = g.session_campaign_id  -- utm_id
GROUP BY r.initiative_id;
```

The same repair is available programmatically via `reconstructInitiativeReport` (`src/services/reconciliation.ts`), which attributes raw touches from `rp_initiative_id` when present and falls back to the `utm_id` → campaign → initiative mapping.
