#!/bin/bash
# 阿里云 OSS 验证脚本
# 用法: bash scripts/test-oss.sh

set -e

# ── 配置（改成你的值）──
OSS_ACCESS_KEY_ID="${OSS_ACCESS_KEY_ID:-请填写你的AccessKeyID}"
OSS_ACCESS_KEY_SECRET="${OSS_ACCESS_KEY_SECRET:-请填写你的AccessKeySecret}"
OSS_ENDPOINT="oss-cn-hangzhou.aliyuncs.com"
OSS_BUCKET="mindos-cn-releases"

if [[ "$OSS_ACCESS_KEY_ID" == "请填写"* ]]; then
    echo "请先设置环境变量："
    echo "  export OSS_ACCESS_KEY_ID=你的ID"
    echo "  export OSS_ACCESS_KEY_SECRET=你的Secret"
    echo "  bash scripts/test-oss.sh"
    exit 1
fi

echo "=== 阿里云 OSS 连通性测试 ==="
echo "Bucket: $OSS_BUCKET"
echo "Endpoint: $OSS_ENDPOINT"
echo ""

# 用 curl + OSS REST API 签名上传测试文件（不依赖任何 CLI 工具）
DATE=$(date -u +"%a, %d %b %Y %H:%M:%S GMT")
OBJECT_KEY="test-upload-$(date +%s).txt"
CONTENT="hello from MindOS CI test"
CONTENT_TYPE="text/plain"
RESOURCE="/${OSS_BUCKET}/${OBJECT_KEY}"

# 计算签名
STRING_TO_SIGN="PUT\n\n${CONTENT_TYPE}\n${DATE}\n${RESOURCE}"
SIGNATURE=$(printf "$STRING_TO_SIGN" | openssl dgst -sha1 -hmac "$OSS_ACCESS_KEY_SECRET" -binary | base64)

# 上传
echo "1. 上传测试文件: ${OBJECT_KEY}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT \
    -H "Date: ${DATE}" \
    -H "Content-Type: ${CONTENT_TYPE}" \
    -H "Authorization: OSS ${OSS_ACCESS_KEY_ID}:${SIGNATURE}" \
    -d "${CONTENT}" \
    "https://${OSS_BUCKET}.${OSS_ENDPOINT}/${OBJECT_KEY}")

if [ "$HTTP_CODE" = "200" ]; then
    echo "   上传成功 (HTTP $HTTP_CODE)"
else
    echo "   上传失败 (HTTP $HTTP_CODE)"
    echo "   检查 AccessKey 和 Bucket 权限"
    exit 1
fi

# 公网读取
echo "2. 公网访问测试:"
PUBLIC_URL="https://${OSS_BUCKET}.${OSS_ENDPOINT}/${OBJECT_KEY}"
echo "   URL: $PUBLIC_URL"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL")

if [ "$HTTP_CODE" = "200" ]; then
    echo "   公网访问成功 (HTTP $HTTP_CODE) — 公共读已开启"
else
    echo "   公网访问失败 (HTTP $HTTP_CODE) — 请在 OSS 控制台开启公共读"
fi

# 清理
echo "3. 清理测试文件..."
DATE=$(date -u +"%a, %d %b %Y %H:%M:%S GMT")
STRING_TO_SIGN="DELETE\n\n\n${DATE}\n${RESOURCE}"
SIGNATURE=$(printf "$STRING_TO_SIGN" | openssl dgst -sha1 -hmac "$OSS_ACCESS_KEY_SECRET" -binary | base64)

curl -s -o /dev/null \
    -X DELETE \
    -H "Date: ${DATE}" \
    -H "Authorization: OSS ${OSS_ACCESS_KEY_ID}:${SIGNATURE}" \
    "https://${OSS_BUCKET}.${OSS_ENDPOINT}/${OBJECT_KEY}"
echo "   已清理"

echo ""
echo "=== 测试完成 ==="
