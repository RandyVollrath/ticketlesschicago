#!/usr/bin/env python3
"""Upload FOIA aggregated stats CSVs to Supabase via REST API.

Reads CSVs from data/foia-aggregated/ and uploads to:
  foia_block_stats, foia_block_hourly, foia_block_monthly, foia_zip_stats

Usage: python3 scripts/upload-foia-stats.py
"""

import csv, json, os, ssl, sys, time, urllib.request

# Config
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.join(SCRIPT_DIR, '..')
DATA_DIR = os.path.join(ROOT_DIR, 'data', 'foia-aggregated')
ENV_FILE = os.path.join(ROOT_DIR, '.env.local')

BATCH_SIZE = 500  # rows per POST
MAX_RETRIES = 3

# SSL
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

# Load env
def load_env():
    url = key = ''
    for line in open(ENV_FILE):
        if line.startswith('NEXT_PUBLIC_SUPABASE_URL='):
            url = line.split('"')[1]
        elif line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
            key = line.split('"')[1]
    return url, key

SUPABASE_URL, SUPABASE_KEY = load_env()


def api_post(table, rows, method='POST'):
    """Post rows to Supabase REST API."""
    url = f'{SUPABASE_URL}/rest/v1/{table}'
    body = json.dumps(rows).encode()
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',  # UPSERT
    }
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    for attempt in range(MAX_RETRIES):
        try:
            resp = urllib.request.urlopen(req, context=CTX, timeout=60)
            return resp.status
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()
            if e.code == 409:  # Conflict - duplicates, skip
                return 409
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
                continue
            raise Exception(f'HTTP {e.code}: {err_body[:300]}')
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
                continue
            raise


def api_delete_all(table):
    """Delete all rows from a table."""
    # Use a filter that matches all rows
    url = f'{SUPABASE_URL}/rest/v1/{table}?ticket_count=gte.0'
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    }
    req = urllib.request.Request(url, headers=headers, method='DELETE')
    try:
        resp = urllib.request.urlopen(req, context=CTX, timeout=120)
        return resp.status
    except urllib.error.HTTPError as e:
        print(f'  Delete error: HTTP {e.code} (table may be empty)')
        return e.code


def upload_csv(csv_file, table, parse_row):
    """Upload a CSV file to a Supabase table."""
    filepath = os.path.join(DATA_DIR, csv_file)
    if not os.path.exists(filepath):
        print(f'  SKIP: {csv_file} not found')
        return 0

    # Clear existing data
    print(f'  Clearing {table}...')
    api_delete_all(table)

    print(f'  Uploading {csv_file}...')
    batch = []
    total = 0
    errors = 0
    t0 = time.time()

    with open(filepath, 'r', newline='') as f:
        reader = csv.reader(f)
        header = next(reader)  # Skip header

        for row in reader:
            try:
                parsed = parse_row(row)
                batch.append(parsed)
            except Exception:
                errors += 1
                continue

            if len(batch) >= BATCH_SIZE:
                try:
                    api_post(table, batch)
                except Exception as e:
                    errors += len(batch)
                    print(f'  Error at {total}: {e}')
                total += len(batch)
                batch = []
                if total % 50000 == 0:
                    elapsed = time.time() - t0
                    rate = total / elapsed if elapsed > 0 else 0
                    print(f'    {total:>10,} rows ({rate:.0f}/s)...')

    # Flush remaining
    if batch:
        try:
            api_post(table, batch)
        except Exception as e:
            errors += len(batch)
            print(f'  Error flushing: {e}')
        total += len(batch)

    elapsed = time.time() - t0
    rate = total / elapsed if elapsed > 0 else 0
    print(f'  {table}: {total:,} rows in {elapsed:.0f}s ({rate:.0f}/s), {errors} errors')
    return total


def main():
    sys.stdout.reconfigure(line_buffering=True)
    print('=== Upload FOIA Stats to Supabase ===\n')
    print(f'Data dir: {DATA_DIR}')
    print(f'Supabase: {SUPABASE_URL}\n')

    # Verify connection
    url = f'{SUPABASE_URL}/rest/v1/foia_block_stats?select=block_id&limit=1'
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    })
    try:
        resp = urllib.request.urlopen(req, context=CTX, timeout=10)
        print(f'Connection OK (status {resp.status})\n')
    except Exception as e:
        print(f'Connection error: {e}')
        print('Make sure the migration has been applied first.')
        sys.exit(1)

    grand_total = 0

    # 1. Block stats (1.48M rows)
    print('1. Block ticket stats')
    n = upload_csv('block_ticket_stats.csv', 'foia_block_stats', lambda r: {
        'block_id': r[0],
        'violation_category': r[1],
        'year': int(r[2]),
        'ticket_count': int(r[3]),
        'fines_base': float(r[4]),
        'fines_late': float(r[5]),
        'paid_count': int(r[6]),
        'dismissed_count': int(r[7]),
    })
    grand_total += n

    # 2. Block hourly (522K rows)
    print('\n2. Block hourly patterns')
    n = upload_csv('block_hourly_patterns.csv', 'foia_block_hourly', lambda r: {
        'block_id': r[0],
        'violation_category': r[1],
        'hour': int(r[2]),
        'day_of_week': int(r[3]),
        'ticket_count': int(r[4]),
    })
    grand_total += n

    # 3. Block monthly (469K rows)
    print('\n3. Block monthly patterns')
    n = upload_csv('block_monthly_patterns.csv', 'foia_block_monthly', lambda r: {
        'block_id': r[0],
        'violation_category': r[1],
        'month': int(r[2]),
        'ticket_count': int(r[3]),
    })
    grand_total += n

    # 4. ZIP stats (376K rows)
    print('\n4. ZIP ticket stats')
    n = upload_csv('zip_ticket_stats.csv', 'foia_zip_stats', lambda r: {
        'zip_code': r[0],
        'violation_category': r[1],
        'year': int(r[2]),
        'ticket_count': int(r[3]),
        'fines_base': float(r[4]),
        'paid_count': int(r[5]),
        'dismissed_count': int(r[6]),
    })
    grand_total += n

    print(f'\n=== TOTAL: {grand_total:,} rows uploaded ===')

    # Test RPC
    print('\nTesting get_block_ticket_summary("1710", "S", "CLINTON")...')
    url = f'{SUPABASE_URL}/rest/v1/rpc/get_block_ticket_summary'
    body = json.dumps({
        'p_street_number': '1710',
        'p_street_direction': 'S',
        'p_street_name': 'CLINTON',
    }).encode()
    req = urllib.request.Request(url, data=body, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req, context=CTX, timeout=15)
        data = json.loads(resp.read().decode())
        print(json.dumps(data, indent=2)[:600])
    except Exception as e:
        print(f'RPC error: {e}')

    print('\nTesting get_zip_ticket_summary("60614")...')
    url = f'{SUPABASE_URL}/rest/v1/rpc/get_zip_ticket_summary'
    body = json.dumps({'p_zip_code': '60614'}).encode()
    req = urllib.request.Request(url, data=body, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
    })
    try:
        resp = urllib.request.urlopen(req, context=CTX, timeout=15)
        data = json.loads(resp.read().decode())
        print(json.dumps(data, indent=2)[:600])
    except Exception as e:
        print(f'RPC error: {e}')


if __name__ == '__main__':
    main()
