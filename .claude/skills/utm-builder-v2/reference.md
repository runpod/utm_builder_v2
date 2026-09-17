# UTM Builder API reference (for the `utm-builder-v2` skill)

All paths are under the deployment origin. Send `Authorization: Bearer rpt_…` on
every request. This mirrors [`docs/api.md`](../../../docs/api.md); the live,
authoritative schema is `GET /api/v1/openapi` (OpenAPI 3.1).

## Scopes

| Scope | Allows |
|---|---|
| `utm:read` | Session, taxonomy, presets, registry search |
| `utm:preview` | Normalize/validate/duplicate-check without writing |
| `utm:issue` | Issue single links and batches |
| `utm:campaigns:write` | Create campaigns (mint `rpc_` IDs) |
| `utm:initiatives:write` | Create initiatives (mint `rpi_` IDs) |

A token cannot exceed its user's role. Investigator tokens receive only the
read-only subset — inspect `GET /api/v1/session` capabilities before offering writes.

## Endpoints

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/api/v1/openapi` | — | OpenAPI discovery document |
| GET | `/api/v1/session` | (any) | Verify token + principal + capabilities |
| GET | `/api/v1/taxonomy` | `utm:read` | Governed sources and mediums |
| GET | `/api/v1/presets` | `utm:read` | Platform presets and their defaults |
| GET, POST | `/api/v1/initiatives` | `utm:read` / `utm:initiatives:write` | List or create initiatives |
| GET, POST | `/api/v1/campaigns` | `utm:read` / `utm:campaigns:write` | List or create campaigns |
| POST | `/api/v1/links/preview` | `utm:preview` | Validate/normalize/dedupe, no write |
| GET, POST | `/api/v1/links` | `utm:read` / `utm:issue` | Search or issue governed links |
| POST | `/api/v1/batches` | `utm:issue` | Issue up to 200 links in one batch |

## Request bodies

**Link** (preview, issue, and each batch row):

```json
{
  "destination": "https://www.runpod.io/serverless",
  "campaignId": "rpc_01J...",
  "utmSource": "linkedin-paid",
  "utmMedium": "paid",
  "utmContent": "founder-video",   // optional
  "utmTerm": "gpu-cloud",          // optional
  "presetKey": "linkedin",         // optional; from /api/v1/presets
  "duplicateAction": "override",   // optional; requires role + reason
  "duplicateReason": "..."         // required with override
}
```

- `destination` accepts a bare domain, `www.`, or full URL; the server normalizes to HTTPS, preserves unrelated query params + fragments, and strips/replaces any existing governed `utm_*` params.
- `campaignId` is mandatory — resolve it from `/api/v1/campaigns` or create the campaign first.

**Campaign** (`POST /api/v1/campaigns`): `{ "name": "2026 Q3 Product Launch", "initiativeId"?: "rpi_…", "product"?, "campaignType"?, "startDate"?, "endDate"?, "description"? }`. `utmCampaign` defaults to the canonicalized name.

**Initiative** (`POST /api/v1/initiatives`): `{ "name": "2026 Product Launch", "product"?, "initiativeType"?, "startDate"?, "endDate"?, "description"? }`.

**Batch** (`POST /api/v1/batches`): `{ "source": "csv" | "paste" | "grid", "rows": [ <link object>, ... ] }` (1–200 rows).

## Examples

Resolve or create a campaign, then issue a link (curl):

```bash
BASE="https://utm-builder-runpod.vercel.app"
TOKEN="rpt_..."

# 1. find an existing campaign
curl -s "$BASE/api/v1/campaigns" -H "Authorization: Bearer $TOKEN"

# 2. (only if none fits) create one explicitly
CID=$(curl -s "$BASE/api/v1/campaigns" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"2026 Q3 Product Launch"}' | jq -r .campaign.id)

# 3. preview
curl -s "$BASE/api/v1/links/preview" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"destination\":\"runpod.io/serverless\",\"campaignId\":\"$CID\",\"utmSource\":\"linkedin-paid\",\"utmMedium\":\"paid\",\"utmContent\":\"founder-video\"}"

# 4. issue (Idempotency-Key header is required)
curl -s "$BASE/api/v1/links" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"destination\":\"runpod.io/serverless\",\"campaignId\":\"$CID\",\"utmSource\":\"linkedin-paid\",\"utmMedium\":\"paid\",\"utmContent\":\"founder-video\"}"
```

Node (fetch):

```js
const base = process.env.UTM_BASE, token = process.env.UTM_TOKEN;
const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const body = {
  destination: "runpod.io/serverless",
  campaignId: "rpc_01J...",
  utmSource: "linkedin-paid",
  utmMedium: "paid",
  utmContent: "founder-video",
};

// preview first
const preview = await fetch(`${base}/api/v1/links/preview`, { method: "POST", headers: h, body: JSON.stringify(body) }).then(r => r.json());
if (!preview.ok) console.warn(preview.validation.findings);

// then issue
const res = await fetch(`${base}/api/v1/links`, {
  method: "POST",
  headers: { ...h, "Idempotency-Key": crypto.randomUUID() },
  body: JSON.stringify(body),
});
if (res.status === 409) {
  const dup = await res.json();          // reuse dup.existingUrl instead of reissuing
} else {
  const { link } = await res.json();     // link.finalUrl, link.id (rpl_), link.utmId (rpc_)
}
```

## Error codes

| Status | `error.code` | Meaning / action |
|---|---|---|
| 201 | — | Issued. Use `link.finalUrl`; `link.utmId` is the reporting key. |
| 400 | `invalid_request` | Body failed schema; inspect `issues[]`. |
| 401 | `unauthorized` | Missing/expired/revoked token. |
| 403 | `forbidden` | Token lacks the scope, or role can't do this. |
| 409 | `exact_duplicate` | Identical link exists (`existingLinkId`, `existingUrl`) — reuse it. |
| 409 | `campaign_duplicate` | Near-identical campaign exists (`candidates`) — reuse one. |
| 422 | `validation_failed` | Blocked; fix per `findings[]`, then retry. |
| 429 | `rate_limited` | Back off and retry. |

## ID glossary

`rpi_` initiative · `rpc_` campaign (carried in `utm_id`) · `rpl_` link (optional public `rp_link_id`) · `rpb_` batch. All are prefixed ULIDs, immutable, non-sequential.
