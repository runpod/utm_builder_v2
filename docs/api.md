# Versioned API — `/api/v1`

The versioned API is the supported integration boundary for the browser extension, scripts, spreadsheet helpers, and future platform adapters. It delegates all URL creation to the same services as the web UI.

## Authentication and scopes

Create a personal token under **API access** in the web app. The plaintext token is shown once; only its SHA-256 hash is stored. Send it as:

Token scopes default to the scopes allowed by the user's current role. Investigator tokens are created successfully with the read-only subset; clients should inspect `/session` capabilities before presenting write actions.

```http
Authorization: Bearer rpt_...
```

Tokens are tied to a user, expire in 1–90 days, can be revoked immediately, update `lastUsedAt`, and preserve the user's identity on audited writes. Available scopes are:

| Scope | Allows |
|---|---|
| `utm:read` | Session, reference data, and registry search |
| `utm:preview` | Normalize, validate, and check duplicates without writing |
| `utm:issue` | Issue single links and batches |
| `utm:campaigns:write` | Create campaigns and their canonical `rpc_` IDs |
| `utm:initiatives:write` | Create initiatives and their canonical `rpi_` IDs |
| `gtm:read` | Read GTM catalog, ownership, lineage, definitions, readiness, and authorized source-update context through MCP |
| `gtm:templates` | List, generate, and validate governed GTM bulk-change templates through MCP |

The first-party web session may also call `/api/v1`; machine clients should always use bearer tokens. The MCP endpoint requires a bearer token and never falls back to cookies.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/openapi` | OpenAPI 3.1 discovery document |
| `GET` | `/api/v1/session` | Verify token and principal |
| `GET`, `POST` | `/api/v1/initiatives` | List or create initiatives |
| `GET`, `POST` | `/api/v1/campaigns` | List or create campaigns |
| `GET` | `/api/v1/taxonomy` | List governed sources and mediums |
| `GET` | `/api/v1/presets` | List platform presets and defaults |
| `POST` | `/api/v1/links/preview` | Validate, normalize, and detect duplicates without writing |
| `GET`, `POST` | `/api/v1/links` | Search or issue governed links |
| `POST` | `/api/v1/batches` | Issue up to the configured limit (maximum 200) with row isolation |

All responses are `Cache-Control: no-store` and include `X-Request-ID`. Errors use a stable envelope:

```json
{
  "error": { "code": "validation_failed", "message": "Link validation failed." },
  "findings": [],
  "requestId": "..."
}
```

## Preview then issue

Preview is read-only. It returns normalized input, the final URL preview, findings, and exact/near duplicate matches.

```bash
curl -X POST https://utm.runpod.io/api/v1/links/preview \
  -H "Authorization: Bearer $UTM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"destination":"runpod.io/product","campaignId":"rpc_...","presetKey":"linkedin","utmSource":"linkedin-paid","utmMedium":"paid","utmContent":"founder-video"}'
```

Issuance requires `Idempotency-Key` (8–200 characters). Repeating the same request with the same key returns the original registered link; reusing the key for different input returns `409`.

```bash
curl -X POST https://utm.runpod.io/api/v1/links \
  -H "Authorization: Bearer $UTM_TOKEN" \
  -H "Idempotency-Key: placement-2026-08-27-001" \
  -H "Content-Type: application/json" \
  -d '{"destination":"runpod.io/product","campaignId":"rpc_...","presetKey":"linkedin","utmSource":"linkedin-paid","utmMedium":"paid","utmContent":"founder-video"}'
```

An exact duplicate returns `409 exact_duplicate` with the existing link ID and URL. Callers should reuse it. Validation failures return `422` with field findings. Do not construct a URL from preview output and bypass issuance: only an issued response proves the registry transaction committed.

Campaign creation performs a conservative semantic duplicate check across active/non-archived names and slugs. A spacing/punctuation variant returns `409 campaign_duplicate` with `candidates`; reuse the matching campaign. An administrator may retry with `{"duplicateAction":"override","duplicateReason":"..."}` only when a genuinely separate reporting campaign is required. The override and candidate IDs are audited.

## Browser-extension CORS

Only `chrome-extension://<allowlisted-id>` origins receive CORS headers. Production requires `EXTENSION_IDS`; arbitrary websites cannot call the API cross-origin. Direct server clients are unaffected by browser CORS and still require bearer authorization.

## Compatibility

Additive fields may appear in `/api/v1` responses. Clients should ignore unknown fields. Breaking request/response or behavioral changes require `/api/v2`; taxonomy and preset changes are data/config versions and do not change the API version.

## Claude skill

A bundled Claude Agent Skill at `.claude/skills/utm-builder/` wraps this API so AI assistants issue governed links through `/api/v1` rather than hand-assembling `utm_*` strings. It is a client of this contract and holds no rules of its own. See [docs/claude-skill.md](claude-skill.md).
