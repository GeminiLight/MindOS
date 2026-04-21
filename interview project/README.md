# Interview Project Package

这个目录是为面试笔试作业准备的完整项目包，主题是：**我独立完成过的代表性 vibe coding 项目——MindOS**。

## 交付清单

- `MindOS-面试项目案例-LaTeX版.pdf`
  - 已编译好的正式提交版 PDF，适合直接发给老师。
- `01-MindOS-项目案例.md`
  - 可直接作为主提交文档，覆盖用户场景分析、解决方案、技术选型、系统架构、原型截图、项目复盘。
- `02-资料研读与提炼.md`
  - 我基于仓库 `README / docs / startup / wiki` 提炼出的素材地图，便于你面试时追溯依据。
- `03-原型录屏脚本.md`
  - 90 秒演示版脚本，适合你自己补录一版真人操作视频。
- `assets/screenshots/`
  - 已整理好的项目截图素材。
- `assets/video/mindos-walkthrough.mp4`
  - 基于现有产品截图生成的短版 walkthrough 视频。
- `assets/video/build_walkthrough.sh`
  - 可重复生成 walkthrough 视频的脚本。
- `latex/mindos-interview-report.tex`
  - LaTeX 源文件，可继续微调排版、标题、颜色和内容。

## 建议提交方式

1. 优先提交 `MindOS-面试项目案例-LaTeX版.pdf` 作为主文档。
2. 附上 `assets/screenshots/` 中 3-5 张核心截图。
3. 如果老师允许附件，再附上 `assets/video/mindos-walkthrough.mp4`。
4. 面试口头介绍时，可以按 `03-原型录屏脚本.md` 的顺序讲。

## LaTeX 版本说明

- 编译产物：`dist/mindos-interview-report.pdf`
- 源文件：`latex/mindos-interview-report.tex`
- 重新编译：
  ```bash
  cd "interview project/latex"
  ./build.sh
  ```

## 我帮你这次做了什么

- 系统梳理了项目的产品叙事、目标用户、架构、协议、设计原则和演进路线。
- 把零散的 startup / wiki / docs 信息，重新组织成适合“面试作业”阅读的案例表达。
- 单独整理了截图与视频素材，避免你后面还要手忙脚乱地补资产。
- 额外制作了更正式的 LaTeX 版 PDF，适合“笔试作业 / 提交件”风格。

## 使用提示

- 如果你需要更“面试官风格”的版本，可以再把主文档压缩成 2-3 页执行摘要。
- 如果你需要更“创业者风格”的版本，可以加强商业模式、竞争分析和 Why Now。
- 如果你需要更“工程师风格”的版本，可以加强协议设计、数据流和质量保障流程。
