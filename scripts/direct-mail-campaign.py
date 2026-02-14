#!/usr/bin/env python3
"""
Direct Mail Campaign Automation for Ticketless Chicago
======================================================

Uses Lob API to send targeted postcards to Chicago households
that have received multiple parking tickets (identified by ZIP+4 codes).

SETUP:
  1. Sign up at https://lob.com (free, no credit card for test mode)
  2. Get your Test API key from Settings > API Keys
  3. Set it: export LOB_API_KEY="test_xxxxxxxxxxxx"
  4. Run a test:  python3 scripts/direct-mail-campaign.py --test
  5. When ready:  export LOB_API_KEY="live_xxxxxxxxxxxx"
  6. Run for real: python3 scripts/direct-mail-campaign.py --tier ultra-hot --limit 100

USAGE:
  # Test mode (sends to your address, uses test API key)
  python3 scripts/direct-mail-campaign.py --test

  # Preview: see how many would be sent without sending
  python3 scripts/direct-mail-campaign.py --tier ultra-hot --dry-run

  # Send to first 50 ultra-hot targets
  python3 scripts/direct-mail-campaign.py --tier ultra-hot --limit 50

  # Send to all hot targets
  python3 scripts/direct-mail-campaign.py --tier hot

IMPORTANT: ZIP+4 doesn't give us the exact street address. We're using this
data to identify WHICH neighborhoods to target. The actual mailing requires
either:
  A) Resolving ZIP+4 → address via a CASS-certified provider ($)
  B) Using USPS EDDM to blanket the carrier routes (cheapest)
  C) Combining with a purchased mailing list filtered by these ZIPs

This script supports all three workflows — see the mode flags below.
"""

import os
import sys
import csv
import json
import time
import argparse
import base64
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from datetime import datetime


LOB_BASE_URL = "https://api.lob.com/v1"

# =====================================================================
# POSTCARD TEMPLATES (HTML)
# =====================================================================

# Messaging varies by violation type — each segment gets a tailored hook

FRONT_HTML = """
<html>
<head>
  <style>
    body {
      margin: 0; padding: 0;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      background: #1a1a2e;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
    }
    .container {
      text-align: center;
      padding: 40px;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      color: #00d4ff;
    }
    .hook {
      font-size: 22px;
      font-weight: bold;
      margin: 16px 0;
      line-height: 1.3;
    }
    .highlight {
      color: #ff6b6b;
      font-size: 36px;
      font-weight: 900;
    }
    .sub {
      font-size: 14px;
      color: #aaa;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>TICKETLESS</h1>
    <div class="hook">{{HOOK_LINE}}</div>
    <div class="highlight">{{STAT_LINE}}</div>
    <div class="sub">Chicago drivers exposed &mdash; exposed to unfair tickets.</div>
  </div>
</body>
</html>
"""

BACK_HTML = """
<html>
<head>
  <style>
    body {
      margin: 0; padding: 0;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #1a1a2e;
      height: 100%;
    }
    .container {
      padding: 32px;
    }
    h2 {
      font-size: 20px;
      margin-bottom: 12px;
      color: #1a1a2e;
    }
    .body-text {
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .cta {
      background: #1a1a2e;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: bold;
      display: inline-block;
      text-decoration: none;
      margin: 8px 0;
    }
    .url {
      font-size: 18px;
      font-weight: bold;
      color: #0066cc;
      margin: 12px 0;
    }
    .fine-print {
      font-size: 10px;
      color: #888;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>{{BACK_HEADLINE}}</h2>
    <div class="body-text">
      {{BACK_BODY}}
    </div>
    <div class="url">autopilotamerica.com</div>
    <div class="body-text">
      Download the free app. We monitor your parking 24/7 and
      automatically contest tickets the moment they appear.
    </div>
    <div class="fine-print">
      Ticketless by Autopilot America &bull; Chicago, IL
    </div>
  </div>
</body>
</html>
"""

