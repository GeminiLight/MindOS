# 待办清单 (TODO)

## 🔥 高优先级

### 界面和交互优化
- [ ] **文件树刷新不及时** - 文件增删时未及时显示
- [ ] **Agent对话框按钮问题** - 删除历史对话等功能存在bug
- [ ] **File Panel层级管理** - 支持一键折叠/扩展层级

### Agent 功能
- [ ] **Agent 对比视图** - 实现Agent版本对比功能
- [ ] **Agents 面板增强**
  - 允许自定义Agent
- [ ] **ACP for call / Agent as Workflow** - Agent调用协议

### Desktop APP
- [ ] **首次打开模式选择** - 默认本地模式，应让用户选择本地/remote
- [ ] **内置固定版本** - 内置build版本，未安装也能打开，检测到更高版本时切换

### 文档与模板
- [ ] **优化README.md**
- [ ] **优化VISION文本** - 独立product-vision.md到wiki

## ⚡ 功能增强

- [ ] **webpage wording skill** - 网页文案技能
- [ ] **插件市场/技能市场** - Discover中的市场功能完善
- [ ] **审计功能增强** - Review change优化
- [ ] **多终端管理** - 多个Terminal端口管理

## 🧩 架构与扩展

- [ ] **模块解耦** - 模块化架构
- [ ] **插件架构** - 保持灵活性和可扩展性，最小化侵入主代码
- [ ] **避免硬编码** - json变量等
- [ ] **评论/批注机制** - Human-AI异步协作
  - `mindos_add_comment(path, line, content)`
  - `mindos_get_comments(path)`

## 🔧 技术改进

- [ ] **MindOS Agent时间感知** - 时间感知功能
- [ ] **Editor功能增强** - 编辑器功能完善
- [ ] **模板管理改进** - Space目录通过INSTRUCTION.md自动管理

## 🎨 UI/UX

- [ ] **首页调整**
  - search files 和 Ask AI 调换位置和大小
  - Plugins 放在 Recently Modified 上面
  - New note → New Notes（修复404）
- [ ] **LANDING page** - 节日祝福例子
- [ ] **分享功能** - 分享模板或md

## 💡 创新功能

- [ ] **AI自主执行** - Agent自主执行零散想法
- [ ] **自动SOP复盘** - Agent帮助复盘，通过MCP存到MindOS
- [ ] **创造者故事**
- [ ] **使用案例完善**

## 📝 其他

- [ ] 优化Skill
- [ ] 提示用户端口开放（外部访问GUI和MCP）
- [ ] 更新文件夹目录为MindOS
- [ ] CLI下载命令优化

### 命令行和下载
```bash
curl -L -o ~/Downloads/MindOS-0.1.0-arm64-mac.zip 'http://21.6.243.108:8080/desktop/dist/MindOS-0.1.0-arm64-mac.zip'
cd ~/Downloads && unzip MindOS-0.1.0-arm64-mac.zip && open MindOS-0.1.0-arm64.dmg
```

### CI 更新提示
还没发布到 0.5.1，CI 还在跑。可以稍后手动执行：
```bash
npm install -g @geminilight/mindos@latest
# 或者使用本地版本
cd /data/home/geminitwang/code/mindos && npm link
```

### 用户体验待改进点
- 历史对话的问题
- 用户模糊/不友好的地方需要进一步识别
