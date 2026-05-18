"""
Stale Interested Leads bot — runs daily via GitHub Actions.

Aggregates Instantly email threads to find conversations marked Interested
where there's been no motion for 3+ days. Falls back to the leads/list
endpoint to catch older leads whose emails have aged out of the API.

Env vars (set in GitHub Actions secrets / workflow env):
  INSTANTLY_API_KEY   — Instantly v2 API key
  SLACK_WEBHOOK       — incoming webhook URL for the project's channel
  PROJECT             — "pixsort" or "fps"
  STALE_DAYS          — optional, defaults to 3
  START_DATE          — optional ISO date (YYYY-MM-DD). If set, only flag
                        threads whose last activity is on/after this date.
                        Used by FPS so we ignore the historic backlog and
                        only track new stale conversations going forward.
"""
import os, requests, json, sys
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo
from collections import defaultdict

API_KEY = os.environ['INSTANTLY_API_KEY']
WEBHOOK = os.environ.get('SLACK_WEBHOOK', '')
PROJECT = os.environ.get('PROJECT', 'pixsort').lower()
STALE_DAYS = int(os.environ.get('STALE_DAYS', '3'))
LOCAL_TZ = ZoneInfo(os.environ.get('LOCAL_TZ', 'America/Detroit'))
START_DATE_ENV = os.environ.get('START_DATE', '').strip()
# START_DATE is a local-date cutoff: only flag threads whose last activity
# is on/after this date (local time). Used by FPS to ignore the historic backlog.
START_DATE_LOCAL = None
if START_DATE_ENV:
    START_DATE_LOCAL = date.fromisoformat(START_DATE_ENV)

PROJECT_CONFIG = {
    'pixsort': {'prefix': 'PIXSORT', 'display': 'PixSort'},
    'fps':     {'prefix': 'FPS',     'display': 'Firepit Surplus'},
}
if PROJECT not in PROJECT_CONFIG:
    print(f'ERROR: PROJECT must be "pixsort" or "fps", got {PROJECT!r}', file=sys.stderr)
    sys.exit(1)
CFG = PROJECT_CONFIG[PROJECT]

H = {'Authorization': f'Bearer {API_KEY}'}
H_POST = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}
NOW = datetime.now(timezone.utc)
TODAY_LOCAL = NOW.astimezone(LOCAL_TZ).date()

def calendar_days_stale(t):
    """Days between today (local) and t's local date — matches Instantly's UI."""
    return (TODAY_LOCAL - t.astimezone(LOCAL_TZ).date()).days

# ---------- Helpers ----------

def parse_ts(s):
    if not s: return None
    return datetime.fromisoformat(s.replace('Z','+00:00'))

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

# ---------- Detection: email-thread based ----------

def find_stale_from_emails(camps_by_id):
    """Aggregate Unibox emails per thread, flag stale Interested conversations."""
    all_emails, cursor = [], None
    while True:
        params = {'limit': 100}
        if cursor: params['starting_after'] = cursor
        r = requests.get('https://api.instantly.ai/api/v2/emails', headers=H, params=params)
        if not r.ok: break
        d = r.json()
        items = d.get('items', [])
        all_emails.extend(items)
        cursor = d.get('next_starting_after')
        if not cursor or not items: break
        if len(all_emails) > 10000: break

    threads = defaultdict(lambda: {'last_outbound': None, 'last_inbound': None,
                                   'i_status': 0, 'campaign_id': None, 'lead_email': None,
                                   'lead_id': None, 'subject': None})
    for em in all_emails:
        lead_email = em.get('lead') or em.get('to_address_email_list','').split(',')[0]
        if not lead_email: continue
        cid = em.get('campaign_id')
        key_ = (lead_email.lower(), cid)
        rec = threads[key_]
        rec['campaign_id'] = cid
        rec['lead_email'] = lead_email
        if em.get('lead_id'): rec['lead_id'] = em['lead_id']
        if em.get('i_status') == 1: rec['i_status'] = 1
        t = parse_ts(em.get('timestamp_email') or em.get('timestamp_created'))
        if not t: continue
        ue = em.get('ue_type')
        if ue == 2:  # inbound
            if not rec['last_inbound'] or t > rec['last_inbound']:
                rec['last_inbound'] = t
                rec['subject'] = em.get('subject') or rec['subject']
        elif ue in (1, 3):  # outbound (sequence or manual)
            if not rec['last_outbound'] or t > rec['last_outbound']:
                rec['last_outbound'] = t
                rec['subject'] = em.get('subject') or rec['subject']

    stale = []
    for (lead_email, cid), rec in threads.items():
        if rec['i_status'] != 1: continue
        camp_name = camps_by_id.get(cid, {}).get('name', '?')
        if not camp_name.startswith(CFG['prefix']): continue
        last_activity = max([t for t in (rec['last_inbound'], rec['last_outbound']) if t], default=None)
        if not last_activity: continue
        days_stale = calendar_days_stale(last_activity)
        if days_stale < STALE_DAYS: continue
        if START_DATE_LOCAL and last_activity.astimezone(LOCAL_TZ).date() < START_DATE_LOCAL: continue
        waiting_on = ('you' if rec['last_inbound'] and (not rec['last_outbound'] or rec['last_inbound'] > rec['last_outbound']) else 'them')
        stale.append({
            'lead_email': lead_email,
            'lead_id': rec['lead_id'],
            'campaign': camp_name,
            'subject': rec['subject'] or '',
            'days_stale': days_stale,
            'waiting_on': waiting_on,
            'last_inbound': rec['last_inbound'].isoformat() if rec['last_inbound'] else None,
            'last_outbound': rec['last_outbound'].isoformat() if rec['last_outbound'] else None,
            'instantly_url': f"https://app.instantly.ai/app/unibox/{rec['lead_id']}" if rec['lead_id'] else 'https://app.instantly.ai/app/unibox',
        })
    return stale

