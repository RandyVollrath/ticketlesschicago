#!/usr/bin/env python3
"""
Fetch and process Chicago neighborhood data from Chicago Data Portal APIs.
Generates JSON files for the neighborhoods page map visualization.

Runs weekly via GitHub Actions or manually.
"""

import json
import os
import sys
from datetime import datetime, timedelta
from collections import defaultdict
import urllib.request
import urllib.parse

# Block size: ~0.002 degrees = ~220m = ~720 ft = ~1.5 Chicago blocks
BLOCK_SIZE = 0.002

def round_to_block(lat, lng):
    """Round coordinates to block grid."""
    return (round(lat / BLOCK_SIZE) * BLOCK_SIZE, round(lng / BLOCK_SIZE) * BLOCK_SIZE)

def fetch_data(dataset_id, params, limit=50000):
    """Fetch data from Chicago Data Portal."""
    base_url = f"https://data.cityofchicago.org/resource/{dataset_id}.json"
    params['$limit'] = limit
    query = urllib.parse.urlencode(params)
    url = f"{base_url}?{query}"

    print(f"  Fetching: {url[:100]}...")

    req = urllib.request.Request(url)
    req.add_header('Accept', 'application/json')

    with urllib.request.urlopen(req, timeout=120) as response:
        data = json.loads(response.read().decode('utf-8'))

    return data

