# Desktop 下载分发策略

*2026-03-27*

---

## 现状

所有 Desktop 下载链接指向 GitHub Releases：

```
https://github.com/GeminiLight/MindOS/releases/latest/download/MindOS-mac-arm64.dmg
```

**问题：**

| 问题 | 影响 |
|------|------|
| GitHub Releases 国内访问慢或不通 | 中国用户下载失败/超时 |
| 单一源，无容灾 | GitHub CDN 偶发故障时全球不可用 |
| `latest` tag 指向 npm 版本而非 Desktop 版本 | Desktop 用 `desktop-v0.1.0` tag，latest 可能匹配不上 |

---

## 方案对比

### 方案 A：Cloudflare R2（推荐，最简单）

- **成本**：免费额度 10GB 存储 + 无出站费
- **原理**：CI 构建完成后把安装包上传到 R2，绑定自定义域名（如 `dl.mindos.ai`）
- **国内**：Cloudflare 在国内虽不快但稳定可达，比 GitHub 好很多
- **国际**：Cloudflare 全球边缘节点，速度优秀
- **实现**：`build-desktop.yml` 的 publish step 加一步 `wrangler r2 object put`
- **URL 结构**：

```
dl.mindos.ai/desktop/v0.1.0/MindOS-mac-arm64.dmg
dl.mindos.ai/desktop/latest/MindOS-mac-arm64.dmg  (每次构建覆盖)
```

### 方案 B：Cloudflare R2 + 阿里云 OSS 双源（国内最优）

- 在方案 A 基础上，多加一个阿里云 OSS bucket + CDN
- 官网 JS 检测用户地理位置，自动切换下载源
- 国内用户 → `cn-dl.mindos.ai`（阿里云 OSS + CDN）
- 国际用户 → `dl.mindos.ai`（Cloudflare R2）
- **成本**：阿里云 OSS ~几块钱/月

### 方案 C：GitHub Release Proxy（临时过渡）

- 不改 CI，官网 JS 中对国内用户替换 URL 前缀
- 使用公共代理如 `https://ghfast.com/` 或 `https://gh-proxy.com/`
- **缺点**：依赖第三方代理稳定性，不适合长期

---

## 执行路线

| 阶段 | 方案 | 时机 | 改动范围 | 状态 |
|------|------|------|---------|------|
| **短期+中期** | 方案 A+B 同步落地 | 现在 | CI 双源上传 + landing 地理路由 | ✅ 代码已提交 |
| ~~临时~~ | ~~方案 C — Proxy 过渡~~ | ~~方案 A 落地前~~ | — | 跳过 |

---

## 实现细节（方案 A+B 同步）

### 1. CI 改动（`.github/workflows/build-desktop.yml`）

在 `finalize` job 中，先下载所有平台 artifacts，然后并行上传到 R2 和 OSS：

- **Cloudflare R2**：使用 `aws s3 cp` + R2 S3 兼容端点
- **阿里云 OSS**：使用 `ossutil cp`
- 两个上传 step 都有 `if: env.XXX_KEY != ''` 守卫，secrets 未配置时自动跳过
- 每次构建上传到 `desktop/v{VERSION}/` + `desktop/latest/`（覆盖）

### 2. Landing Page 链接更新

- HTML `href` 保持 GitHub Releases 作为静态默认（无 JS 时可用）
- JS 运行后根据地理位置动态替换为 R2 或 OSS 地址
- 每个下载按钮通过 `data-dl-file` 属性标记文件名

### 3. 地理路由（landing/main.js）

- 通过 `navigator.language` + `Intl.DateTimeFormat().timeZone` 判断中国用户
- 国内用户 → 阿里云 OSS 原生域名（`BUCKET.oss-cn-xxx.aliyuncs.com`）
- 国际用户 → Cloudflare R2 原生域名（`pub-xxx.r2.dev`）
- HEAD 请求探测可达性，失败时 fallback 到 GitHub Releases
- **部署时需要**：在 `main.js` 中替换 `DL_INTL` 和 `DL_CN` 两个 TODO 占位符

### 4. 基础设施配置（使用平台原生域名，无需自定义域名）

#### Cloudflare R2
- 创建 R2 bucket `mindos-releases`
- 开启公共访问（Public Access），获得 `pub-xxx.r2.dev` 域名

#### 阿里云 OSS
- Bucket：`mindos-cn-releases`（华东1 杭州），权限"公共读"
- 原生端点：`mindos-cn-releases.oss-cn-hangzhou.aliyuncs.com`

#### GitHub Secrets

| Secret | 用途 |
|--------|------|
| `R2_ACCESS_KEY_ID` | Cloudflare R2 S3 兼容 Access Key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 S3 兼容 Secret Key |
| `R2_ENDPOINT` | R2 S3 端点 `https://<account-id>.r2.cloudflarestorage.com` |
| `OSS_ACCESS_KEY_ID` | 阿里云 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret |
| `OSS_ENDPOINT` | 阿里云 OSS 端点 `https://oss-cn-hangzhou.aliyuncs.com` |
| `OSS_BUCKET` | 阿里云 Bucket 名称 |

---

## 状态

- [ ] Cloudflare R2 bucket 创建 + 开启公共访问
- [ ] R2 Secrets 配置到 GitHub repo
- [ ] 阿里云 OSS bucket 确认 + 权限公共读
- [ ] OSS Secrets 配置到 GitHub repo
- [x] CI workflow 加双源上传 step（`build-desktop.yml` finalize job）
- [x] Landing page 下载按钮加 `data-dl-file` 属性
- [x] Landing page geo-routing JS（`main.js`）
- [ ] 替换 `main.js` 中 `DL_INTL` 和 `DL_CN` 的 TODO 占位符为实际域名
- [ ] 触发一次 `build-desktop` 验证上传
- [ ] 验证国内/国际下载速度
