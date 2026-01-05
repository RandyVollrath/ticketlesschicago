#!/usr/bin/env python3
"""
Process Chicago neighborhood data (311, Crimes, Crashes) into aggregated blocks for the map.
"""

import csv
import json
from collections import defaultdict
from datetime import datetime, timedelta

# Block size: ~0.002 degrees ≈ 220m ≈ 720 ft ≈ 1.5 Chicago blocks
BLOCK_SIZE = 0.002

def round_to_block(lat, lng):
    """Round coordinates to block grid."""
    return (round(lat / BLOCK_SIZE) * BLOCK_SIZE, round(lng / BLOCK_SIZE) * BLOCK_SIZE)

# ============================================
# 311 SERVICE REQUESTS
# ============================================
def process_311():
    print("Processing 311 Service Requests...")

    # Categories we care about (relevant to neighborhood quality)
    RELEVANT_CATEGORIES = {
        'infrastructure': [
            'Pothole in Street Complaint', 'Alley Pothole Complaint',
            'Street Light Out Complaint', 'Alley Light Out Complaint',
            'Traffic Signal Out Complaint', 'Sign Repair Request',
            'Sidewalk Inspection Request'
        ],
        'sanitation': [
            'Graffiti Removal Request', 'Garbage Cart Maintenance',
            'Fly Dumping Complaint', 'Sanitation Code Violation',
            'Dead Animal Pick-Up Request'
        ],
        'pests': [
            'Rodent Baiting/Rat Complaint', 'Stray Animal Complaint'
        ],
        'vehicles': [
            'Abandoned Vehicle Complaint'
        ],
        'trees': [
            'Tree Trim Request', 'Tree Debris Clean-Up Request',
            'Tree Emergency', 'Weed Removal Request'
        ],
        'water': [
            'Water On Street Complaint', 'Sewer Cleaning Inspection Request',
            'Check for Leak'
        ]
    }

    # Flatten for quick lookup
    type_to_category = {}
    for cat, types in RELEVANT_CATEGORIES.items():
        for t in types:
            type_to_category[t] = cat

    blocks = defaultdict(lambda: {
        'count': 0,
        'categories': defaultdict(int),
        'ward': None,
        'address': None,
        'recent_count': 0  # last 90 days
    })

    cutoff_date = datetime.now() - timedelta(days=90)
    row_count = 0

    with open('/home/randy-vollrath/Downloads/311_Service_Requests_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 500000 == 0:
                print(f"  Processed {row_count:,} rows...")

            sr_type = row.get('SR_TYPE', '')

            # Skip info-only calls and aircraft noise
            if 'INFORMATION ONLY' in sr_type or 'Aircraft' in sr_type:
                continue

            # Find matching category
            category = None
            for type_name, cat in type_to_category.items():
                if type_name in sr_type:
                    category = cat
                    break

            if not category:
                continue

            try:
                lat = float(row.get('LATITUDE', 0))
                lng = float(row.get('LONGITUDE', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1
            blocks[block_key]['categories'][category] += 1

            if not blocks[block_key]['ward']:
                blocks[block_key]['ward'] = row.get('WARD', '')
            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('STREET_ADDRESS', '')

            # Check if recent
            try:
                created = row.get('CREATED_DATE', '')
                if created:
                    dt = datetime.strptime(created.split()[0], '%m/%d/%Y')
                    if dt >= cutoff_date:
                        blocks[block_key]['recent_count'] += 1
            except:
                pass

    print(f"  Total rows: {row_count:,}")
    print(f"  Total blocks with data: {len(blocks):,}")

    # Filter to blocks with at least 10 requests
    filtered = {k: v for k, v in blocks.items() if v['count'] >= 3}
    print(f"  Blocks with 10+ requests: {len(filtered):,}")

    # Build output data
    data = []
    for (lat, lng), block in filtered.items():
        # Calculate activity score (0-100)
        score = min(100, int(block['count'] / 50 * 100))

        data.append([
            round(lat, 4),
            round(lng, 4),
            block['count'],
            score,
            dict(block['categories']),
            block['ward'] or '',
            block['address'] or '',
            block['recent_count']
        ])

    # Sort by count descending
    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data)
        },
        'cats': {
            'infrastructure': {'n': 'Infrastructure', 'c': '#6b7280'},
            'sanitation': {'n': 'Sanitation', 'c': '#84cc16'},
            'pests': {'n': 'Pests', 'c': '#f97316'},
            'vehicles': {'n': 'Abandoned Vehicles', 'c': '#8b5cf6'},
            'trees': {'n': 'Trees & Vegetation', 'c': '#22c55e'},
            'water': {'n': 'Water/Sewer', 'c': '#0ea5e9'}
        },
        'data': data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/311-data.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"  Output: public/311-data.json ({len(json.dumps(output)) / 1024:.1f} KB)")
    return output

