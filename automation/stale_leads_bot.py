"""
Stale Interested Leads bot — runs daily via GitHub Actions.

Detects Instantly leads marked 'Interested' with no conversation motion in 3+ days,
filters to a single project (PixSort or FPS), and posts a digest to Slack via webhook.

Env vars required (set in GitHub Actions secrets):
  INSTANTLY_API_KEY   — Instantly v2 API key
  SLACK_WEBHOOK       — incoming webhook URL for the project's channel
  PROJECT             — "pixsort" or "fps" (decides campaign prefix filter)
  STALE_DAYS          — optional, defaults to 3

Each project has its own repo so the secrets/permissions stay separate.
"""
import os, requests, json, sys
from datetime import datetime, timezone, timedelta

API_KEY = os.environ['INSTANTLY_API_KEY']
WEBHOOK = os.environ.get('SLACK_WEBHOOK', '')
PROJECT = os.environ.get('PROJECT', 'pixsort').lower()
STALE_DAYS = int(os.environ.get('STALE_DAYS', '3'))

PROJECT_CONFIG = {
    'pixsort': {'prefix': 'PIXSORT', 'display': 'PixSort'},
    'fps':     {'prefix': 'FPS',     'display': 'Firepit Surplus'},
}
if PROJECT not in PROJECT_CONFIG:
    print(f'ERROR: PROJECT must be "pixsort" or "fps", got {PROJECT!r}', file=sys.stderr)
    sys.exit(1)
CFG = PROJECT_CONFIG[PROJECT]

H = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}
NOW = datetime.now(timezone.utc)
STALE_CUTOFF = NOW - timedelta(days=STALE_DAYS)

# ---------- Instantly fetchers ----------

def paginate_leads(filter_name):
    out, cursor = [], None
    while True:
        body = {'limit': 100, 'filter': filter_name}
        if cursor: body['starting_after'] = cursor
        r = requests.post('https://api.instantly.ai/api/v2/leads/list', headers=H, json=body)
        if not r.ok:
            print(f'err {r.status_code}: {r.text[:200]}', file=sys.stderr)
            break
        d = r.json()
        items = d.get('items', [])
        out.extend(items)
        cursor = d.get('next_starting_after')
        if not cursor or not items: break
    return out

def get_all_campaigns():
    out, cursor = [], None
    while True:
        params = {'limit': 100}
        if cursor: params['starting_after'] = cursor
        r = requests.get('https://api.instantly.ai/api/v2/campaigns', headers=H, params=params)
        d = r.json()
        out.extend(d.get('items', []))
        cursor = d.get('next_starting_after')
        if not cursor: break
    return out

def parse_ts(s):
    if not s: return None
    return datetime.fromisoformat(s.replace('Z','+00:00'))

# ---------- Detection ----------

def find_stale_for_project():
    interested = paginate_leads('FILTER_LEAD_INTERESTED')
    camps = {c['id']: c for c in get_all_campaigns()}
    out = []
    for lead in interested:
        last_reply = parse_ts(lead.get('timestamp_last_reply'))
        last_contact = parse_ts(lead.get('timestamp_last_contact'))
        last_activity = max([t for t in (last_reply, last_contact) if t], default=None)
        if not last_activity or last_activity > STALE_CUTOFF:
            continue
        camp = camps.get(lead.get('campaign'), {})
        camp_name = camp.get('name', '?')
        if not camp_name.startswith(CFG['prefix']):
            continue
        days_stale = (NOW - last_activity).days
        waiting_on = 'you' if (last_reply and last_contact and last_reply > last_contact) else 'them'
        out.append({
            'lead_id': lead['id'],
            'campaign': camp_name,
            'first_name': lead.get('first_name','') or 'there',
            'last_name': lead.get('last_name',''),
            'email': lead.get('email',''),
            'company': lead.get('company_name','') or lead.get('company_domain',''),
            'days_stale': days_stale,
            'waiting_on': waiting_on,
            'last_reply': last_reply.isoformat() if last_reply else None,
            'last_contact': last_contact.isoformat() if last_contact else None,
            'instantly_url': f"https://app.instantly.ai/app/unibox/{lead['id']}",
        })
    return out

# ---------- Slack ----------

def slack_blocks_for(rows, title):
    if not rows:
        return [
            {'type': 'header', 'text': {'type': 'plain_text', 'text': f'✅ {title}'}},
            {'type': 'section', 'text': {'type': 'mrkdwn', 'text': 'No stale leads. Inbox is clean.'}},
        ]
    rows.sort(key=lambda r: (0 if r['waiting_on']=='you' else 1, -r['days_stale']))
    waiting_you = sum(1 for r in rows if r['waiting_on']=='you')
    blocks = [
        {'type': 'header', 'text': {'type': 'plain_text', 'text': f'⏰ {title} — {len(rows)} stale'}},
        {'type': 'context', 'elements': [{'type': 'mrkdwn',
            'text': f'*{waiting_you}* waiting on you   ·   *{len(rows)-waiting_you}* waiting on them   ·   no motion in {STALE_DAYS}+ days'}]},
        {'type': 'divider'},
    ]
    for r in rows[:25]:
        icon = '🔴' if r['waiting_on']=='you' else '🟡'
        name = f"{r['first_name']} {r['last_name']}".strip() or 'there'
        line = (
            f"{icon} *<{r['instantly_url']}|{name}>* at *{r['company']}*  ·  `{r['email']}`\n"
            f"   _{r['campaign']}_  ·  {r['days_stale']}d stale  ·  waiting on *{r['waiting_on']}*"
        )
        blocks.append({'type': 'section', 'text': {'type': 'mrkdwn', 'text': line}})
    if len(rows) > 25:
        blocks.append({'type': 'context', 'elements': [{'type': 'mrkdwn',
            'text': f'_… and {len(rows)-25} more. Open Instantly to view all._'}]})
    return blocks

def post_to_slack(webhook, blocks, fallback_text):
    if not webhook:
        print(f'[skip] no webhook configured for: {fallback_text}', file=sys.stderr)
        return
    r = requests.post(webhook, json={'text': fallback_text, 'blocks': blocks}, timeout=15)
    if not r.ok:
        print(f'slack err {r.status_code}: {r.text[:300]}', file=sys.stderr)
    else:
        print(f'posted to slack: {fallback_text}')

# ---------- Main ----------

def main():
    rows = find_stale_for_project()
    title = f"{CFG['display']} — stale interested leads"
    print(f'{CFG["display"]} stale: {len(rows)}')
    post_to_slack(WEBHOOK, slack_blocks_for(rows, title),
                  f'{CFG["display"]} stale leads: {len(rows)}')

if __name__ == '__main__':
    main()
