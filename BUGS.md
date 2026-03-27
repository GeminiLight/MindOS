**API Key 方式（方案 B）更好、更被推荐。**

### 对比

| | Apple ID 方式 | API Key 方式 |
|---|---|---|
| **稳定性** | ⚠️ 偶尔因 2FA/session 过期卡住 | ✅ 纯 token 认证，无 2FA 问题 |
| **速度** | 较慢（走旧的 altool 通道） | 更快（走 notarytool 原生通道） |
| **Apple 官方态度** | 已标记为 legacy | ✅ 当前推荐方式 |
| **electron-builder 支持** | 支持 | ✅ 支持 |
| **安全性** | 需要暴露 Apple ID + 密码 | ✅ 只需要一个受限 API Key，可随时吊销 |
| **CI 普及度** | 老项目还在用 | ✅ 新项目基本都用这个 |

### 结论

**等签名跑通后，直接切 API Key 方式。** 步骤很简单：

1. 去 [App Store Connect](https://appstoreconnect.apple.com) → 用户和访问 → 集成 → App Store Connect API → 生成密钥
2. 记下 **Issuer ID** 和 **Key ID**，下载 `.p8` 文件（只能下载一次）
3. GitHub 加 3 个 Secret，删掉旧的 2 个

现在先集中精力把 p12 密码问题解决 → 签名跑通 → 再换公证方式。一步一步来。

到位了。点击 **"Generate API Key"** 蓝色按钮，然后：

1. **Name**：填 `GitHub Actions` 或 `CI Notarization`（随便取）
2. **Access**：选 **Developer**（够用了）
3. 点 **Generate**

生成后页面会显示：
- **Issuer ID**（页面顶部，一串 UUID）
- **Key ID**（列表里的短字符串）
- **Download API Key**（下载 `.p8` 文件，**只能下载一次**，务必保存好）

这三个东西拿到后告诉我，我帮你配 GitHub Secrets 和改 workflow。

好，三个信息齐了。先把 .p8 文件转 base64：

查看 .p8 文件内容确认完整性

cat /Users/geminilight/Downloads/AuthKey_NQ8ZM3WLHB.p8
将 .p8 文件转为 base64 用于 GitHub Secret

base64 -i /Users/geminilight/Downloads/AuthKey_NQ8ZM3WLHB.p8 | tr -d '\n'
都拿到了。现在去 GitHub → Settings → Secrets → Actions，操作如下：

添加 3 个新 Secret
Secret 名称	值
APPLE_API_ISSUER	<your-issuer-id>
APPLE_API_KEY_ID	<your-key-id>
APPLE_API_KEY	<base64-encoded-p8-file>
可以删除的旧 Secret（可选）
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
（APPLE_TEAM_ID 保留，electron-builder 签名时还会用到）

修改 workflow
Package 步骤的环境变量改成：

yaml
复制
      - name: Prepare API Key
        if: matrix.platform == 'mac'
        run: |
          mkdir -p ~/private_keys
          echo "$APPLE_API_KEY_BASE64" | base64 --decode > ~/private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8
        env:
          APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY }}

      - name: Package (${{ matrix.platform }})
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          EP_GH_IGNORE_TIME: true
          EP_DRAFT: false
          # macOS 签名
          CSC_LINK: ${{ secrets.APPLE_CERTIFICATE_BASE64 }}
          CSC_KEY_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          # macOS 公证 (API Key)
          APPLE_API_KEY: ~/private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
        run: |
          if [ "${{ inputs.publish }}" = "true" ]; then
            cd desktop && npx electron-builder --${{ matrix.platform }} --publish always
          else
            cd desktop && npm run dist:${{ matrix.platform }}
          fi
        shell: bash
关键点：APPLE_API_KEY 需要的是文件路径不是内容，所以加了一个 Prepare API Key 步骤先把 base64 解码成 .p8 文件。

配好 Secret + 改完 workflow 后 push 重新跑。