# ---------- Detection: leads/list (catches older leads emails aged out) ----------

def find_stale_from_leads(camps_by_id):
    """Fallback: query leads/list for older Interested leads (no recent emails)."""
    out, cursor = [], None
    while True:
        body = {'limit': 100, 'filter': 'FILTER_LEAD_INTERESTED'}
        if cursor: body['starting_after'] = cursor
        r = requests.post('https://api.instantly.ai/api/v2/leads/list', headers=H_POST, json=body)
        if not r.ok: break
        d = r.json()
        items = d.get('items', [])
        out.extend(items)
        cursor = d.get('next_starting_after')
        if not cursor or not items: break
    stale = []
    for lead in out:
        camp_name = camps_by_id.get(lead.get('campaign'), {}).get('name', '?')
        if not camp_name.startswith(CFG['prefix']): continue
        last_reply = parse_ts(lead.get('timestamp_last_reply'))
        last_contact = parse_ts(lead.get('timestamp_last_contact'))
        last_activity = max([t for t in (last_reply, last_contact) if t], default=None)
        if not last_activity: continue
        days_stale = calendar_days_stale(last_activity)
        if days_stale < STALE_DAYS: continue
        if START_DATE_LOCAL and last_activity.astimezone(LOCAL_TZ).date() < START_DATE_LOCAL: continue
        waiting_on = 'you' if (last_reply and last_contact and last_reply > last_contact) else 'them'
        stale.append({
            'lead_email': lead.get('email',''),
            'lead_id': lead['id'],
            'campaign': camp_name,
            'subject': '',
            'days_stale': days_stale,
            'waiting_on': waiting_on,
            'last_inbound': last_reply.isoformat() if last_reply else None,
            'last_outbound': last_contact.isoformat() if last_contact else None,
            'instantly_url': f"https://app.instantly.ai/app/unibox/{lead['id']}",
            'first_name': lead.get('first_name',''),
            'last_name': lead.get('last_name',''),
            'company': lead.get('company_name','') or lead.get('company_domain',''),
        })
    return stale

# ---------- Combine + dedupe ----------

def collect():
    camps = {c['id']: c for c in get_all_campaigns()}
    from_emails = find_stale_from_emails(camps)
    from_leads = find_stale_from_leads(camps)
    seen = {}
    for r in from_leads:
        seen[r['lead_email'].lower()] = r
    for r in from_emails:
        # email-based wins on conflict (more accurate timestamps)
        seen[r['lead_email'].lower()] = r
    return list(seen.values())

# ---------- Slack ----------

def slack_blocks_for(rows, title):
    if not rows:
        return [
            {'type': 'header', 'text': {'type': 'plain_text', 'text': f'✅ {title}'}},
            {'type': 'section', 'text': {'type': 'mrkdwn', 'text': 'No stale interested conversations. Inbox is clean.'}},
        ]
    rows.sort(key=lambda r: (0 if r['waiting_on']=='you' else 1, -r['days_stale']))
    waiting_you = sum(1 for r in rows if r['waiting_on']=='you')
    blocks = [
        {'type': 'header', 'text': {'type': 'plain_text', 'text': f'⏰ {title} — {len(rows)} stale'}},
        {'type': 'context', 'elements': [{'type': 'mrkdwn',
            'text': f'*{waiting_you}* waiting on you   ·   *{len(rows)-waiting_you}* waiting on them   ·   no motion in {STALE_DAYS}+ days' + (f"   ·   tracking from {START_DATE_LOCAL.isoformat()} onward" if START_DATE_LOCAL else '')}]},
        {'type': 'divider'},
    ]
    for r in rows[:25]:
        icon = '🔴' if r['waiting_on']=='you' else '🟡'
        name_or_email = r.get('first_name') and f"{r.get('first_name','')} {r.get('last_name','')}".strip() or r['lead_email']
        company = r.get('company','')
        company_part = f' at *{company}*' if company else ''
        subj_part = f"\n   _{r['subject'][:60]}_" if r.get('subject') else ''
        line = (
            f"{icon} *<{r['instantly_url']}|{name_or_email}>*{company_part}  ·  `{r['lead_email']}`\n"
            f"   _{r['campaign']}_  ·  {r['days_stale']}d stale  ·  waiting on *{r['waiting_on']}*{subj_part}"
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
        print(f'posted: {fallback_text}')

# ---------- Main ----------

def main():
    rows = collect()
    title = f"{CFG['display']} — stale conversations"
    print(f'{CFG["display"]} stale: {len(rows)}')
    post_to_slack(WEBHOOK, slack_blocks_for(rows, title),
                  f'{CFG["display"]} stale: {len(rows)}')

if __name__ == '__main__':
    main()
