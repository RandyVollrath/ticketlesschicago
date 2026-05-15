#!/bin/bash
# Pre-commit lint: block adding `supabaseAdmin.from(...)` (or equivalent
# service-role client calls) in any pages/api/ file that doesn't appear to
# perform an auth check within the same file.
#
# Rationale: service_role bypasses RLS. A new contributor who forgets a
# requireAuth() call exposes every row in the queried table to anyone who
# can hit the endpoint. Mistakes like this happen one route at a time and
# are easy to miss in review. This check fails the commit early.
#
# Heuristic: if a staged .ts file under pages/api/ adds a line containing
# `supabaseAdmin.from(` or `.from('user_profiles')` (etc.), the file must
# also contain one of:
#   requireAuth | requireAdmin | requireAdminAuth | withAdminAuth |
#   withCronOrAdminAuth | verifyCronAuth | isAdminUser | createPagesServerClient
#
# To intentionally skip (e.g., a public read-only endpoint that's safe),
# add a comment `// rls-bypass-ok: <reason>` anywhere in the file.

set -euo pipefail

# Only consider files staged for this commit.
staged_files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^pages/api/.*\.ts$' || true)

if [ -z "$staged_files" ]; then
  exit 0
fi

AUTH_PATTERNS='requireAuth|requireAdmin|requireAdminAuth|withAdminAuth|withCronOrAdminAuth|verifyCronAuth|isAdminUser|createPagesServerClient|rls-bypass-ok'

violations=()

while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Only inspect added lines, not the full file (avoids dinging unchanged
  # legacy code that pre-dates this check).
  added=$(git diff --cached -- "$file" | grep -E '^\+' | grep -v '^\+\+\+' || true)
  if echo "$added" | grep -qE 'supabaseAdmin\.from\(|supabaseAdmin\.rpc\(|supabaseAdmin\.storage|supabaseAdmin\.auth'; then
    # File adds a service-role call. Check the whole file for at least one
    # auth check (added or pre-existing — we don't require every new call
    # to have its own new auth check).
    if ! grep -qE "$AUTH_PATTERNS" "$file"; then
      violations+=("$file")
    fi
  fi
done <<< "$staged_files"

if [ "${#violations[@]}" -gt 0 ]; then
  echo "❌ SECURITY ERROR: service-role Supabase calls without an auth check:"
  for f in "${violations[@]}"; do
    echo "   - $f"
  done
  echo ""
  echo "  Each pages/api/ route that uses supabaseAdmin (which bypasses RLS)"
  echo "  must also call one of: requireAuth, requireAdmin, requireAdminAuth,"
  echo "  withAdminAuth, withCronOrAdminAuth, verifyCronAuth, isAdminUser, or"
  echo "  createPagesServerClient (with a session check)."
  echo ""
  echo "  If this route is intentionally public (e.g., a read-only stat that"
  echo "  doesn't touch user-specific rows), add a comment in the file:"
  echo "      // rls-bypass-ok: <one-line reason>"
  echo ""
  exit 1
fi

exit 0
