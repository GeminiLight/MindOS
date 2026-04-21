# 视频质量优化指南

## 编码质量优化

### CRF 值（推荐）
```bash
# 标准质量（默认，2.5MB）
npx remotion render MindOSDemo out/demo.mp4

# 高质量（CRF 18，约 4-5MB）
npx remotion render MindOSDemo out/demo-hq.mp4 --crf=18

# 超高质量（CRF 15，约 8-10MB）
npx remotion render MindOSDemo out/demo-ultra.mp4 --crf=15

# 无损质量（CRF 0，约 50MB+）
npx remotion render MindOSDemo out/demo-lossless.mp4 --crf=0
```

**CRF 说明**：
- 0 = 无损（文件巨大）
- 15-18 = 视觉上接近无损（推荐用于最终发布）
- 23 = 默认值（平衡质量和大小）
- 28+ = 明显压缩痕迹

### H.265 编码（更小文件，更高质量）
```bash
npx remotion render MindOSDemo out/demo-h265.mp4 --codec=h265 --crf=18
```

### ProRes 编码（专业级，用于后期编辑）
```bash
npx remotion render MindOSDemo out/demo-prores.mov --codec=prores
```

## 分辨率优化

### 4K 版本
```bash
npx remotion render MindOSDemo out/demo-4k.mp4 --width=3840 --height=2160 --crf=18
```

### 竖屏版本（适合社交媒体）
```bash
npx remotion render MindOSDemo out/demo-vertical.mp4 --width=1080 --height=1920 --crf=18
```

## 帧率优化

### 60fps 版本（更流畅）
```bash
npx remotion render MindOSDemo out/demo-60fps.mp4 --fps=60 --crf=18
```

## 视觉效果优化

### 1. 添加抗锯齿和阴影
在场景组件中添加：
```tsx
style={{
  textShadow: '0 2px 4px rgba(0,0,0,0.3)',
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
}}
```

### 2. 添加模糊背景
```tsx
style={{
  backdropFilter: 'blur(10px)',
  backgroundColor: 'rgba(26, 26, 26, 0.8)',
}}
```

### 3. 添加渐变效果
```tsx
background: 'linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%)',
```

## 批量渲染脚本

创建 `demo/render-all.sh`：
```bash
#!/bin/bash
# 渲染所有版本

echo "渲染标准版本..."
npx remotion render MindOSDemo out/demo-standard.mp4 --crf=23

echo "渲染高质量版本..."
npx remotion render MindOSDemo out/demo-hq.mp4 --crf=18

echo "渲染 4K 版本..."
npx remotion render MindOSDemo out/demo-4k.mp4 --width=3840 --height=2160 --crf=18

echo "渲染 GIF 版本..."
npx remotion render MindOSDemo out/demo.gif --codec=gif

echo "渲染缩略图..."
npx remotion still MindOSDemo out/thumbnail.png --frame=450

echo "完成！"
ls -lh out/
```

## 推荐配置（用于发布）

```bash
# 最佳平衡：高质量 + 合理文件大小
npx remotion render MindOSDemo out/demo-final.mp4 \
  --crf=18 \
  --codec=h264 \
  --width=1920 \
  --height=1080 \
  --fps=30
```

## 文件大小对比

| 配置 | 文件大小 | 适用场景 |
|------|---------|---------|
| CRF 23 (默认) | 2.5MB | 网页嵌入、快速预览 |
| CRF 18 | 4-5MB | 社交媒体、YouTube |
| CRF 15 | 8-10MB | 官网首页、产品展示 |
| H.265 CRF 18 | 2-3MB | 现代浏览器、移动端 |
| 4K CRF 18 | 15-20MB | 大屏展示、发布会 |
| ProRes | 200MB+ | 后期编辑、广告制作 |

## 优化检查清单

- [ ] 使用 CRF 18 或更低
- [ ] 字体使用 web-safe 字体或嵌入字体
- [ ] 添加文字阴影提高可读性
- [ ] 使用抗锯齿渲染
- [ ] 背景使用渐变而非纯色
- [ ] 动画使用 easing 函数（不要线性）
- [ ] 音频使用 320kbps MP3 或更高
- [ ] 测试在不同设备上的播放效果
