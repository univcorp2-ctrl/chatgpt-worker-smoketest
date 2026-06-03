# Cloudflare Worker + Custom GPT setup

This repo contains the Worker for the Custom GPT action endpoint.

## Worker URL

Expected production URL:

```text
https://gh-automation.univcorp2.workers.dev/t/YOUR_URL_SECRET
```

Replace `YOUR_URL_SECRET` with the same value configured in Cloudflare as `URL_SECRET`.

## Required Cloudflare settings

Set these as Cloudflare Worker secrets or GitHub Actions secrets. Do not commit real values.

```text
CLOUDFLARE_ACCOUNT_ID=2f35cf33d0c43a9402735e96cc293dfb
CLOUDFLARE_API_TOKEN=YOUR_ROTATED_CLOUDFLARE_TOKEN
URL_SECRET=YOUR_LONG_RANDOM_URL_SECRET
```

Optional persistent storage:

```text
GITHUB_TOKEN=YOUR_GITHUB_TOKEN_WITH_CONTENTS_WRITE
GITHUB_REPO=univcorp2-ctrl/chatgpt-worker-smoketest
```

Optional KV storage:

```toml
[[kv_namespaces]]
binding = "CAPTURE_KV"
id = "YOUR_KV_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_KV_NAMESPACE_ID"
```

## Deploy with Wrangler

```powershell
$env:CLOUDFLARE_ACCOUNT_ID="2f35cf33d0c43a9402735e96cc293dfb"
$env:CLOUDFLARE_API_TOKEN="YOUR_ROTATED_CLOUDFLARE_TOKEN"
npx wrangler secret put URL_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

If using GitHub Actions, add repository secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Then run the `Deploy Cloudflare Worker` workflow manually.

## Custom GPT Actions

Use `openapi/custom-gpt-actions.yaml` in the Custom GPT Actions screen.

Settings:

```text
Authentication: None
Schema: openapi/custom-gpt-actions.yaml
Server URL: https://gh-automation.univcorp2.workers.dev/t/YOUR_URL_SECRET
```

## Health check

```powershell
Invoke-RestMethod "https://gh-automation.univcorp2.workers.dev/t/YOUR_URL_SECRET/health"
```

Expected response:

```json
{
  "ok": true,
  "service": "chatgpt-output-capture-api",
  "timestamp": "2026-06-03T00:00:00.000Z"
}
```

## Endpoints

- `GET /health`
- `POST /capture`
- `POST /handoff`
- `POST /github-issue`

All endpoints must be called under `/t/YOUR_URL_SECRET`.

## Security note

The Cloudflare API token previously pasted into chat should be rotated. Use the rotated token only in Cloudflare/GitHub secrets, never in repo files, README, Issues, or logs.
