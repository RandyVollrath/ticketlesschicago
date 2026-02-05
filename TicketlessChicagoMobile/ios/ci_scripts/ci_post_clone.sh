#!/bin/sh

# ci_post_clone.sh — Xcode Cloud post-clone hook
# Runs after Xcode Cloud clones the repo, before building.
# Installs CocoaPods dependencies since Pods/ is gitignored.

set -e

echo "=== Xcode Cloud: ci_post_clone.sh ==="
echo "Current directory: $(pwd)"

# Navigate to the ios directory where the Podfile lives
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
