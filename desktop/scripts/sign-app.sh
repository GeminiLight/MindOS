#!/bin/bash
# Ad-Hoc 签名脚本 - 用于本地重新签名应用
# 解决 macOS Gatekeeper 拦截和 Apple Silicon 兼容性问题

APP_PATH="${1:-/Applications/MindOS.app}"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ 错误: 找不到应用 $APP_PATH"
    echo "用法: ./sign-app.sh [应用路径]"
    echo "示例: ./sign-app.sh ~/Downloads/MindOS.app"
    exit 1
fi

echo "🔏 正在为 $APP_PATH 进行 Ad-Hoc 签名..."
codesign --force --deep --sign - "$APP_PATH"

if [ $? -eq 0 ]; then
    echo "✅ 签名成功！"
    echo ""
    echo "现在你可以尝试打开应用了。"
    echo "如果仍然提示'无法验证开发者'，请前往："
    echo "系统设置 → 隐私与安全性 → 安全性 → 点击'仍要打开'"
else
    echo "❌ 签名失败"
    exit 1
fi
