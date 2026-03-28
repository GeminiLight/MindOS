#!/bin/bash
# 阿里云 OSS 上传测试（纯 curl，和 CI workflow 用同样的签名方式）
# 用法:
#   export OSS_ACCESS_KEY_ID=你的ID
#   export OSS_ACCESS_KEY_SECRET=你的Secret
#   export OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com    # 不带 https://
#   export OSS_BUCKET=mindos-cn-releases
#   bash scripts/test-oss-upload.sh

set -e

: "${OSS_ACCESS_KEY_ID:?请设置 OSS_ACCESS_KEY_ID}"
: "${OSS_ACCESS_KEY_SECRET:?请设置 OSS_ACCESS_KEY_SECRET}"
: "${OSS_ENDPOINT:?请设置 OSS_ENDPOINT (不带 https://)}"
: "${OSS_BUCKET:?请设置 OSS_BUCKET}"

echo "=== OSS 上传测试 ==="
echo "Bucket:   $OSS_BUCKET"
echo "Endpoint: $OSS_ENDPOINT"
echo "URL:      https://${OSS_BUCKET}.${OSS_ENDPOINT}/"
echo ""

# 检查 endpoint 格式
if [[ "$OSS_ENDPOINT" == https://* ]]; then
    echo "错误: OSS_ENDPOINT 不要带 https:// 前缀"
    echo "当前值: $OSS_ENDPOINT"
    echo "应该是: oss-cn-hangzhou.aliyuncs.com"
    exit 1
fi

# 创建测试文件
OBJECT_KEY="test-upload-$(date +%s).txt"
CONTENT_TYPE="text/plain"
TMP_FILE="/tmp/oss-test-$$.txt"
echo "hello from MindOS CI test at $(date)" > "$TMP_FILE"

# 上传函数（和 CI workflow 完全一致）
oss_upload() {
    local file="$1"
    local object_key="$2"
    local content_type="${3:-application/octet-stream}"
    local date_header=$(date -u +"%a, %d %b %Y %H:%M:%S GMT")
    local resource="/${OSS_BUCKET}/${object_key}"
    local string_to_sign="PUT\n\n${content_type}\n${date_header}\n${resource}"
    local signature=$(printf "$string_to_sign" | openssl dgst -sha1 -hmac "$OSS_ACCESS_KEY_SECRET" -binary | base64)
    local url="https://${OSS_BUCKET}.${OSS_ENDPOINT}/${object_key}"

    echo "  URL: $url"
    local http_code=$(curl -s -o /tmp/oss-response.txt -w "%{http_code}" \
        -X PUT \
        -H "Date: ${date_header}" \
        -H "Content-Type: ${content_type}" \
        -H "Authorization: OSS ${OSS_ACCESS_KEY_ID}:${signature}" \
        -T "$file" \
        "$url")

    if [ "$http_code" = "200" ]; then
        echo "  上传成功 (HTTP $http_code)"
        return 0
    else
        echo "  上传失败 (HTTP $http_code)"
        cat /tmp/oss-response.txt 2>/dev/null
        echo ""
        return 1
    fi
}

# 1. 上传
echo "1. 上传测试文件: $OBJECT_KEY"
oss_upload "$TMP_FILE" "$OBJECT_KEY" "text/plain"

# 2. 公网访问
echo ""
echo "2. 公网访问测试:"
PUBLIC_URL="https://${OSS_BUCKET}.${OSS_ENDPOINT}/${OBJECT_KEY}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$PUBLIC_URL")
if [ "$HTTP_CODE" = "200" ]; then
    echo "  公网访问成功 (HTTP $HTTP_CODE)"
    echo "  内容: $(curl -s "$PUBLIC_URL")"
else
    echo "  公网访问失败 (HTTP $HTTP_CODE) — 请在 OSS 控制台开启公共读"
fi

# 3. 清理
echo ""
echo "3. 清理测试文件..."
DATE_HEADER=$(date -u +"%a, %d %b %Y %H:%M:%S GMT")
RESOURCE="/${OSS_BUCKET}/${OBJECT_KEY}"
STRING_TO_SIGN="DELETE\n\n\n${DATE_HEADER}\n${RESOURCE}"
SIGNATURE=$(printf "$STRING_TO_SIGN" | openssl dgst -sha1 -hmac "$OSS_ACCESS_KEY_SECRET" -binary | base64)
curl -s -o /dev/null \
    -X DELETE \
    -H "Date: ${DATE_HEADER}" \
    -H "Authorization: OSS ${OSS_ACCESS_KEY_ID}:${SIGNATURE}" \
    "https://${OSS_BUCKET}.${OSS_ENDPOINT}/${OBJECT_KEY}"
echo "  已清理"

rm -f "$TMP_FILE" /tmp/oss-response.txt
echo ""
echo "=== 测试完成 ==="
