#!/bin/sh

# ci_post_clone.sh — Xcode Cloud post-clone hook
# Runs after Xcode Cloud clones the repo, before building.
# Installs Node.js, npm dependencies, and CocoaPods since
# node_modules/ and Pods/ are gitignored.

set -e

echo "=== Xcode Cloud: ci_post_clone.sh ==="
echo "Current directory: $(pwd)"

# Resolve repository path in Xcode Cloud, with local fallback
if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
fi
echo "Repository root: $REPO_ROOT"

# ── 1. Install Node.js via Homebrew ──
# Xcode Cloud does NOT have Node.js pre-installed.
# The Podfile requires `node` to resolve react_native_pods.rb.
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found."
    if command -v brew >/dev/null 2>&1; then
      echo "Installing Node.js via Homebrew..."
      brew install node
    else
      echo "❌ Homebrew not available and Node.js missing. Cannot continue."
      exit 1
    fi
fi
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"

# ── 2. Install npm dependencies ──
# The Podfile resolves paths through node_modules/react-native.
cd "$REPO_ROOT/TicketlessChicagoMobile"
echo "Installing npm dependencies in $(pwd)..."
npm ci --prefer-offline 2>/dev/null || npm install
echo "=== npm install complete ==="

# ── 3. Install CocoaPods dependencies ──
cd "$REPO_ROOT/TicketlessChicagoMobile/ios"
echo "Working directory: $(pwd)"

# Install CocoaPods with Bundler (preferred), fallback to global gem.
POD_CMD="pod"
if [ -f "$REPO_ROOT/TicketlessChicagoMobile/Gemfile" ] && command -v bundle >/dev/null 2>&1; then
    echo "Installing Ruby gems via Bundler..."
    cd "$REPO_ROOT/TicketlessChicagoMobile"
    bundle config set path 'vendor/bundle'
    bundle install --jobs=4 --retry=3
    POD_CMD="bundle exec pod"
    cd "$REPO_ROOT/TicketlessChicagoMobile/ios"
elif ! command -v pod >/dev/null 2>&1; then
    echo "Installing CocoaPods via gem..."
    gem install cocoapods --no-document
fi

echo "Running pod install..."
$POD_CMD install --repo-update

echo "=== pod install complete ==="
ls -la Pods/Target\ Support\ Files/Pods-TicketlessChicagoMobile/ 2>/dev/null || echo "Warning: Target Support Files not found"
echo "=== ci_post_clone.sh done ==="