# ============================================
# 311 SERVICE REQUESTS
# ============================================
def process_311():
    print("\nProcessing 311 Service Requests...")

    # Categories we care about (relevant to neighborhood quality)
    RELEVANT_TYPES = {
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

    blocks = defaultdict(lambda: {
        'count': 0,
        'categories': defaultdict(int),
        'ward': None,
        'address': None,
        'recent_count': 0
    })

    # Last 12 months
    one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%dT00:00:00')
    ninety_days_ago = (datetime.now() - timedelta(days=90)).strftime('%Y-%m-%dT00:00:00')

    # Fetch all relevant types
    for category, types in RELEVANT_TYPES.items():
        for sr_type in types:
            try:
                data = fetch_data('v6vf-nfxy', {
                    '$where': f"sr_type = '{sr_type}' AND created_date > '{one_year_ago}' AND latitude IS NOT NULL",
                    '$select': 'sr_number,sr_type,created_date,latitude,longitude,ward,street_address'
                })

                print(f"    {sr_type}: {len(data)} records")

                for row in data:
                    try:
                        lat = float(row.get('latitude', 0))
                        lng = float(row.get('longitude', 0))
                    except:
                        continue

                    if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                        continue

                    block_key = round_to_block(lat, lng)
                    blocks[block_key]['count'] += 1
                    blocks[block_key]['categories'][category] += 1

                    if not blocks[block_key]['ward']:
                        blocks[block_key]['ward'] = row.get('ward', '')
                    if not blocks[block_key]['address']:
                        blocks[block_key]['address'] = row.get('street_address', '')

                    created = row.get('created_date', '')
                    if created and created >= ninety_days_ago:
                        blocks[block_key]['recent_count'] += 1

            except Exception as e:
                print(f"    Error fetching {sr_type}: {e}")

    print(f"  Total blocks with data: {len(blocks)}")

    # Filter to blocks with at least 3 requests
    filtered = {k: v for k, v in blocks.items() if v['count'] >= 3}
    print(f"  Blocks with 3+ requests: {len(filtered)}")

    data = []
    for (lat, lng), block in filtered.items():
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

    one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%dT00:00:00')

    # Crimes - One Year Prior to Present dataset
    try:
        data = fetch_data('ijzp-q8t2', {
            '$where': f"date > '{one_year_ago}' AND latitude IS NOT NULL",
            '$select': 'id,date,primary_type,block,latitude,longitude,ward,arrest',
            '$limit': 200000
        })

        print(f"  Fetched {len(data)} crime records")

        for row in data:
            crime_type = row.get('primary_type', '').strip()
            category = type_to_category.get(crime_type, 'other')

            try:
                lat = float(row.get('latitude', 0))
                lng = float(row.get('longitude', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1
            blocks[block_key]['categories'][category] += 1

            if not blocks[block_key]['ward']:
                blocks[block_key]['ward'] = row.get('ward', '')
            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('block', '')

            if str(row.get('arrest', '')).upper() in ['TRUE', 'Y', '1']:
                blocks[block_key]['arrests'] += 1

    except Exception as e:
        print(f"  Error fetching crimes: {e}")
        return None

    print(f"  Total blocks with crimes: {len(blocks)}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 2}
    print(f"  Blocks with 2+ crimes: {len(filtered)}")

    data = []
    for (lat, lng), block in filtered.items():
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

    one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%dT00:00:00')

    try:
        data = fetch_data('85ca-t3if', {
            '$where': f"crash_date > '{one_year_ago}' AND latitude IS NOT NULL",
            '$select': 'crash_record_id,crash_date,latitude,longitude,injuries_total,injuries_fatal,hit_and_run_i,street_name,street_direction,street_no',
            '$limit': 100000
        })

        print(f"  Fetched {len(data)} crash records")

        for row in data:
            try:
                lat = float(row.get('latitude', 0))
                lng = float(row.get('longitude', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            try:
                blocks[block_key]['injuries'] += int(row.get('injuries_total', 0) or 0)
                blocks[block_key]['fatal'] += int(row.get('injuries_fatal', 0) or 0)
            except:
                pass

            if str(row.get('hit_and_run_i', '')).upper() in ['Y', 'TRUE', '1']:
                blocks[block_key]['hit_and_run'] += 1

            if not blocks[block_key]['address']:
                street = row.get('street_name', '')
                direction = row.get('street_direction', '')
                num = row.get('street_no', '')
                blocks[block_key]['address'] = f"{num} {direction} {street}".strip()

    except Exception as e:
        print(f"  Error fetching crashes: {e}")
        return None

    print(f"  Total blocks with crashes: {len(blocks)}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 3}
    print(f"  Blocks with 3+ crashes: {len(filtered)}")

    data = []
    for (lat, lng), block in filtered.items():
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

    return output

# ============================================
# BUILDING VIOLATIONS
# ============================================
def process_violations():
    print("\nProcessing Building Violations...")

    blocks = defaultdict(lambda: {
        'count': 0,
        'high_risk': 0,
        'open': 0,
        'address': None
    })

    HIGH_RISK_KEYWORDS = [
        'FIRE', 'SMOKE', 'ELECTRICAL', 'HAZARD', 'UNSAFE', 'DANGER',
        'STRUCTURAL', 'EGRESS', 'EMERGENCY', 'CONDEMNED', 'VACANT'
    ]

    one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%dT00:00:00')

    try:
        data = fetch_data('22u3-xenr', {
            '$where': f"violation_date > '{one_year_ago}' AND latitude IS NOT NULL",
            '$select': 'id,violation_date,violation_code,violation_description,violation_status,address,latitude,longitude',
            '$limit': 100000
        })

        print(f"  Fetched {len(data)} violation records")

        for row in data:
            try:
                lat = float(row.get('latitude', 0))
                lng = float(row.get('longitude', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            desc = (row.get('violation_description', '') + ' ' + row.get('violation_code', '')).upper()
            if any(kw in desc for kw in HIGH_RISK_KEYWORDS):
                blocks[block_key]['high_risk'] += 1

            status = row.get('violation_status', '').upper()
            if 'OPEN' in status:
                blocks[block_key]['open'] += 1

            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('address', '')

    except Exception as e:
        print(f"  Error fetching violations: {e}")
        return None

    print(f"  Total blocks with violations: {len(blocks)}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 2}
    print(f"  Blocks with 2+ violations: {len(filtered)}")

    data = []
    for (lat, lng), block in filtered.items():
        score = min(100, int(block['high_risk'] * 10 + block['count'] / 10 * 50))

        data.append([
            round(lat, 4),
            round(lng, 4),
            block['count'],
            score,
            block['high_risk'],
            block['open'],
            block['address'] or ''
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data)
        },
        'data': data
    }

    return output

# ============================================
# POTHOLES PATCHED
# ============================================
def process_potholes():
    print("\nProcessing Potholes Patched...")

    blocks = defaultdict(lambda: {
        'count': 0,
        'filled': 0,
        'completed': 0,
        'address': None
    })

    one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%dT00:00:00')

    try:
        data = fetch_data('wqdh-9gek', {
            '$where': f"creation_date > '{one_year_ago}' AND latitude IS NOT NULL",
            '$select': 'service_request_number,creation_date,completion_date,status,number_of_potholes_filled_on_block,street_address,latitude,longitude',
            '$limit': 50000
        })

        print(f"  Fetched {len(data)} pothole records")

        for row in data:
            try:
                lat = float(row.get('latitude', 0))
                lng = float(row.get('longitude', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            try:
                blocks[block_key]['filled'] += int(row.get('number_of_potholes_filled_on_block', 0) or 0)
            except:
                pass

            if row.get('completion_date'):
                blocks[block_key]['completed'] += 1

            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('street_address', '')

    except Exception as e:
        print(f"  Error fetching potholes: {e}")
        return None

    print(f"  Total blocks with potholes: {len(blocks)}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 2}
    print(f"  Blocks with 2+ pothole requests: {len(filtered)}")

    data = []
    for (lat, lng), block in filtered.items():
        data.append([
            round(lat, 4),
            round(lng, 4),
            block['count'],
            block['filled'],
            block['completed'],
            block['address'] or ''
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data),
            'total_filled': sum(b['filled'] for b in filtered.values())
        },
        'data': data
    }

    return output

# ============================================
# BUILDING PERMITS
# ============================================
def process_permits():
    print("\nProcessing Building Permits...")

    blocks = defaultdict(lambda: {
        'count': 0,
        'issued': 0,
        'cost': 0,
        'address': None
    })

    one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%dT00:00:00')

    try:
        data = fetch_data('ydr8-5enu', {
            '$where': f"application_start_date > '{one_year_ago}' AND latitude IS NOT NULL",
            '$select': 'id,application_start_date,permit_status,reported_cost,latitude,longitude,street_number,street_direction,street_name',
            '$limit': 100000
        })

        print(f"  Fetched {len(data)} permit records")

        for row in data:
            try:
                lat = float(row.get('latitude', 0))
                lng = float(row.get('longitude', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            status = row.get('permit_status', '').upper()
            if 'ISSUED' in status or 'COMPLETE' in status:
                blocks[block_key]['issued'] += 1

            try:
                blocks[block_key]['cost'] += float(row.get('reported_cost', 0) or 0)
            except:
                pass

            if not blocks[block_key]['address']:
                num = row.get('street_number', '')
                direction = row.get('street_direction', '')
                name = row.get('street_name', '')
                blocks[block_key]['address'] = f"{num} {direction} {name}".strip()

    except Exception as e:
        print(f"  Error fetching permits: {e}")
        return None

    print(f"  Total blocks with permits: {len(blocks)}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 2}
    print(f"  Blocks with 2+ permits: {len(filtered)}")

    data = []
    for (lat, lng), block in filtered.items():
        data.append([
            round(lat, 4),
            round(lng, 4),
            block['count'],
            block['issued'],
            int(block['cost']),
            block['address'] or ''
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data),
            'total_cost': sum(b['cost'] for b in filtered.values())
        },
        'data': data
    }

    return output

# ============================================
# BUSINESS LICENSES
# ============================================
def process_licenses():
    print("\nProcessing Business Licenses...")

    blocks = defaultdict(lambda: {
        'count': 0,
        'active': 0,
        'address': None
    })

    one_year_ago = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%dT00:00:00')

    try:
        data = fetch_data('r5kz-chrr', {
            '$where': f"date_issued > '{one_year_ago}' AND latitude IS NOT NULL",
            '$select': 'id,date_issued,license_status,address,latitude,longitude',
            '$limit': 100000
        })

        print(f"  Fetched {len(data)} license records")

        for row in data:
            try:
                lat = float(row.get('latitude', 0))
                lng = float(row.get('longitude', 0))
            except:
                continue

            if not (41.6 < lat < 42.1 and -88.0 < lng < -87.5):
                continue

            block_key = round_to_block(lat, lng)
            blocks[block_key]['count'] += 1

            status = row.get('license_status', '').upper()
            if 'AAI' in status or 'AAC' in status or 'ACTIVE' in status:
                blocks[block_key]['active'] += 1

            if not blocks[block_key]['address']:
                blocks[block_key]['address'] = row.get('address', '')

    except Exception as e:
        print(f"  Error fetching licenses: {e}")
        return None

    print(f"  Total blocks with licenses: {len(blocks)}")

    filtered = {k: v for k, v in blocks.items() if v['count'] >= 2}
    print(f"  Blocks with 2+ licenses: {len(filtered)}")

    data = []
    for (lat, lng), block in filtered.items():
        data.append([
            round(lat, 4),
            round(lng, 4),
            block['count'],
            block['active'],
            block['address'] or ''
        ])

    data.sort(key=lambda x: -x[2])

    output = {
        'meta': {
            'date': datetime.now().strftime('%Y-%m-%d'),
            'total': sum(b['count'] for b in filtered.values()),
            'blocks': len(data),
            'total_active': sum(b['active'] for b in filtered.values())
        },
        'data': data
    }

    return output

# ============================================
# MAIN
# ============================================
def main():
    print("=" * 50)
    print("Updating Chicago Neighborhood Data")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)

    # Determine output directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(os.path.dirname(script_dir), 'public')

    if not os.path.exists(output_dir):
        print(f"Error: Output directory not found: {output_dir}")
        sys.exit(1)

    success = True

    # Process each data type
    processors = [
        ('311-data.json', process_311),
        ('crimes-data.json', process_crimes),
        ('crashes-data.json', process_crashes),
        ('violations-data.json', process_violations),
        ('potholes-data.json', process_potholes),
        ('permits-data.json', process_permits),
        ('licenses-data.json', process_licenses),
    ]

    for filename, processor in processors:
        try:
            data = processor()
            if data:
                output_path = os.path.join(output_dir, filename)
                with open(output_path, 'w') as f:
                    json.dump(data, f, separators=(',', ':'))
                print(f"  Written: {filename} ({os.path.getsize(output_path) / 1024:.1f} KB)")
            else:
                print(f"  FAILED: {filename}")
                success = False
        except Exception as e:
            print(f"  ERROR processing {filename}: {e}")
            success = False

    print("\n" + "=" * 50)
    if success:
        print("All data updated successfully!")
    else:
        print("Some updates failed - check logs above")
    print(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)

    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()
