#!/bin/bash

# Setup FOIA contested tickets tables in Supabase
# This script creates the tables and materialized views

set -e

echo "=== Setting up FOIA Contested Tickets Database ==="
echo ""

# Source environment variables
if [ -f .env.local ]; then
    source <(grep -v '^#' .env.local | sed 's/\r$//' | sed 's/=\(.*\)/="\1"/')
fi

# Check for required environment variables
if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not found in .env.local"
    echo "Please add your Supabase database connection string"
    exit 1
fi

echo "Running migration: create_foia_contested_tickets.sql"
psql "$DATABASE_URL" -f database/migrations/create_foia_contested_tickets.sql

echo ""
echo "✓ Database setup complete!"
echo ""
echo "Next steps:"
echo "1. Run: node scripts/import-foia-data.js"
echo "2. This will import 1.2M contested ticket records"
echo "3. After import completes, statistics will be automatically calculated"
