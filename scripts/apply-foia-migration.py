#!/usr/bin/env python3
"""Apply FOIA stats migration via Supabase Management API.

Usage:
    SUPABASE_ACCESS_TOKEN=<token> python3 scripts/apply-foia-migration.py

Get token from: https://supabase.com/dashboard/account/tokens
Or run: supabase login
"""

import json, os, sys, re, ssl, urllib.request

PROJECT_REF = 'dzhqolbhuqdcpngdayuq'
MIGRATION_FILE = os.path.join(os.path.dirname(__file__), '..', 'supabase', 'migrations', '20260310_foia_block_ticket_stats.sql')

# SSL context — always disable verification since this system has cert issues
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get_access_token():
    """Find Supabase access token from env or CLI config."""
    if os.environ.get('SUPABASE_ACCESS_TOKEN'):
        return os.environ['SUPABASE_ACCESS_TOKEN']

    home = os.path.expanduser('~')
    for p in [
        os.path.join(home, '.config', 'supabase', 'access-token'),
        os.path.join(home, '.supabase', 'access-token'),
    ]:
        if os.path.exists(p):
            return open(p).read().strip()

    # Try to get from supabase CLI
    import subprocess
    try:
        # v2.23 stores in OS keyring, extract via internal command
        result = subprocess.run(
            ['supabase', 'projects', 'list', '--output', 'json'],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            # CLI is authenticated — try to use strace to find the token
            # Or better: look in credential store
            pass
    except:
        pass

    print("ERROR: No Supabase access token found.")
    print("Set SUPABASE_ACCESS_TOKEN env var.")
    print("Get a token from: https://supabase.com/dashboard/account/tokens")
    sys.exit(1)


def run_query(token, sql):
    """Execute SQL via Supabase Management API."""
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query',
        data=body,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
    )
    try:
        resp = urllib.request.urlopen(req, context=CTX, timeout=30)
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise Exception(f'HTTP {e.code}: {body[:500]}')


def main():
    print('=== Apply FOIA Migration ===\n')

    token = get_access_token()
    print(f'Token found ({len(token)} chars)')

    sql = open(MIGRATION_FILE).read()
    print(f'Migration SQL: {len(sql)} chars')

    # Run the entire migration as one statement
    print('\nExecuting migration...')
    try:
        result = run_query(token, sql)
        print(f'Result: {json.dumps(result)[:500]}')
    except Exception as e:
        print(f'Full execution failed: {e}')
        print('\nTrying statement by statement...')

        # Split into statements
        stmts = re.split(r';\s*\n', sql)
        stmts = [s.strip() for s in stmts if s.strip() and not s.strip().startswith('--')]

        for i, stmt in enumerate(stmts):
            preview = stmt[:80].replace('\n', ' ')
            sys.stdout.write(f'  [{i+1}/{len(stmts)}] {preview}...')
            sys.stdout.flush()
            try:
                run_query(token, stmt + ';')
                print(' OK')
            except Exception as e2:
                print(f' ERROR: {str(e2)[:200]}')

    # Verify
    print('\nVerifying tables...')
    try:
        result = run_query(token, """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_name LIKE 'foia_%'
            ORDER BY table_name;
        """)
        for row in result:
            print(f'  ✓ {row.get("table_name", row)}')
    except Exception as e:
        print(f'  Verify error: {e}')

    print('\nVerifying RPC functions...')
    try:
        result = run_query(token, """
            SELECT routine_name FROM information_schema.routines
            WHERE routine_schema='public' AND routine_name LIKE 'get_%ticket%'
            ORDER BY routine_name;
        """)
        for row in result:
            print(f'  ✓ {row.get("routine_name", row)}')
    except Exception as e:
        print(f'  Verify error: {e}')

    print('\n=== Done ===')


if __name__ == '__main__':
    main()
