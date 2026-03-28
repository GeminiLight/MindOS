#!/bin/bash

# ============================================
# MindOS Desktop - Linux Build Script
# Usage: ./scripts/build-linux.sh [--mac-zip]
# Output: dist/*.AppImage, dist/*.deb (default)
#         dist/*.zip (with --mac-zip, cross-compile unsigned macOS zip)
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

cd "$PROJECT_DIR"

MAC_ZIP=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --mac-zip)  MAC_ZIP=true; shift ;;
        --help|-h)
            echo "Usage: ./scripts/build-linux.sh [--mac-zip]"
            echo ""
            echo "Options:"
            echo "  --mac-zip    Cross-compile unsigned macOS zip (instead of Linux packages)"
            echo "  -h, --help   Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
cd "$REPO_ROOT"
cd app && npm install && cd "$REPO_ROOT"
cd mcp && npm install && cd "$REPO_ROOT"
cd desktop && npm install && cd "$REPO_ROOT"

# Build Next.js standalone
echo -e "\n${YELLOW}Building Next.js standalone...${NC}"
cd "$REPO_ROOT"
node scripts/gen-renderer-index.js
cd app && ./node_modules/.bin/next build --webpack && cd "$REPO_ROOT"

# Build Electron
echo -e "\n${YELLOW}Building Electron...${NC}"
cd "$PROJECT_DIR"
npm run build

# Prepare runtime
echo -e "\n${YELLOW}Preparing bundled runtime...${NC}"
npm run prepare-mindos-runtime

# Package
if [ "$MAC_ZIP" = true ]; then
    echo -e "\n${YELLOW}Building macOS zip (unsigned, cross-compile from Linux)...${NC}"
    CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac zip --publish never
    echo -e "\n${GREEN}Done!${NC}"
    ls -lh dist/*.zip 2>/dev/null
    echo -e "\n${YELLOW}These builds are UNSIGNED. Users need: xattr -cr /Applications/MindOS.app${NC}"
else
    echo -e "\n${YELLOW}Building Linux packages...${NC}"
    electron-builder --linux --publish never
    echo -e "\n${GREEN}Done!${NC}"
    ls -lh dist/*.AppImage dist/*.deb 2>/dev/null
fi
