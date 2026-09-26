# Claude skill — governed UTM links for AI agents

The repository ships a Claude [Agent Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) at
[`.claude/skills/utm-builder-v2/`](../.claude/skills/utm-builder-v2/SKILL.md). It teaches Claude Code and other
skill-aware agents to generate governed campaign links **through the `/api/v1`
registry** rather than hand-assembling `utm_*` query strings — making an AI
assistant just another well-behaved client of the one authoritative registry,
alongside the web app, bulk grid, Slack, and browser extension.

## Why it exists

An agent left to its own devices will happily concatenate
`?utm_source=…&utm_medium=…`. Such a link has no canonical campaign ID, skips
taxonomy and duplicate checks, and leaves no audit trail — the exact failure
modes this project removes. The skill redirects that instinct to the shared API,
so agent-issued links get a canonical `utm_id`, validation, duplicate
protection, and an audit record identical to any human-issued link.

## Contents

| File | Purpose |
|---|---|
| `.claude/skills/utm-builder-v2/SKILL.md` | Trigger description + the core resolve-campaign → preview → issue workflow, the "never hand-craft UTMs" rule, error handling, and reporting guidance |
| `.claude/skills/utm-builder-v2/reference.md` | Full endpoint table, scopes, request/response schemas, and copy-paste curl/Node examples |

The skill contains no URL, UTM, or ID logic of its own; it delegates entirely to
the server, so it stays correct as the rules evolve.

## Enabling it

- **Claude Code in this repo**: skills under `.claude/skills/` are discovered automatically; no install step.
- **Elsewhere / other agents**: copy the `utm-builder-v2` folder into the consuming project's `.claude/skills/`, or package it per your agent runtime's skill mechanism.

## Configuration the operator provides

The skill needs two things at use time, supplied by the user/agent environment (never hard-coded in the skill):

1. **Base URL** — the deployment origin (e.g. `https://utm-builder-runpod.vercel.app`).
2. **Bearer token** — a personal access token from the app's **API access** page. Tokens are user-scoped, expire in 1–90 days, are revocable, and carry only the scopes the user's role allows. An agent should call `GET /api/v1/session` first to confirm the token and its capabilities.

## Relationship to the other integration docs

- [`docs/api.md`](api.md) — the underlying `/api/v1` contract the skill wraps.
- [`docs/mcp.md`](mcp.md) — the MCP server, a complementary agent surface for the GTM catalog and templates; the skill focuses on link generation.
- [`docs/reporting-contract.md`](reporting-contract.md) — how the `utm_id` the skill returns is used as the durable reporting key.
- [`docs/codex-skill.md`](codex-skill.md) — the Codex counterpart (`.agents/skills/utm-builder-v2/`). The two are per-agent siblings of the same capability: Claude Code discovers this one under `.claude/skills/`, Codex discovers its own under `.agents/skills/`.

## Safety

The skill inherits every server-side guarantee: taxonomy enforcement, exact/near
duplicate detection, fail-closed issuance, role and scope checks, and the
append-only audit log. An agent cannot bypass these — it can only ask the API,
and the API refuses anything ungoverned. Duplicate overrides still require an
explicit reason and a role that permits them.
