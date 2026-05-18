"""
Detect Instantly leads marked 'Interested' with no conversation motion in 3+ days.

Outputs two digests:
  - PixSort stale leads → for Tiff
  - Firepit Surplus stale leads → for Firepit team

Designed to run daily on a scheduler (cron / GitHub Actions / Claude scheduled task).
"""
import os, requests, json, sys
from datetime import datetime, timezone, timedelta

API_KEY = os.environ['INSTANTLY_API_KEY']
H = {'Authorization': f'Bearer {API_KEY}', 'Content-Type': 'application/json'}

STALE_DAYS = 3
NOW = datetime.now(timezone.utc)
STALE_CUTOFF = NOW - timedelta(days=STALE_DAYS)

def paginate_leads(filter_name):
    out, cursor = [], None
    while True:
        body = {'limit': 100, 'filter': filter_name}
        if cursor: body['starting_after'] = cursor
        r = requests.post('https://api.instantly.ai/api/v2/leads/list', headers=H, json=body)
        if not r.ok:
            print(f'err {r.status_code}: {r.text[:200]}', file=sys.stderr); break
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

# Pull all interested leads + campaign names for routing
interested = paginate_leads('FILTER_LEAD_INTERESTED')
camps = {c['id']: c for c in get_all_campaigns()}

pixsort_stale, fps_stale = [], []
for lead in interested:
    last_reply = parse_ts(lead.get('timestamp_last_reply'))
    last_contact = parse_ts(lead.get('timestamp_last_contact'))
    last_activity = max([t for t in (last_reply, last_contact) if t], default=None)
    if not last_activity:
        continue
    if last_activity > STALE_CUTOFF:
        continue
    days_stale = (NOW - last_activity).days
    camp_id = lead.get('campaign')
    camp = camps.get(camp_id, {})
    camp_name = camp.get('name', '?')
    waiting_on = 'you' if (last_reply and last_contact and last_reply > last_contact) else \
                 ('them' if last_contact and (not last_reply or last_contact > last_reply) else 'unknown')
    row = {
        'lead_id': lead['id'],
        'campaign': camp_name,
        'campaign_id': camp_id,
        'first_name': lead.get('first_name','') or 'there',
        'email': lead.get('email',''),
        'company': lead.get('company_name','') or lead.get('company_domain',''),
        'days_stale': days_stale,
        'waiting_on': waiting_on,
        'last_reply': last_reply.isoformat() if last_reply else None,
        'last_contact': last_contact.isoformat() if last_contact else None,
        'instantly_url': f"https://app.instantly.ai/app/unibox/{lead['id']}",
    }
    if camp_name.startswith('PIXSORT'):
        pixsort_stale.append(row)
    elif camp_name.startswith('FPS'):
        fps_stale.append(row)

# Sort by days_stale desc (most stale first)
pixsort_stale.sort(key=lambda r: -r['days_stale'])
fps_stale.sort(key=lambda r: -r['days_stale'])

def format_digest(rows, title):
    if not rows:
        return f'=== {title} ===\nNo stale interested leads. 🎉\n'
    s = f'=== {title} ({len(rows)} stale leads, no motion in 3+ days) ===\n'
    for r in rows:
        s += f"\n  {r['first_name']} @ {r['company']}  ({r['email']})\n"
        s += f"    Campaign: {r['campaign']}\n"
        s += f"    Days stale: {r['days_stale']}d   Waiting on: {r['waiting_on']}\n"
        s += f"    Last reply: {r['last_reply'] or '—'}   Last contact: {r['last_contact'] or '—'}\n"
        s += f"    Inbox: {r['instantly_url']}\n"
    return s

print(format_digest(pixsort_stale, 'PIXSORT — stale interested leads'))
print(format_digest(fps_stale, 'FIREPIT SURPLUS — stale interested leads'))

# Save JSON for downstream notification step
out_dir = '/tmp/stale_leads'
os.makedirs(out_dir, exist_ok=True)
with open(f'{out_dir}/pixsort.json','w') as f: json.dump(pixsort_stale, f, indent=2)
with open(f'{out_dir}/fps.json','w') as f: json.dump(fps_stale, f, indent=2)
print(f'Saved JSON to {out_dir}/')