# Violation-specific messaging
VIOLATION_MESSAGES = {
    'expired_meter': {
        'hook': "Tired of feeding the meter?",
        'stat': "Chicago wrote $47M in meter tickets last year.",
        'headline': "Meter expired by 2 minutes? That's a $65 ticket.",
        'body': "Most expired meter tickets are contestable. Our app tracks your parking session and alerts you before your meter runs out. If you do get ticketed, we automatically generate a contest letter and file it for you.",
    },
    'street_cleaning': {
        'hook': "Missed a street cleaning sign?",
        'stat': "70% of street cleaning tickets are contestable.",
        'headline': "Street cleaning tickets are the #1 contested violation in Chicago.",
        'body': "Many street cleaning tickets are issued in error or when signage is inadequate. Our app alerts you the night before street cleaning on your block. If you do get a ticket, we check the city's own records to build your contest.",
    },
    'permit_parking': {
        'hook': "Got a permit parking ticket on your own block?",
        'stat': "33,000+ permit parking tickets in 2024 alone.",
        'headline': "Even residents with valid permits get ticketed.",
        'body': "The city's parking enforcement makes mistakes. If you have a valid residential parking permit and still got ticketed, we can contest it automatically. Our app also alerts you when permit restrictions are in effect on your street.",
    },
    'expired_plate': {
        'hook': "Registration ticket sitting on your dash?",
        'stat': "149,000 plate/registration tickets in 2024.",
        'headline': "Renewed your plates? The ticket might still be contestable.",
        'body': "If you renewed your registration before or shortly after the ticket was issued, you likely have grounds to contest. Our app checks your ticket and automates the entire contest process.",
    },
    'no_city_sticker': {
        'hook': "Missing city sticker? Join the club.",
        'stat': "42,000+ city sticker tickets in 2024.",
        'headline': "City sticker tickets are often dismissed.",
        'body': "If you purchased your city sticker before the ticket or have evidence of compliance, contesting is straightforward. Our app automates the entire process and tracks your hearing for you.",
    },
    'general': {
        'hook': "How much did Chicago parking tickets cost you this year?",
        'stat': "Average Chicago driver: $1,200+/year in tickets.",
        'headline': "Most parking tickets are contestable. Most people don't bother.",
        'body': "Our free app monitors your car's parking status 24/7 using Bluetooth. It alerts you before violations happen and automatically contests any tickets you receive. No lawyers. No paperwork. Just results.",
    },
}


def get_message_segment(top_violation):
    """Map a violation description to a message segment."""
    v = top_violation.upper()
    if 'METER' in v and ('CENTRAL' in v or 'NON-CENTRAL' in v):
        return 'expired_meter'
    if 'STREET CLEANING' in v:
        return 'street_cleaning'
    if 'PERMIT' in v:
        return 'permit_parking'
    if 'EXPIRED PLATE' in v or 'REGISTRATION' in v:
        return 'expired_plate'
    if 'CITY STICKER' in v:
        return 'no_city_sticker'
    return 'general'


def render_postcard(segment_key):
    """Render front and back HTML for a given segment."""
    msg = VIOLATION_MESSAGES.get(segment_key, VIOLATION_MESSAGES['general'])

    front = FRONT_HTML.replace('{{HOOK_LINE}}', msg['hook'])
    front = front.replace('{{STAT_LINE}}', msg['stat'])

    back = BACK_HTML.replace('{{BACK_HEADLINE}}', msg['headline'])
    back = back.replace('{{BACK_BODY}}', msg['body'])

    return front, back


def lob_request(endpoint, data, api_key, method="POST"):
    """Make an authenticated request to the Lob API."""
    url = f"{LOB_BASE_URL}/{endpoint}"
    auth = base64.b64encode(f"{api_key}:".encode()).decode()

    req = Request(url, method=method)
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Content-Type", "application/json")

    if data:
        req.data = json.dumps(data).encode()

    try:
        with urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        error_body = e.read().decode()
        print(f"  Lob API error {e.code}: {error_body}")
        return None


def send_postcard(api_key, to_address, segment_key, metadata=None, from_address=None):
    """Send a single postcard via Lob."""
    front_html, back_html = render_postcard(segment_key)

    payload = {
        "to": to_address,
        "front": front_html,
        "back": back_html,
        "size": "4x6",
    }

    if from_address:
        payload["from"] = from_address

    if metadata:
        # Lob metadata values must be strings, max 500 chars
        payload["metadata"] = {k: str(v)[:500] for k, v in metadata.items()}

    return lob_request("postcards", payload, api_key)


