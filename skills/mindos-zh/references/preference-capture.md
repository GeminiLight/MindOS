# 偏好捕获（`user-preferences.md`）

## 何时捕获

用户在操作中表达偏好修正（如「以后不要…」「下次记得…」「这个应该放在…而不是…」）。

未来时态的偏好表述不是保存授权。「以后…」「下次…」「from now on…」「next time…」只表示一个候选长期偏好，仍然必须走“先确认、再写入”流程，除非用户明确说“保存 / 记录 / 写入这条偏好”，或已有自动确认规则适用。

## 确认后写入流程

不要只凭记忆回答。决定询问还是写入之前，在文件工具可用时必须用读取/列表工具读取 `.mindos/user-preferences.md`。这是为了识别 `auto-confirm-all: true` 或匹配类别的 `auto-confirm: true`。

1. **某类偏好首次出现**：先提议，用户确认后再写入。
   - 「记录此偏好到 `user-preferences.md`？规则：_{摘要}_」
   - 仅在用户确认后写入。
2. **同类偏好确认 3 次以上**：该类别在 `user-preferences.md` 中标记 `auto-confirm: true`，后续同类偏好自动写入，不再询问。
3. **用户明确授权**（如「偏好直接记就行」）：设置顶层 `auto-confirm-all: true`，之后所有偏好跳过确认直接写入。
4. **没有自动确认规则**：如果 `.mindos/user-preferences.md` 不存在，或只包含默认的 false 确认标记（`auto-confirm-all: false`、类别 `auto-confirm: false`），不要追加写入，必须先询问确认。

## 文件位置

- 目标：知识库 `.mindos/user-preferences.md`（存在时由 `mindos_bootstrap` 读取）。
- 若文件不存在，在首次确认写入时按下方模板创建。

## 文件模板

```markdown
# User Skill Rules
<!-- auto-confirm-all: false -->

## Preferences
<!-- 按类别分组。确认 3 次以上的类别标记 auto-confirm: true。 -->

## Suppressed Hooks
<!-- 列出用户已关闭的 Post-Task Hooks。 -->
```

## 规则格式

每条规则以列表项写在对应类别下：

```markdown
### {类别名}
<!-- auto-confirm: false -->
- {规则描述} — _{记录日期}_
```
