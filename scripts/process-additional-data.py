#!/usr/bin/env python3
"""
Process additional Chicago neighborhood data:
- Building Permits
- Business Licenses
- Red Light Camera Violations (tickets per camera)
- Speed Camera Violations (tickets per camera)
- Potholes Patched
"""

import csv
import json
from collections import defaultdict
from datetime import datetime, timedelta

BLOCK_SIZE = 0.004

def round_to_block(lat, lng):
    return (round(lat / BLOCK_SIZE) * BLOCK_SIZE, round(lng / BLOCK_SIZE) * BLOCK_SIZE)

# ============================================
# BUILDING PERMITS
# ============================================
def process_permits():
    print("Processing Building Permits...")

    PERMIT_TYPES = {
        'new_construction': ['NEW CONSTRUCTION', 'PERMIT - NEW CONSTRUCTION'],
        'renovation': ['PERMIT - RENOVATION/ALTERATION', 'RENOVATION', 'ALTERATION'],
        'electrical': ['PERMIT - ELECTRICAL', 'ELECTRICAL'],
        'plumbing': ['PERMIT - PLUMBING'],
        'signs': ['PERMIT - SIGNS', 'SIGN'],
        'demolition': ['PERMIT - WRECKING/DEMOLITION', 'WRECKING', 'DEMOLITION'],
        'other': []
    }

    def get_permit_type(permit_type_str):
        pt = permit_type_str.upper() if permit_type_str else ''
        for cat, keywords in PERMIT_TYPES.items():
            for kw in keywords:
                if kw in pt:
                    return cat
        return 'other'

    blocks = defaultdict(lambda: {
        'count': 0,
        'categories': defaultdict(int),
        'ward': None,
        'address': None,
        'total_cost': 0,
        'recent_count': 0
    })

    cutoff = datetime.now() - timedelta(days=365)
    row_count = 0

    with open('/home/randy-vollrath/Downloads/Building_Permits_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 200000 == 0:
                print(f"  Processed {row_count:,} rows...")

            try:
                lat = float(row.get('LATITUDE', 0) or 0)
                lng = float(row.get('LONGITUDE', 0) or 0)
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            ptype = get_permit_type(row.get('PERMIT_TYPE', ''))
            blocks[block_key]['categories'][ptype] += 1

            if not blocks[block_key]['ward']:
                blocks[block_key]['ward'] = row.get('WARD', '')
            if not blocks[block_key]['address']:
                addr = f"{row.get('STREET_NUMBER', '')} {row.get('STREET_DIRECTION', '')} {row.get('STREET_NAME', '')}".strip()
                blocks[block_key]['address'] = addr

            try:
                cost = row.get('REPORTED_COST', '').replace('$', '').replace(',', '')
                if cost:
                    blocks[block_key]['total_cost'] += float(cost)
            except:
                pass

            try:
                issue_date = row.get('ISSUE_DATE', '')
                if issue_date:
                    dt = datetime.strptime(issue_date, '%m/%d/%Y')
                    if dt >= cutoff:
                        blocks[block_key]['recent_count'] += 1
            except:
                pass

    print(f"  Total rows: {row_count:,}")
    print(f"  Blocks with permits: {len(blocks):,}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 5}
    print(f"  Blocks with 5+ permits: {len(filtered):,}")

    data = []
    for (lat, lng), block in filtered.items():
        score = min(100, int(block['count'] / 100 * 50 + (block['total_cost'] / 1000000) * 50))
        data.append([
            round(lat, 4), round(lng, 4), block['count'], score,
            dict(block['categories']), block['ward'] or '', block['address'] or '',
            int(block['total_cost']), block['recent_count']
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data)
        },
        'cats': {
            'new_construction': {'n': 'New Construction', 'c': '#22c55e'},
            'renovation': {'n': 'Renovation', 'c': '#3b82f6'},
            'electrical': {'n': 'Electrical', 'c': '#eab308'},
            'plumbing': {'n': 'Plumbing', 'c': '#0ea5e9'},
            'signs': {'n': 'Signs', 'c': '#8b5cf6'},
            'demolition': {'n': 'Demolition', 'c': '#ef4444'},
            'other': {'n': 'Other', 'c': '#6b7280'}
        },
        'data': data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/permits-data.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"  Output: permits-data.json ({len(json.dumps(output)) / 1024:.1f} KB)")

# ============================================
# BUSINESS LICENSES
# ============================================
def process_licenses():
    print("\nProcessing Business Licenses...")

    LICENSE_TYPES = {
        'food': ['RETAIL FOOD', 'FOOD', 'RESTAURANT', 'TAVERN', 'LIQUOR'],
        'retail': ['RETAIL', 'SALES'],
        'service': ['SERVICE', 'REPAIR', 'SALON', 'BARBER'],
        'entertainment': ['ENTERTAINMENT', 'MUSIC', 'AMUSEMENT', 'PUBLIC PLACE'],
        'tobacco': ['TOBACCO', 'VAPE'],
        'other': []
    }

    def get_license_type(desc):
        d = desc.upper() if desc else ''
        for cat, keywords in LICENSE_TYPES.items():
            for kw in keywords:
                if kw in d:
                    return cat
        return 'other'

    blocks = defaultdict(lambda: {
        'count': 0,
        'categories': defaultdict(int),
        'ward': None,
        'address': None,
        'active': 0
    })

    row_count = 0

    with open('/home/randy-vollrath/Downloads/Business_Licenses_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 200000 == 0:
                print(f"  Processed {row_count:,} rows...")

            try:
                lat = float(row.get('LATITUDE', 0) or 0)
                lng = float(row.get('LONGITUDE', 0) or 0)
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            ltype = get_license_type(row.get('LICENSE DESCRIPTION', ''))
            blocks[block_key]['categories'][ltype] += 1

            if not blocks[block_key]['ward']:
                blocks[block_key]['ward'] = row.get('WARD', '')
            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('ADDRESS', '')

            status = row.get('LICENSE STATUS', '').upper()
            if status in ['AAI', 'AAC', 'ISSUED']:
                blocks[block_key]['active'] += 1

    print(f"  Total rows: {row_count:,}")
    print(f"  Blocks with licenses: {len(blocks):,}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 3}
    print(f"  Blocks with 3+ licenses: {len(filtered):,}")

    data = []
    for (lat, lng), block in filtered.items():
        score = min(100, int(block['count'] / 50 * 100))
        data.append([
            round(lat, 4), round(lng, 4), block['count'], score,
            dict(block['categories']), block['ward'] or '', block['address'] or '',
            block['active']
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data)
        },
        'cats': {
            'food': {'n': 'Food/Restaurant', 'c': '#f97316'},
            'retail': {'n': 'Retail', 'c': '#3b82f6'},
            'service': {'n': 'Services', 'c': '#22c55e'},
            'entertainment': {'n': 'Entertainment', 'c': '#8b5cf6'},
            'tobacco': {'n': 'Tobacco', 'c': '#6b7280'},
            'other': {'n': 'Other', 'c': '#94a3b8'}
        },
        'data': data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/licenses-data.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"  Output: licenses-data.json ({len(json.dumps(output)) / 1024:.1f} KB)")

# ============================================
# CAMERA VIOLATIONS (Red Light + Speed)
# ============================================
def process_camera_violations():
    print("\nProcessing Camera Violations...")

    # Red light violations - aggregate by camera location
    rl_cameras = defaultdict(lambda: {'violations': 0, 'lat': 0, 'lng': 0, 'address': '', 'intersection': ''})

    with open('/home/randy-vollrath/Downloads/Red_Light_Camera_Violations_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                camera_id = row.get('CAMERA ID', '')
                violations = int(float(row.get('VIOLATIONS', 0) or 0))
                lat = float(row.get('LATITUDE', 0) or 0)
                lng = float(row.get('LONGITUDE', 0) or 0)

                if camera_id and violations > 0 and lat and lng:
                    rl_cameras[camera_id]['violations'] += violations
                    rl_cameras[camera_id]['lat'] = lat
                    rl_cameras[camera_id]['lng'] = lng
                    rl_cameras[camera_id]['address'] = row.get('ADDRESS', '')
                    rl_cameras[camera_id]['intersection'] = row.get('INTERSECTION', '')
            except:
                continue

    print(f"  Red light cameras: {len(rl_cameras)}")

    # Speed camera violations
    speed_cameras = defaultdict(lambda: {'violations': 0, 'lat': 0, 'lng': 0, 'address': ''})

    with open('/home/randy-vollrath/Downloads/Speed_Camera_Violations_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                camera_id = row.get('CAMERA ID', '')
                violations = int(float(row.get('VIOLATIONS', 0) or 0))
                lat = float(row.get('LATITUDE', 0) or 0)
                lng = float(row.get('LONGITUDE', 0) or 0)

                if camera_id and violations > 0 and lat and lng:
                    speed_cameras[camera_id]['violations'] += violations
                    speed_cameras[camera_id]['lat'] = lat
                    speed_cameras[camera_id]['lng'] = lng
                    speed_cameras[camera_id]['address'] = row.get('ADDRESS', '')
            except:
                continue

    print(f"  Speed cameras: {len(speed_cameras)}")

    # Output red light data
    rl_data = []
    for cam_id, info in rl_cameras.items():
        if info['violations'] >= 100:  # Filter to cameras with significant violations
            rl_data.append([
                round(info['lat'], 5), round(info['lng'], 5),
                info['violations'], cam_id, info['intersection'] or info['address']
            ])
    rl_data.sort(key=lambda x: -x[2])

    rl_output = {
        'meta': {'date': datetime.now().strftime('%Y-%m-%d'), 'cameras': len(rl_data),
                 'total_violations': sum(x[2] for x in rl_data)},
        'data': rl_data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/redlight-violations.json', 'w') as f:
        json.dump(rl_output, f, separators=(',', ':'))

    print(f"  Output: redlight-violations.json ({len(json.dumps(rl_output)) / 1024:.1f} KB)")

    # Output speed data
    speed_data = []
    for cam_id, info in speed_cameras.items():
        if info['violations'] >= 100:
            speed_data.append([
                round(info['lat'], 5), round(info['lng'], 5),
                info['violations'], cam_id, info['address']
            ])
    speed_data.sort(key=lambda x: -x[2])

    speed_output = {
        'meta': {'date': datetime.now().strftime('%Y-%m-%d'), 'cameras': len(speed_data),
                 'total_violations': sum(x[2] for x in speed_data)},
        'data': speed_data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/speed-violations.json', 'w') as f:
        json.dump(speed_output, f, separators=(',', ':'))

    print(f"  Output: speed-violations.json ({len(json.dumps(speed_output)) / 1024:.1f} KB)")

# ============================================
# POTHOLES PATCHED
# ============================================
def process_potholes():
    print("\nProcessing Potholes Patched...")

    blocks = defaultdict(lambda: {
        'count': 0,
        'potholes_filled': 0,
        'address': None,
        'recent_count': 0
    })

    cutoff = datetime.now() - timedelta(days=90)
    row_count = 0

    with open('/home/randy-vollrath/Downloads/Potholes_Patched_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1

            try:
                lat = float(row.get('LATITUDE', 0) or 0)
                lng = float(row.get('LONGITUDE', 0) or 0)
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            try:
                potholes = int(row.get('NUMBER OF POTHOLES FILLED ON BLOCK', 1) or 1)
                blocks[block_key]['potholes_filled'] += potholes
            except:
                blocks[block_key]['potholes_filled'] += 1

            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('ADDRESS', '')

            try:
                req_date = row.get('REQUEST DATE', '').split()[0]
                if req_date:
                    dt = datetime.strptime(req_date, '%m/%d/%Y')
                    if dt >= cutoff:
                        blocks[block_key]['recent_count'] += 1
            except:
                pass

    print(f"  Total rows: {row_count:,}")
    print(f"  Blocks with potholes: {len(blocks):,}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 3}
    print(f"  Blocks with 3+ repairs: {len(filtered):,}")

    data = []
    for (lat, lng), block in filtered.items():
        score = min(100, int(block['potholes_filled'] / 50 * 100))
        data.append([
            round(lat, 4), round(lng, 4), block['count'],
            block['potholes_filled'], score, block['address'] or '', block['recent_count']
        ])

    data.sort(key=lambda x: -x[3])  # Sort by potholes filled

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total_repairs': sum(b['count'] for b in filtered.values()),
            'total_potholes': sum(b['potholes_filled'] for b in filtered.values()),
            'blocks': len(data)
        },
        'data': data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/potholes-data.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"  Output: potholes-data.json ({len(json.dumps(output)) / 1024:.1f} KB)")

if __name__ == '__main__':
    print("=" * 50)
    print("Processing Additional Neighborhood Data")
    print("=" * 50)

    process_permits()
    process_licenses()
    process_camera_violations()
    process_potholes()

    print("\n" + "=" * 50)
    print("All additional data processed!")
    print("=" * 50)
