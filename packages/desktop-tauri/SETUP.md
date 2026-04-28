# Desktop Tauri Setup Guide

## Prerequisites Check

Before starting, verify you have the required tools:

### 1. Check Rust

```bash
rustc --version
cargo --version
```

If not installed, run:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 2. Check Node.js

```bash
node --version  # Should be v20+
npm --version
```

### 3. Platform-specific dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

**Windows:**
- Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## Installation

Once prerequisites are met:

```bash
cd packages/desktop-tauri
pnpm install
```

## Verification

Test that everything works:

```bash
# This should compile Rust code and open a window
pnpm run tauri dev
```

If you see errors, check the troubleshooting section in README.md.