# ============================================
# CRIMES
# ============================================
def process_crimes():
    print("\nProcessing Crimes data...")

    CRIME_CATEGORIES = {
        'violent': ['HOMICIDE', 'ROBBERY', 'ASSAULT', 'BATTERY', 'CRIMINAL SEXUAL ASSAULT'],
        'property': ['THEFT', 'BURGLARY', 'MOTOR VEHICLE THEFT', 'CRIMINAL DAMAGE', 'ARSON'],
        'drugs': ['NARCOTICS'],
        'weapons': ['WEAPONS VIOLATION'],
        'other': ['OTHER OFFENSE', 'DECEPTIVE PRACTICE', 'CRIMINAL TRESPASS']
    }

    type_to_category = {}
    for cat, types in CRIME_CATEGORIES.items():
        for t in types:
            type_to_category[t] = cat

    blocks = defaultdict(lambda: {
        'count': 0,
        'categories': defaultdict(int),
        'ward': None,
        'address': None,
        'arrests': 0
    })

    row_count = 0

    with open('/home/randy-vollrath/Downloads/Crimes_-_One_year_prior_to_present_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 50000 == 0:
                print(f"  Processed {row_count:,} rows...")

            crime_type = row.get(' PRIMARY DESCRIPTION', '').strip()
            category = type_to_category.get(crime_type, 'other')

            try:
                lat = float(row.get('LATITUDE', 0))
                lng = float(row.get('LONGITUDE', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1
            blocks[block_key]['categories'][category] += 1

            if not blocks[block_key]['ward']:
                blocks[block_key]['ward'] = row.get('WARD', '')
            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('BLOCK', '')

            if row.get('ARREST', '').upper() == 'Y':
                blocks[block_key]['arrests'] += 1

    print(f"  Total crimes: {row_count:,}")
    print(f"  Total blocks with crimes: {len(blocks):,}")

    # Filter to blocks with at least 5 crimes
    filtered = {k: v for k, v in blocks.items() if v['count'] >= 2}
    print(f"  Blocks with 5+ crimes: {len(filtered):,}")

    data = []
    for (lat, lng), block in filtered.items():
        # Calculate crime severity score (0-100)
        violent = block['categories'].get('violent', 0)
        property_crime = block['categories'].get('property', 0)
        score = min(100, int((violent * 3 + property_crime) / block['count'] * 50 + block['count'] / 20 * 25))

        data.append([
            round(lat, 4),
            round(lng, 4),
            block['count'],
            score,
            dict(block['categories']),
            block['ward'] or '',
            block['address'] or '',
            block['arrests']
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data),
            'period': 'Last 12 months'
        },
        'cats': {
            'violent': {'n': 'Violent Crime', 'c': '#dc2626'},
            'property': {'n': 'Property Crime', 'c': '#f59e0b'},
            'drugs': {'n': 'Narcotics', 'c': '#8b5cf6'},
            'weapons': {'n': 'Weapons', 'c': '#1f2937'},
            'other': {'n': 'Other', 'c': '#6b7280'}
        },
        'data': data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/crimes-data.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"  Output: public/crimes-data.json ({len(json.dumps(output)) / 1024:.1f} KB)")
    return output

# ============================================
# TRAFFIC CRASHES
# ============================================
def process_crashes():
    print("\nProcessing Traffic Crashes...")

    blocks = defaultdict(lambda: {
        'count': 0,
        'injuries': 0,
        'fatal': 0,
        'hit_and_run': 0,
        'address': None
    })

    row_count = 0

    with open('/home/randy-vollrath/Downloads/Traffic_Crashes_-_Crashes_20251224.csv', 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_count += 1
            if row_count % 100000 == 0:
                print(f"  Processed {row_count:,} rows...")

            try:
                lat = float(row.get('LATITUDE', 0))
                lng = float(row.get('LONGITUDE', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            try:
                blocks[block_key]['injuries'] += int(row.get('INJURIES_TOTAL', 0) or 0)
                blocks[block_key]['fatal'] += int(row.get('INJURIES_FATAL', 0) or 0)
            except:
                pass

            if row.get('HIT_AND_RUN_I', '').upper() == 'Y':
                blocks[block_key]['hit_and_run'] += 1

            if not blocks[block_key]['address']:
                street = row.get('STREET_NAME', '')
                direction = row.get('STREET_DIRECTION', '')
                num = row.get('STREET_NO', '')
                blocks[block_key]['address'] = f"{num} {direction} {street}".strip()

    print(f"  Total crashes: {row_count:,}")
    print(f"  Total blocks with crashes: {len(blocks):,}")

    # Filter to blocks with at least 10 crashes
    filtered = {k: v for k, v in blocks.items() if v['count'] >= 3}
    print(f"  Blocks with 10+ crashes: {len(filtered):,}")

    data = []
    for (lat, lng), block in filtered.items():
        # Calculate danger score (0-100)
        injury_rate = block['injuries'] / block['count'] if block['count'] > 0 else 0
        score = min(100, int(
            block['fatal'] * 20 +
            injury_rate * 30 +
            block['count'] / 50 * 30
        ))

        data.append([
            round(lat, 4),
            round(lng, 4),
            block['count'],
            score,
            block['injuries'],
            block['fatal'],
            block['hit_and_run'],
            block['address'] or ''
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data),
            'total_injuries': sum(b['injuries'] for b in filtered.values()),
            'total_fatal': sum(b['fatal'] for b in filtered.values())
        },
        'data': data
    }

    with open('/home/randy-vollrath/ticketless-chicago/public/crashes-data.json', 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"  Output: public/crashes-data.json ({len(json.dumps(output)) / 1024:.1f} KB)")
    return output

if __name__ == '__main__':
    print("=" * 50)
    print("Processing Chicago Neighborhood Data")
    print("=" * 50)

    process_311()
    process_crimes()
    process_crashes()

    print("\n" + "=" * 50)
    print("All data processed successfully!")
    print("=" * 50)