def load_campaign_csv(filepath):
    """Load a campaign CSV file."""
    rows = []
    with open(filepath, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description="Ticketless direct mail campaign")
    parser.add_argument('--test', action='store_true',
                       help='Send a single test postcard to your address')
    parser.add_argument('--dry-run', action='store_true',
                       help='Preview what would be sent without sending')
    parser.add_argument('--tier', choices=['ultra-hot', 'hot', 'warm', 'all'],
                       help='Which campaign tier to send')
    parser.add_argument('--limit', type=int, default=None,
                       help='Max number of postcards to send')
    parser.add_argument('--csv', type=str, default=None,
                       help='Path to CSV with resolved addresses (name,address_line1,city,state,zip)')
    parser.add_argument('--from-name', type=str, default='Ticketless by Autopilot America')
    parser.add_argument('--from-address', type=str, default=None,
                       help='Return address line 1')
    parser.add_argument('--from-city', type=str, default='Chicago')
    parser.add_argument('--from-state', type=str, default='IL')
    parser.add_argument('--from-zip', type=str, default=None)

    args = parser.parse_args()

    api_key = os.environ.get('LOB_API_KEY')
    if not api_key:
        print("ERROR: Set LOB_API_KEY environment variable")
        print("  Test key: export LOB_API_KEY='test_xxxxxxxxxxxx'")
        print("  Live key: export LOB_API_KEY='live_xxxxxxxxxxxx'")
        sys.exit(1)

    is_test_key = api_key.startswith('test_')
    print(f"Mode: {'TEST (no real mail)' if is_test_key else 'LIVE (real mail will be sent!)'}")

    from_address = None
    if args.from_address and args.from_zip:
        from_address = {
            "name": args.from_name,
            "address_line1": args.from_address,
            "address_city": args.from_city,
            "address_state": args.from_state,
            "address_zip": args.from_zip,
        }

    # ---- TEST MODE ----
    if args.test:
        print("\n--- TEST MODE ---")
        print("Sending one test postcard with each violation segment...\n")

        test_address = {
            "name": "Test Recipient",
            "address_line1": "185 Berry St Ste 6100",
            "address_city": "San Francisco",
            "address_state": "CA",
            "address_zip": "94107",
        }

        for seg in ['general', 'expired_meter', 'street_cleaning']:
            print(f"  Sending '{seg}' postcard...")
            result = send_postcard(api_key, test_address, seg, from_address=from_address)
            if result:
                print(f"    OK! ID: {result.get('id')} | URL: {result.get('url')}")
            time.sleep(1)

        print("\nTest complete. Check your Lob dashboard to preview the postcards.")
        return

    # ---- CSV MODE (resolved addresses) ----
    if args.csv:
        print(f"\nLoading addresses from: {args.csv}")
        rows = load_campaign_csv(args.csv)
        print(f"Loaded {len(rows)} addresses")

        if args.limit:
            rows = rows[:args.limit]
            print(f"Limited to {len(rows)}")

        if args.dry_run:
            print("\n--- DRY RUN ---")
            for i, row in enumerate(rows[:10]):
                seg = get_message_segment(row.get('top_violation', ''))
                print(f"  [{i+1}] {row.get('name', 'Resident')}, {row['address_line1']}, {row['city']} {row['state']} {row['zip']} -> segment: {seg}")
            if len(rows) > 10:
                print(f"  ... and {len(rows) - 10} more")
            print(f"\nTotal: {len(rows)} postcards @ $0.77 = ${len(rows) * 0.77:,.2f}")
            return

        # Send for real
        sent = 0
        errors = 0
        for i, row in enumerate(rows):
            seg = get_message_segment(row.get('top_violation', ''))
            to_address = {
                "name": row.get('name', 'Current Resident'),
                "address_line1": row['address_line1'],
                "address_city": row.get('city', 'Chicago'),
                "address_state": row.get('state', 'IL'),
                "address_zip": row['zip'],
            }
            if row.get('address_line2'):
                to_address['address_line2'] = row['address_line2']

            metadata = {
                'tier': row.get('tier', ''),
                'total_tickets': row.get('total_tickets', ''),
                'segment': seg,
            }

            result = send_postcard(api_key, to_address, seg, metadata=metadata, from_address=from_address)
            if result:
                sent += 1
            else:
                errors += 1

            if (i + 1) % 50 == 0:
                print(f"  Progress: {i+1}/{len(rows)} sent, {errors} errors")

            # Rate limit: Lob allows 150 req/sec on live, but be conservative
            time.sleep(0.1)

        print(f"\nDone! Sent: {sent}, Errors: {errors}")
        return

    # ---- ZIP+4 ANALYSIS MODE (no addresses yet) ----
    if args.tier:
        tier_files = {
            'ultra-hot': 'campaign_ultra_hot.csv',
            'hot': 'campaign_hot.csv',
            'warm': 'campaign_warm.csv',
        }

        if args.tier == 'all':
            filepath = os.path.expanduser('~/Downloads/campaign_all_tiers.csv')
        else:
            filepath = os.path.expanduser(f'~/Downloads/{tier_files[args.tier]}')

        if not os.path.exists(filepath):
            print(f"ERROR: Campaign file not found: {filepath}")
            print("Run the analysis script first to generate campaign CSVs.")
            sys.exit(1)

        rows = load_campaign_csv(filepath)
        if args.limit:
            rows = rows[:args.limit]

        # Segment analysis
        segments = {}
        for row in rows:
            seg = get_message_segment(row.get('top_violation', ''))
            if seg not in segments:
                segments[seg] = 0
            segments[seg] += 1

        print(f"\n{'='*60}")
        print(f"CAMPAIGN: {args.tier.upper()}")
        print(f"{'='*60}")
        print(f"  Total targets: {len(rows):,}")
        print(f"  Lob cost (Developer): ${len(rows) * 0.77:,.0f}")
        print(f"  Lob cost (Small Biz):  ${len(rows) * 0.51 + 260:,.0f}")
        print(f"\n  Message segments:")
        for seg, count in sorted(segments.items(), key=lambda x: -x[1]):
            print(f"    {seg}: {count:,} ({count/len(rows)*100:.0f}%)")

        print(f"\n  NOTE: These are ZIP+4 codes, not street addresses.")
        print(f"  To send actual mail, you need to resolve addresses first.")
        print(f"  See the README section on address resolution options.")

        if args.dry_run:
            print(f"\n  --- DRY RUN: Sample entries ---")
            for row in rows[:5]:
                seg = get_message_segment(row.get('top_violation', ''))
                print(f"    ZIP+4: {row['zip9_formatted']} | {row['total_tickets']} tickets | segment: {seg} | top: {row['top_violation']}")

        return

    # No mode selected
    parser.print_help()


if __name__ == '__main__':
    main()
