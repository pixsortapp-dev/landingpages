# Stale Interested Leads Bot — PixSort

Daily Slack digest of Instantly leads marked Interested with no conversation motion in 3+ days.

This repo runs the **PixSort** version. The FPS version lives in the Firepit Surplus repo with the same script + a different `PROJECT` env var.

## How it works

`stale_leads_bot.py` queries Instantly for `lt_interest_status = 1` leads, filters to campaigns starting with `PIXSORT`, and posts a digest to a Slack webhook. GitHub Actions runs it daily at 13:00 UTC (9 AM EDT / 8 AM EST).

## Setup (one-time, ~5 minutes)

### 1. Create the Slack incoming webhook

For the private PixSort channel (e.g., `#tiff-pixsort-bot`):

1. In Slack: search "Incoming Webhooks" app → Add to Slack
2. Pick your channel → Add Incoming Webhooks integration
3. Copy the Webhook URL (`https://hooks.slack.com/services/T.../B.../...`)

### 2. Add 2 GitHub Actions secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `INSTANTLY_API_KEY` | Your Instantly v2 API key |
| `SLACK_WEBHOOK` | The webhook URL from step 1 |

### 3. Trigger a manual test

GitHub: **Actions** tab → **stale-interested-leads-bot** → **Run workflow** (drops the digest into Slack within ~30 seconds).

After the first manual test passes, the daily cron takes over.

## Local testing

```bash
export INSTANTLY_API_KEY='...'
export SLACK_WEBHOOK='https://hooks.slack.com/services/...'
export PROJECT='pixsort'
python automation/stale_leads_bot.py
```

## Tuning

- `STALE_DAYS` in the workflow → adjust threshold (default 3 days)
- `slack_blocks_for()` in the script → change digest format
- Currently shows up to 25 leads per digest

## Phase 2 (TODO)

Have the bot also create a **draft reply** in Instantly for each stale lead, linked from the Slack digest for one-click review and send. Lets you skip the blank-reply-box friction without auto-sending.
