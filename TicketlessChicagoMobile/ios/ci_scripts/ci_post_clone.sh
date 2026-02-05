#!/bin/sh

# ci_post_clone.sh — Xcode Cloud post-clone hook
# Runs after Xcode Cloud clones the repo, before building.
# Installs Node.js, npm dependencies, and CocoaPods since
# node_modules/ and Pods/ are gitignored.

set -e

echo "=== Xcode Cloud: ci_post_clone.sh ==="
echo "Current directory: $(pwd)"

# ── 1. Install Node.js via Homebrew ──
# Xcode Cloud does NOT have Node.js pre-installed.
# The Podfile requires `node` to resolve react_native_pods.rb.
if ! command -v node &> /dev/null; then
    echo "Node.js not found — installing via Homebrew..."
    brew install node
fi
echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"

# ── 2. Install npm dependencies ──
# The Podfile resolves paths through node_modules/react-native.
cd "$CI_PRIMARY_REPOSITORY_PATH/TicketlessChicagoMobile"
echo "Installing npm dependencies in $(pwd)..."
npm ci --prefer-offline 2>/dev/null || npm install
echo "=== npm install complete ==="

# ── 3. Install CocoaPods dependencies ──
cd "$CI_PRIMARY_REPOSITORY_PATH/TicketlessChicagoMobile/ios"
echo "Working directory: $(pwd)"

# Install CocoaPods if not already available
if ! command -v pod &> /dev/null; then
    echo "Installing CocoaPods..."
    gem install cocoapods
fi

echo "Running pod install..."
pod install --repo-update

echo "=== pod install complete ==="
ls -la Pods/Target\ Support\ Files/Pods-TicketlessChicagoMobile/ 2>/dev/null || echo "Warning: Target Support Files not found"
echo "=== ci_post_clone.sh done ==="
