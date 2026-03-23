#!/bin/bash

# ============================================
# MindOS Desktop - Linux Build Script
# Usage: ./scripts/build-linux.sh
# Output: dist/*.zip (arm64 and x64)
# ============================================

set -e

echo "🚀 MindOS Desktop - Linux Build Script"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if we're on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${YELLOW}⚠️  Warning: This script is designed for Linux${NC}"
    echo "Current OS: $OSTYPE"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Clean previous builds
echo -e "\n📦 Cleaning previous builds..."
rm -rf dist dist-electron

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo -e "\n📥 Installing dependencies..."
    npm install
fi

# Build the app
echo -e "\n🔨 Building application..."
npm run build

# Build for mac (from Linux - will produce unsigned zip)
# Linux can only build mac zip, not dmg
echo -e "\n🍎 Building macOS zip (unsigned, from Linux)..."
electron-builder --mac zip

echo -e "\n${GREEN}✅ Build complete!${NC}"
echo -e "\n📁 Output files:"
ls -lh dist/*.zip 2>/dev/null || echo "No zip files found"

echo -e "\n${YELLOW}⚠️  Note: Since this was built on Linux:${NC}"
echo "   - The app is NOT signed (identity: null)"
echo "   - The app is NOT notarized"
echo "   - Users will see 'App is damaged' error on macOS 10.15+"
echo ""
echo -e "${YELLOW}🔧 To run on macOS, users need to:${NC}"
echo "   xattr -cr /Applications/MindOS.app"
echo ""
echo -e "${GREEN}✨ For a properly signed dmg, run build-mac.sh on a Mac${NC}"
