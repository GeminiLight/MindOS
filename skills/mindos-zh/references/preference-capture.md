# 偏好捕获（`user-preferences.md`）

## 何时捕获

用户在操作中表达偏好修正（如「以后不要…」「下次记得…」「这个应该放在…而不是…」）。

## 确认后写入流程

1. **某类偏好首次出现**：先提议，用户确认后再写入。
   - 「记录此偏好到 `user-preferences.md`？规则：_{摘要}_」
   - 仅在用户确认后写入。
2. **同类偏好确认 3 次以上**：该类别在 `user-preferences.md` 中标记 `auto-confirm: true`，后续同类偏好自动写入，不再询问。
3. **用户明确授权**（如「偏好直接记就行」）：设置顶层 `auto-confirm-all: true`，之后所有偏好跳过确认直接写入。

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
