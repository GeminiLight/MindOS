# 📰 X Influencer 日报抓取 SOP

每日抓取 AI influencer 在 X 上的最新动态，整理成 Markdown 笔记。

## 🙋 执行前澄清

- 无需澄清

## 🔍 前置条件检测

```bash
npx playwright --version    # 确认 Playwright 已安装
cat ~/.x-auth.json          # 确认登录态文件存在
```

## 1️⃣ 准备登录态（首次 / 登录态过期时）

**服务器环境（Xvfb + VNC）：**

```bash
# 安装依赖（CentOS/RHEL）
sudo yum install -y xorg-x11-server-Xvfb x11vnc

# 安装 Playwright 浏览器
npx playwright install chromium

# 启动虚拟显示和 VNC
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
x11vnc -display :99 -forever -nopw -bg -o /tmp/x11vnc.log

# 打开浏览器
DISPLAY=:99 npx playwright@latest chromium https://x.com --save-storage=~/.x-auth.json &
```

用 VNC 客户端连接 `<服务器IP>:5900`（无密码），在浏览器中手动登录 X。

登录完成后关闭 VNC 和虚拟显示：

```bash
pkill -f chromium; pkill x11vnc; pkill Xvfb
```

**Mac 环境（更简单）：**

```bash
npx playwright@latest chromium https://x.com --save-storage=~/.x-auth.json
```

手动登录后关闭窗口，登录态自动保存。如在 Mac 上保存，传到服务器：

```bash
scp ~/.x-auth.json <user>@<server>:~/.x-auth.json
```

## 2️⃣ 配置 Playwright MCP

```bash
claude mcp add --scope user playwright npx @playwright/mcp@latest --storage-state ~/.x-auth.json
```

## 3️⃣ 抓取推文

账号列表参考 [ai_influencers.csv](ai_influencers.csv)。

依次访问各账号主页，抓取最近 3-5 条推文：

```
https://x.com/<handle>
```

每条推文记录：发布时间、内容、互动数（点赞/转发/回复）。

## 4️⃣ 整理输出

用 Claude 对抓取内容做摘要，按以下格式生成日报：

```markdown
# 📰 AI Influencer 日报 YYYY-MM-DD

## @handle｜姓名

- **推文摘要**：...
- **亮点**：...
- **链接**：https://x.com/...

---
```

保存到 `Growth/Information/daily/YYYY-MM-DD.md`。

## ✅ 验证清单

- [ ] 登录态文件存在且未过期
- [ ] Playwright MCP 已配置
- [ ] 所有账号均已抓取
- [ ] 日报文件已保存到对应目录
