# Spec: 新建心智空间 (Create Space)

## 目标

在首页 Spaces 区域增加"新建空间"入口，让用户一步创建完整的 Space（目录 + INSTRUCTION.md + README.md），强化"Space 是 Agent 执行上下文"的产品认知，而非"只是建了个文件夹"。

## 现状分析

当前用户创建新 Space 的方式：
1. **通过 Agent**：告诉 AI "在 Learning 目录创建一个文件"，`createFile` 触发 `scaffoldIfNewSpace`
2. **通过侧边栏**：在文件树里创建 `Learning/note.md`，隐式创建目录 + 触发脚手架
3. **无直接入口**：没有"新建空间"按钮，用户不知道可以自建 Space

**问题**：
- 用户看到首页 6 个预置 Space 卡片，不知道可以加更多
- 创建路径是间接的（先创建文件才产生目录），心智负担高
- 新空间的 INSTRUCTION.md 是通用模板，用户的意图（"这个空间用来干嘛"）没有被捕获

## 数据流 / 状态流

```
首页 Spaces 区域
  │
  ├─ 展示 Space 卡片 grid
  │   └─ 末尾：[+ 新建空间] 卡片（虚线边框）
  │
  ├─ 用户点击 [+] → 原地展开 inline 表单
  │   ├─ 空间名称输入（必填，如 "Learning"）
  │   ├─ emoji 选择（可选，默认自动匹配）
  │   ├─ 一句话描述（可选，如 "Personal learning notes"）
  │   └─ [创建] 按钮
  │
  ├─ 提交 → POST /api/file { op: "create_file", path: "{emoji} {name}/README.md", content: "..." }
  │   └─ createFile() → mkdirSync + writeFile → scaffoldIfNewSpace()
  │       ├─ 生成 INSTRUCTION.md（通用模板）
  │       └─ README.md 已在 createFile 时写入（含用户描述）
  │
  ├─ 成功 → router.refresh() → 新 Space 卡片出现在 grid 中
  │
  └─ 失败 → 显示错误信息（名称冲突等）
```

**关键**：不需要新 API。复用 `createFileAction`，创建 `{name}/README.md` 时带上用户描述作为内容，`scaffoldIfNewSpace` 自动补 `INSTRUCTION.md`。

## 方案

### 交互设计

**入口**：Spaces grid 末尾的 "+" 卡片，和其他 Space 卡片同尺寸，虚线边框 + "New Space" 文字。

