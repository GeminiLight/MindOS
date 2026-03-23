#!/bin/bash

# ============================================
# MindOS Desktop - macOS Build Script
# Usage: ./scripts/build-mac.sh [--sign]
# Output: dist/*.dmg (arm64 and x64)
# ============================================

set -e

echo "🚀 MindOS Desktop - macOS Build Script"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo -e "${RED}❌ Error: This script must run on macOS${NC}"
    echo "Current OS: $OSTYPE"
    echo ""
    echo "To build on Linux (zip only), use: ./scripts/build-linux.sh"
    exit 1
fi

# Parse arguments
SIGN=true
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-sign)
            SIGN=false
            shift
            ;;
        --sign)
            SIGN=true
            shift
            ;;
        --help|-h)
            echo "Usage: ./scripts/build-mac.sh [--no-sign]"
            echo ""
            echo "Options:"
            echo "  --no-sign    Disable code signing (unsigned build)"
            echo "  --sign       Enable code signing (default)"
            echo "  -h, --help   Show this help message"
            echo ""
            echo "Note: By default, the script will attempt to sign the app."
            echo "      If no certificate is found, it will fail."
            echo "      Use --no-sign to build without signing."
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

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

# Configure signing
if [ "$SIGN" = true ]; then
    echo -e "\n🔐 Code signing enabled"
    echo -e "${YELLOW}⚠️  Make sure you have set up your Apple Developer ID certificates${NC}"
    
    # Check for certificates
    CERT_COUNT=$(security find-identity -v -p codesigning 2>/dev/null | grep -c "Developer ID Application" || echo "0")
    if [ "$CERT_COUNT" -eq "0" ]; then
        echo -e "${RED}❌ No Developer ID Application certificate found${NC}"
        echo ""
        echo "To set up signing, you need:"
        echo "1. An Apple Developer account"
        echo "2. A 'Developer ID Application' certificate"
        echo ""
        echo "To create one:"
        echo "1. Go to https://developer.apple.com/account/resources/certificates/list"
        echo "2. Click '+' to create a new certificate"
        echo "3. Choose 'Developer ID Application'"
        echo "4. Follow the instructions to download and install"
        echo ""
        echo "Or run without --sign for unsigned build"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Found $CERT_COUNT Developer ID certificate(s)${NC}"
    
    # Build signed
    echo -e "\n🍎 Building signed macOS dmg..."
    electron-builder --mac dmg --publish never
else
    echo -e "\n🔓 Code signing disabled (unsigned build)"
    echo -e "${BLUE}💡 Tip: Remove --no-sign flag to enable signing${NC}"
    echo ""
    
    # Build unsigned - temporarily modify config
    echo "🍎 Building unsigned macOS dmg..."
    
    # Create a temporary config that forces unsigned build
    TMP_CONFIG=$(mktemp)
    cat > "$TMP_CONFIG" << 'EOF'
appId: com.mindos.desktop
productName: MindOS
copyright: Copyright © 2026 MindOS

directories:
  buildResources: src/icons
  output: dist

files:
  - dist-electron/**/*
  - src/connect.html
  - src/splash.html
  - src/icons/**/*
  - "!**/node_modules/.cache"
  - "!**/.turbo"
  - "!**/__tests__/**"
  - "!**/test/**"

mac:
  category: public.app-category.productivity
  icon: src/icons/icon.png
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  hardenedRuntime: false
  gatekeeperAssess: false
  identity: null

asar: true

publish:
  provider: github
  owner: GeminiLight
  repo: MindOS
EOF
    
    electron-builder --mac dmg --config "$TMP_CONFIG" --publish never
    rm "$TMP_CONFIG"
fi

echo -e "\n${GREEN}✅ Build complete!${NC}"
echo -e "\n📁 Output files:"
ls -lh dist/*.dmg 2>/dev/null || echo "No dmg files found"

if [ "$SIGN" = false ]; then
    echo -e "\n${YELLOW}⚠️  This build is UNSIGNED${NC}"
    echo "Users may see 'App is damaged' warning on macOS 10.15+"
    echo ""
    echo "To fix, users can run:"
    echo "   xattr -cr /Applications/MindOS.app"
    echo ""
    echo "Or open System Preferences > Security & Privacy > Open Anyway"
else
    echo -e "\n${GREEN}✅ This build is SIGNED${NC}"
    echo "Users can open the app directly without warnings"
fi

echo ""
echo -e "${GREEN}🎉 Done!${NC}"
