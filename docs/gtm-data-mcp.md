# GTM Data MCP

The **GTM Data MCP** is the governed access layer for Runpod's go-to-market operating context. UTM governance is its first operational module, not its entire scope.

It answers questions such as:

- Who owns or operates this platform, account, report, field, or process? Who is the backup or escalation contact?
- Which agency or vendor supports it, and what is their role?
- What are the account identifiers, account team contacts, and APIs in use?
- What does a metric or field mean, where does it originate, and which reports consume it?
- Which Runpod-approved mass-change template applies to a platform workflow?
- Is this system/report/integration operationally ready?
- Has Notion or another registered source changed since the catalog was reviewed?
- Does a proposed campaign URL conform to UTM governance, and is it a duplicate?

## Architecture boundary

The MCP is not a document store and does not copy secrets into an AI-specific database.

| Information | Authority |
|---|---|
| UTM campaigns, links, IDs, taxonomy, source evidence, catalog relationships, and review state | PostgreSQL registry |
| Rich narratives and operating documents | Notion or another registered source, linked by source URL/ID |
| Credentials and API secrets | Runpod-approved secret manager / Vercel environment variables; the catalog stores only a credential reference |
| Live platform state | The platform API, when a future approved adapter is added |
| Agent access | GTM Data MCP tools over the governed services above |

This separation keeps the MCP useful without turning it into another source of truth.

## Endpoint and authentication

- Streamable HTTP endpoint: `https://<registry-host>/api/mcp`
- Server name: `runpod-gtm-data`
- Authentication: `Authorization: Bearer rpt_...`
- Create/revoke a token under **API access** in the web app; choose **MCP client**.
- The endpoint is stateless and POST-only. Browser cookie sessions are not accepted.

Generic client configuration:

```json
{
  "mcpServers": {
    "runpod-gtm-data": {
      "url": "https://utm.runpod.io/api/mcp",
      "headers": {
        "Authorization": "Bearer ${RUNPOD_GTM_DATA_TOKEN}"
      }
    }
  }
}
```

Use the secret-management syntax supported by the client. Never commit a production token.

Codex users can pair this server with the repository's `$utm-builder-v2` skill. The skill supplies Runpod-specific operating guidance; this MCP server supplies live tools and enforces the user's Builder identity and scopes. See [codex-skill.md](codex-skill.md) for installation, secure client configuration, verification, and troubleshooting.

## Tool inventory

### GTM operating context (read-only)

| Tool | Behavior |
|---|---|
| `gtm_search_catalog` | Searches people, teams, agencies, vendors, systems, accounts, integrations, terms, fields, measurement assets, runbooks, policies, and reports |
| `gtm_get_record` | Returns one record plus active relationships |
| `gtm_resolve_ownership` | Resolves owners, operators, approvers, backups, agencies, vendors, and escalation contacts |
| `gtm_get_personnel_map` | Returns people, teams, agencies, and vendors with their active responsibility relationships |
| `gtm_get_account_context` | Finds platform account IDs, contacts, APIs, owners, supporting firms, integrations, and runbooks |
| `gtm_get_measurement_inventory` | Returns measurement assets, systems, integrations, reports, ownership, and lineage |
| `gtm_trace_lineage` | Traverses upstream/downstream relationships up to four levels |
| `gtm_get_data_definition` | Searches business-term and technical-field definitions |
| `gtm_find_runbooks` | Finds active operating, incident, escalation, and recovery runbooks |
| `gtm_check_readiness` | Checks lifecycle, verification, owner/operator, runbook linkage, and pending source updates |
| `gtm_list_source_updates` | Lists source changes awaiting review; cannot approve or apply them |

Restricted catalog records are returned only to users with the `admin` or `investigator` role. Secrets must never be stored in catalog attributes, even on restricted records.

### Mass-change assistance (read/validate only)

| Tool | Behavior |
|---|---|
| `gtm_list_bulk_templates` | Lists governed templates, constraints, documentation, and verification state |
| `gtm_generate_bulk_template` | Produces CSV headers and safe examples |
| `gtm_validate_bulk_change` | Validates headers, required values, allowed values, and row limits without uploading anything |

Seeded templates cover Runpod review, Google Ads Editor, LinkedIn Campaign Manager, Campaign Manager 360, HubSpot imports, and planning formats for Meta and Reddit. Only the internal Runpod template ships verified. Platform templates remain `draft` until checked against a current export and current official documentation.

### UTM governance module

| Tool | Behavior |
|---|---|
| `utm_list_reference_data` | Lists initiatives, campaigns, presets, sources, and mediums |
| `utm_search_links` | Searches the canonical link registry before creating a possible duplicate |
| `utm_create_initiative` | Creates and audits an initiative; requires `confirmed=true` |
| `utm_create_campaign` | Creates and audits a campaign and canonical `rpc_` ID; requires `confirmed=true` |
| `utm_preview_link` | Normalizes, validates, and checks duplicates; never writes |
| `utm_issue_link` | Issues one link, mints `rpl_`, and logs it; requires confirmation and an idempotency key |
| `utm_issue_batch` | Issues 1–200 rows with row-level isolation; requires confirmation |

## Scopes

| Scope | Access |
|---|---|
| `gtm:read` | Catalog, relationships, definitions, readiness, and source-update visibility |
| `gtm:templates` | List, generate, and validate bulk-change templates |
| `utm:read` | UTM reference data and registry search |
| `utm:preview` | Non-writing URL preview/validation |
| `utm:issue` | Confirmed link and batch issuance |
| `utm:campaigns:write` | Confirmed campaign creation |
| `utm:initiatives:write` | Confirmed initiative creation |

Create a least-privilege token when a client only needs discovery or templates. Existing UTM-only tokens continue to work for UTM tools, but need rotation/reissuance before they can use the new GTM scopes.

## Deliberate non-capabilities

The MCP cannot:

- edit users, roles, taxonomy, policies, connectors, catalog records, or relationships;
- approve/reject a detected source update;
- retrieve credentials or API secrets;
- upload a mass-change file or mutate Google Ads, Meta, LinkedIn, Reddit, CM360, HubSpot, or another platform;
- mark a draft platform template as verified;
- bypass UTM validation, duplicate controls, confirmation, idempotency, or audit.

Those operations require an authenticated administrator and, where appropriate, a separately reviewed platform adapter.

## Recommended agent behavior

1. Search before assuming a name, definition, owner, or account ID.
2. Report the record's verification state and source/freshness metadata when it affects confidence.
3. For bulk changes, prefer a `verified` template. If the template is `draft`, state that it must be reconciled with a current platform export before upload.
4. For UTMs, list reference data, search for duplicates, preview, show findings, obtain approval, then issue with a stable idempotency key.
5. Treat pending source proposals as signals for an administrator—not as established truth.

## Token operations

- Prefer one token per person/client/device so compromise is attributable and independently revocable.
- Use the shortest practical expiry.
- Rotate before expiry and revoke the replaced token.
- Investigate unexpected `lastUsedAt` activity immediately.
- Replace personal bearer tokens with Runpod-approved organization OAuth when available.
