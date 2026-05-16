#!/usr/bin/env bash
# Vercel build wrapper.
#
# Vercel auto-deploys every pushed branch as a preview deploy. We have a
# Claude routine that pushes ephemeral `auto/parking-quality-YYYY-MM-DD-HHMM`
# branches multiple times per day for static parking-quality diagnoses —
# those branches do not need to be built, deployed, or hosted on Vercel.
#
# Multiple times now the resulting preview deploy has claimed the
# production aliases for www.autopilotamerica.com, sending live customer
# traffic to a stale build of an automated diagnosis branch. Failing the
# build for these branches stops the preview from being created at all,
# which removes the alias-hijack risk entirely.
#
# Exit 1 = build failed (Vercel marks the deploy as failed; no preview URL,
# no alias claim). Anything else proceeds with the normal Next.js build.

set -e

BRANCH="${VERCEL_GIT_COMMIT_REF:-}"
case "$BRANCH" in
  auto/parking-quality-*)
    echo "vercel-build.sh: skipping deploy for auto/parking-quality branch '$BRANCH'" >&2
    echo "vercel-build.sh: these branches are routine diagnosis pushes and never need a Vercel deploy." >&2
    exit 1
    ;;
esac

# Normal Next.js build. Mirrors npm run build, but invokes the binary
# directly from node_modules/.bin so we don't depend on npx being on
# PATH (Vercel build containers strip PATH down significantly).
exec ./node_modules/.bin/next build