```
┌──────────────┐ ┌──────────────┐ ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
│ 👤           │ │ 📝           │ │              │
│ Profile      │ │ Notes        │ │   + New      │
│ 5 files      │ │ 12 files     │ │   Space      │
└──────────────┘ └──────────────┘ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

**点击后**："+" 卡片原地替换为 inline 表单（不弹 modal，保持空间感）：

```
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ 👤           │ │ 📝           │ │ 📁 Space name    │
│ Profile      │ │ Notes        │ │ Purpose (opt.)   │
│ 5 files      │ │ 12 files     │ │ [Cancel] [Create]│
└──────────────┘ └──────────────┘ └──────────────────┘
```

**表单字段**：

| 字段 | 必填 | 说明 |
|------|------|------|
| 名称 | ✅ | Space 名称，如 "Learning"。自动检测冲突 |
| 描述 | 可选 | 一句话用途，写入 README.md 标题下方 |

**不做 emoji 选择器**：emoji 让用户自己在名称里打（如 "📖 Learning"），或者不打也行。减少 UI 复杂度。

### 创建逻辑

```typescript
async function handleCreateSpace(name: string, description: string) {
  const trimmed = name.trim();
  if (!trimmed) return;

  // 构建 README.md 内容
  const readmeContent = `# ${trimmed.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || trimmed}

${description.trim() || '(Describe the purpose and usage of this space.)'}

## 📁 Structure

\`\`\`bash
${trimmed}/
├── INSTRUCTION.md
├── README.md
└── (your files here)
\`\`\`
`;

  // 创建 README.md → 触发 scaffoldIfNewSpace 生成 INSTRUCTION.md
  const result = await createFileAction(trimmed, 'README.md');
  // 但 createFileAction 会强制加 .md 后缀...需要改

  // 实际需要用 POST /api/file 直接传 content
}
```

**问题**：`createFileAction` 不支持传 `content`，且会给文件名加 `.md` 后缀。需要新增一个 Server Action 或直接调用 `/api/file`。

最简方案：**新增 `createSpaceAction`**，专门处理 Space 创建：

```typescript
// actions.ts
export async function createSpaceAction(
  name: string,
  description: string
): Promise<{ success: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: 'Name is required' };

  const cleanName = trimmed.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || trimmed;
  const readmeContent = `# ${cleanName}\n\n${description.trim() || '(Describe the purpose and usage of this space.)'}\n`;

  try {
    createFile(`${trimmed}/README.md`, readmeContent);
    // scaffoldIfNewSpace auto-generates INSTRUCTION.md
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create space' };
  }
}
```

### 前端组件

在 HomeContent 的 Spaces grid 末尾加 `CreateSpaceCard`：

- **默认状态**：虚线卡片，`+` 图标 + "New Space" 文字
- **编辑状态**：name input + description input + Cancel/Create 按钮
- **Loading 状态**：Create 按钮 spinner
- **成功**：收起表单，`router.refresh()` 让新卡片出现
- **失败**：input 下方显示错误信息

### i18n

```typescript
home: {
  newSpace: 'New Space',
  spaceName: 'Space name',
  spaceDescription: 'What is this space for? (optional)',
  createSpace: 'Create',
  cancelCreate: 'Cancel',
  spaceNameRequired: 'Space name is required',
  spaceAlreadyExists: 'A space with this name already exists',
}
```

### 不做什么

| 排除项 | 原因 |
|--------|------|
| **Emoji 选择器** | 用户可以在名称里直接打 emoji，选择器增加复杂度 |
| **模板选择** | 预置的 INSTRUCTION.md 模板已够用，自定义 INSTRUCTION 是高级需求 |
| **拖拽排序** | Space 按文件系统字母序，不引入自定义排序 |
| **删除 Space** | 危险操作，留给文件管理器或 Agent |
| **Modal 弹窗** | Inline 表单更自然，保持空间上下文 |

## 影响范围

### 新增

| 文件 | 说明 |
|------|------|
| (无新文件) | 全部在现有文件中修改 |

### 修改

| 文件 | 改动 |
|------|------|
| `app/lib/actions.ts` | 新增 `createSpaceAction()` |
| `app/components/HomeContent.tsx` | Spaces grid 末尾加 CreateSpaceCard |
| `app/lib/i18n-en.ts` | 新增 6 个 `home.newSpace.*` key |
| `app/lib/i18n-zh.ts` | 同上中文版 |

### 不改动

| 文件 | 原因 |
|------|------|
| `space-scaffold.ts` | 自动触发，不需要改 |
| `fs-ops.ts` | createFile 已有 scaffold hook |
| `page.tsx` | getTopLevelDirs 已自动发现新 Space |

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | 名称为空 | 前端 disabled + 后端验证 |
| 2 | 名称含特殊字符（`../`、`\`） | `resolveSafe` 已有路径遍历防护 |
| 3 | 名称与已有 Space 冲突 | `createFile` 的 `mkdirSync` 不报错，但 `README.md` 已存在会报 `FILE_ALREADY_EXISTS` |
| 4 | 名称很长（>100 字符） | 前端 maxLength 限制 |
| 5 | 只输入 emoji 没有文字 | `cleanDirName` fallback 到原始名，INSTRUCTION 标题用 emoji |
| 6 | 并发创建同名 Space | `createFile` 的 `existsSync` 检查 + 文件系统原子性保护 |
| 7 | 描述含 markdown 注入 | 描述写入 README.md，markdown 内容是合法的 |
| 8 | 创建后不刷新 | `revalidatePath` + `router.refresh()` |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 用户创建太多 Space | 低 | 首页已有折叠（>6 个显示 Show more），不影响体验 |
| inline 表单在移动端太窄 | 低 | 表单在 grid 中占 full-width（col-span-full），移动端自适应 |

## 验收标准

- [ ] 首页 Spaces grid 末尾出现 "+" 虚线卡片
- [ ] 点击展开 inline 表单（名称 + 描述 + Cancel/Create）
- [ ] 输入名称 + 点 Create → 新 Space 出现在 grid 中
- [ ] 新 Space 有 INSTRUCTION.md + README.md
- [ ] README.md 包含用户输入的描述
- [ ] 空名称 → Create 按钮 disabled
- [ ] 已存在名称 → 显示错误
- [ ] Cancel → 收起表单恢复 "+" 卡片
- [ ] ESC → 收起表单
- [ ] i18n en/zh 正常
- [ ] 移动端表单布局正常
