# MindOS Demo Video

使用 Remotion 制作的产品演示视频。

## 快速开始

```bash
cd demo
npm install
npm run dev      # 启动 Remotion Studio（可视化编辑）
npm run build    # 渲染视频到 out/demo.mp4
```

## 场景结构

- **Scene 1 (0-5s)**: 问题场景 - 多窗口混乱
- **Scene 2 (5-15s)**: MindOS 界面 - ⌘K 搜索演示
- **Scene 3 (15-25s)**: 核心功能展示
- **Scene 4 (25-30s)**: CTA - GitHub star

## 添加背景音乐

1. **下载音乐**：从 [Pixabay](https://pixabay.com/music) 或 [Mixkit](https://mixkit.co/free-stock-music) 下载
   - 推荐搜索："tech ambient"、"minimal corporate"
   - 时长：至少 30 秒
   - 格式：MP3

2. **放入项目**：
   ```bash
   # 将下载的音乐文件重命名并放入 public 目录
   mv ~/Downloads/your-music.mp3 demo/public/background-music.mp3
   ```

3. **调整音量**：在 `src/Root.tsx` 中修改 `volume` 参数（0.0-1.0）

4. **重新渲染**：
   ```bash
   npm run build
   ```

## 音乐推荐（Pixabay）

搜索这些关键词找到适合的音乐：
- "tech ambient" - 科技氛围感
- "minimal corporate" - 简约商务风
- "uplifting technology" - 积极科技感
- "modern innovation" - 现代创新

**避免**：过于激烈的电子乐、带人声的、节奏太强的

## 自定义

所有场景在 `src/scenes/` 目录下，可以：
- 调整时长：修改 `startFrame` / `endFrame`
- 修改文案：直接编辑组件内的文字
- 调整动画：修改 `interpolate` / `spring` 参数
- 添加真实截图：放到 `public/` 目录，用 `<Img>` 引入

## 渲染选项

```bash
# 渲染为 MP4（默认）
npm run build

# 渲染为 GIF
remotion render MindOSDemo out/demo.gif --codec gif

# 渲染单帧（用于缩略图）
remotion still MindOSDemo out/thumbnail.png --frame=450

# 自定义分辨率
remotion render MindOSDemo out/demo-720p.mp4 --width=1280 --height=720
```

## 下一步优化

1. **替换模拟界面为真实截图**：用 Playwright 自动截取 `localhost:4567` 的关键页面
2. **添加真实操作录屏**：Scene 2 可以嵌入真实的搜索操作视频
3. **配音/字幕**：Remotion 支持 `<Audio>` 和 `<Subtitle>` 组件
4. **多语言版本**：复制 `Root.tsx`，创建 `Root-en.tsx`
