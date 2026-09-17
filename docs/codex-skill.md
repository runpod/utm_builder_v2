# Codex skill — installation and setup

The repository includes a project-scoped Codex skill at [`.agents/skills/utm-builder-v2`](../.agents/skills/utm-builder-v2). It gives Codex the Builder's current domain model, documentation routes, implementation entry points, and safe MCP operating sequence.

The skill and the GTM Data MCP have different jobs:

| Component | What it provides | What it does not provide |
|---|---|---|
| Repository skill | Builder terminology, rules, documentation routing, code context, and the approved search/preview/confirm workflow | Registry access, credentials, or permission to write |
| GTM Data MCP | Authenticated tools for live registry search, preview, campaign/initiative creation, and link issuance | A separate UTM implementation or a bypass around Builder roles and validation |
| Builder access token | The current user's scopes and audit identity | New permissions beyond the user's active Builder account and role |

The skill is useful without MCP for explanation, planning, documentation, reporting guidance, and repository work. Live registry operations require both a reachable MCP endpoint and an authorized token.

## 1. Install the repository skill

Prerequisites: a local Codex client that supports skills—the ChatGPT desktop app, Codex CLI, or Codex IDE extension—and access to this repository.

```bash
git clone https://github.com/runpod/utm_builder_v2.git
cd utm_builder_v2
git switch main
```

Open the repository root, or any directory beneath it, as the Codex working directory. No separate skill copy or package installation is required: Codex discovers repository skills under `.agents/skills` between the working directory and Git root.

Verify discovery in one of these ways:

- ChatGPT desktop app: open **Skills** in the sidebar and look for **UTM Builder v2**.
- Codex CLI or IDE extension: run `/skills` or type `$utm-builder-v2` in the prompt.
- If the skill does not appear after pulling an update, restart the Codex client and confirm the working directory is inside this Git repository.

Do not copy this skill to a global skill directory. Its instructions intentionally resolve the code and documentation relative to this repository. A future standalone distribution should be packaged separately and remove that repository-relative assumption.

Official behavior and discovery locations: [Build skills — OpenAI](https://learn.chatgpt.com/docs/build-skills).

## 2. Use the skill without live registry access

Invoke it explicitly when you want predictable routing:

```text
Use $utm-builder-v2 to explain whether these campaign and initiative names follow the current model.
```

```text
Use $utm-builder-v2 to investigate this Builder bug, make the smallest safe fix, and run the relevant checks.
```

Codex may also select the skill automatically when a request matches its description. Without GTM Data MCP access, Codex should prepare or explain work only; it must not claim it searched, created, moved, or issued a live registry record.

## 3. Add live GTM Data MCP access

Complete these prerequisites first:

1. Use an approved Builder deployment and confirm the user has an active Builder account.
2. In the web app, open **API access**, create a dedicated token, and choose **MCP client**.
3. Grant only the scopes needed for the intended work. Read-only discovery uses `gtm:read` and/or `utm:read`; previews add `utm:preview`; writes require the matching issuance, campaign, or initiative scope.
4. Store the plaintext token once in the approved local secret mechanism. Never commit it to this repository or paste it into shared documentation.

In Codex, open **Settings → MCP servers → Add server**, select **Streamable HTTP**, name it `runpod-gtm-data`, and enter:

```text
https://<registry-host>/api/mcp
```

Configure bearer-token authentication using the token created above, save, and restart the client. For a file-based local configuration, add this to `~/.codex/config.toml` and make the named variable available to the environment that starts Codex:

```toml
[mcp_servers.runpod-gtm-data]
url = "https://<registry-host>/api/mcp"
bearer_token_env_var = "RUNPOD_GTM_DATA_TOKEN"
default_tools_approval_mode = "writes"
```

Use the actual approved registry host. Do not put the token itself in `config.toml`, a repository-scoped `.codex/config.toml`, shell history, or screenshots. Codex MCP configuration is shared by the desktop app, CLI, and IDE extension on the same Codex host. See [Model Context Protocol — OpenAI](https://learn.chatgpt.com/docs/extend/mcp) and [the Builder MCP reference](mcp.md).

## 4. Verify the setup safely

1. In Codex, run `/mcp` and confirm `runpod-gtm-data` is connected.
2. Invoke `$utm-builder-v2` and ask it to list current UTM reference data.
3. Search for an existing campaign or link.
4. Preview a link and confirm the response shows the normalized URL, warnings, and duplicate result without creating a record.
5. Test a write only in an approved environment with a disposable test record. Review the exact preview, explicitly confirm the write, and verify the returned `rpc_`, `rpi_`, or `rpl_` identifier in the web registry and audit trail.

The skill requires search before creation, preview before issuance, explicit confirmation for writes, and a stable idempotency key for single-link retries. Server-side roles, scopes, validation, duplicates, transactions, and audit remain authoritative.

## 5. Troubleshooting

| Symptom | Check |
|---|---|
| Skill is missing | Confirm the checkout contains `.agents/skills/utm-builder-v2/SKILL.md`, the working directory is inside the repository, and Codex has been restarted after the pull. |
| Skill loads but no live tools appear | The skill does not install MCP. Check `/mcp`, the configured URL, client restart, and network access to the registry host. |
| MCP returns `401` | The token is missing, expired, revoked, or not visible to the process that started Codex. Replace or rotate it; do not expose it in logs. |
| MCP returns `403` or omits write tools | The Builder user, role, or token lacks the required scope. Request the minimum appropriate access rather than broadening the token silently. |
| Preview works but issuance stops | Resolve validation/duplicate findings and confirm the exact proposed write. `confirmed=true` is required server-side and does not replace user approval. |
| Production host is unavailable | Continue with documentation or local code work only. Do not point production workflows at a personal/test deployment or claim a registry change occurred. |

## 6. Updates and maintenance

- Pull `main` to receive skill and documentation updates. Codex detects skill changes automatically; restart if an update is not visible.
- Keep domain rules in the application code and canonical documentation. The skill should route to them rather than duplicate full manuals.
- When the skill changes, run the bundled `skill-creator` validator against `.agents/skills/utm-builder-v2`, verify every referenced repository path, and test at least one explanation prompt plus the read-only MCP flow.
- Personal bearer tokens are suitable only for an approved pilot. Production should move to Runpod-approved organization OAuth when available, as tracked in [decisions.md](decisions.md).
