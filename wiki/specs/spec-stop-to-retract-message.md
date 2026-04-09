# Spec: Stop 动作撤回用户消息回输入框

## 目标

当用户在输入聊天消息后点击停止按钮时，该消息应该被撤回到输入框中，而不是留在聊天历史中。这样可以让用户重新编辑或调整消息，同时后续对话中不会意外地包含已停止的消息。

## 现状分析

**当前行为：**

1. 用户输入文本 "你好"
2. 用户点击发送按钮
3. 消息立即加入聊天历史 (`sess.messages`)
4. 输入框被清空
5. 用户看到加载中，点击停止按钮
6. **问题**：用户消息 "你好" 留在聊天历史中，输入框是空的
7. 用户无法撤销或编辑，且在后续对话中，该消息会被发送给 API（因为它在 `messages` 数组中）

**为什么不符合预期：**
- **直觉不符**：点击停止 = 撤销本次操作，但消息已经被发送给服务器，用户无法撤回
- **上下文混乱**：用户停止了响应，却不想发这条消息，但它永久留在了历史中
- **后续对话污染**：下一次对话时，该消息依然会被 API 看到（作为 `requestMessages` 的一部分）
- **编辑困难**：用户想修改停止前的消息内容，必须手动删除历史条目再重新输入

## 数据流 / 状态流

### 当前流程

```
输入框：input = "你好"
    ↓
用户点击发送
    ↓
useAskChat.submit() 被调用
    ├─ 从 input 读取文本 "你好"
    ├─ 创建 userMsg { role: 'user', content: '你好' }
    ├─ requestMessages = [...sess.messages, userMsg]  ← 消息加入待发送队列
    ├─ sess.setMessages([...requestMessages, placeholder assistant msg])  ← 立即写入状态
    └─ 清空输入框：setInput('') ← 用户看不到文本了
    ↓
fetch 到 /api/ask 开始流式接收
    ↓
用户点击停止按钮
    ↓
chat.stop() → abortRef.current?.abort()
    ↓
AbortError 被捕获
    ├─ 如果 assistant message 为空 → 标记为 __error__stopped
    └─ **消息已经在 sess.messages 中，无法撤回**
    ↓
下一次对话时：
    新的 requestMessages = [...sess.messages, newUserMsg]
    ↓
    **旧的 "你好" 消息依然被发送给 API**
```

### 目标流程

```
输入框：input = "你好"
    ↓
用户点击发送
    ↓
useAskChat.submit() 被调用
    ├─ 创建 userMsg { role: 'user', content: '你好' }
    ├─ requestMessages = [...sess.messages, userMsg]
    ├─ **记录这个消息的索引** (e.g., messageIndex = sess.messages.length)
    └─ 清空输入框
    ↓
fetch 开始
    ↓
用户点击停止按钮
    ↓
chat.stop() 被调用
    ├─ 调用 abortRef.current?.abort()
    └─ **触发撤回逻辑**
    ↓
撤回逻辑：
    ├─ 从 sess.messages 中移除 messageIndex 处的用户消息
    ├─ 移除紧接着的空 assistant placeholder
    ├─ 将原始文本恢复到 input 框：setInput(originalText)
    └─ 重置其他状态（清空 selectedSkill, attachedFiles 等）
    ↓
用户看到：
    ✓ 输入框恢复为 "你好"
    ✓ 聊天历史回到发送前的状态
    ✓ 下次对话不会包含已停止的消息
```

## 方案

### 1. 记录待发送消息的上下文

在 `useAskChat.submit()` 中，记录消息在队列中的位置及其内容：

```typescript
// 新增到 useAskChat
const pendingMessageRef = useRef<{
  messageIndex: number;
  userMessage: Message;
} | null>(null);

const submit = useCallback(async (e: React.FormEvent) => {
  // ... 现有代码 ...
  
  // 在 sess.setMessages() 之前记录
  const messageIndex = requestMessages.length;
  pendingMessageRef.current = { messageIndex, userMessage: userMsg };
  
  // ... 继续执行 ...
}, []);
```

### 2. 修改 stop() 函数以支持撤回

```typescript
const stop = useCallback(() => {
  abortRef.current?.abort();  // 原有的中止逻辑
  
  // 新增：回调函数让 AskContent 处理撤回
  onStopMessage?.();
}, [onStopMessage]);
```

或者直接在 stop 中执行撤回：

```typescript
const stop = useCallback(() => {
  // 先中止流
  abortRef.current?.abort();
  
  // 然后撤回消息
  const pending = pendingMessageRef.current;
  if (pending) {
    refs.sessionRef.current?.setMessages(prev => {
      const updated = [...prev];
      // 移除用户消息
      if (updated[pending.messageIndex]?.role === 'user') {
        updated.splice(pending.messageIndex, 1);
      }
      // 移除紧接着的空 assistant placeholder
      if (updated[pending.messageIndex]?.role === 'assistant' && 
          !updated[pending.messageIndex].content.trim()) {
        updated.splice(pending.messageIndex, 1);
      }
      return updated;
    });
    
    // 恢复输入框
    refs.inputValueRef.current = pending.userMessage.content;
    // 触发 setInput 更新
    onRestoreInput?.(pending.userMessage);
    
    pendingMessageRef.current = null;
  }
}, [refs, onRestoreInput]);
```

### 3. 在 AskContent 中处理消息恢复

```typescript
const handleRestoreInput = useCallback((userMessage: Message) => {
  setInput(userMessage.content);
  if (userMessage.images) imageUpload.setImages(userMessage.images);
  if (userMessage.attachedFiles) setAttachedFiles(userMessage.attachedFiles);
  if (userMessage.skillName) {
    // 恢复 skill 选择
    const skill = allSkills.find(s => s.name === userMessage.skillName);
    if (skill) setSelectedSkill(skill);
  }
  // 焦点回到输入框
  setTimeout(() => inputRef.current?.focus(), 50);
}, [imageUpload]);
```

### 4. 错误处理边界案例

**情况 A：消息已发送且已有 assistant 回复内容**
- 不撤回（不能中止已有的对话）
- 只中止新的流

**情况 B：消息发送失败（网络错误）**
- AbortError 处理保持现有逻辑
- 消息保留，用户可以看到错误信息

**情况 C：用户快速发送、停止、再发送**
- pendingMessageRef 只记录最新的待发送消息
- 每次 stop 清空 pendingMessageRef

**情况 D：Modal 关闭时的行为**
- 当前：自动 abort（line 214）
- 新增：Modal 关闭时也应撤回消息（保持一致）

## 影响范围

### 变更文件

1. **`app/hooks/useAskChat.ts`**
   - 添加 `pendingMessageRef`
   - 修改 `submit()` 以记录消息位置
   - 修改 `stop()` 以执行撤回逻辑
   - 新增可选回调参数 (或传递函数引用)

2. **`app/components/ask/AskContent.tsx`**
   - 新增 `handleRestoreInput()` 回调
   - 将回调传给 `useAskChat`
   - 修改 `resetInputState()` (可能不需要，因为 stop 时不调用这个)

### 受影响的其他模块

- **`useAskSession`** — 不受影响，消息管理仍通过 `setMessages` 进行
- **会话持久化** — 不受影响，删除消息后会自动持久化
- **API 端点** — 不受影响，被 abort 的请求不会到达服务器

### 破坏性变更

- 无。用户现有对话历史不受影响。新行为对后续消息无影响。

## 边界 case 与风险

### 边界 Case 1：快速连续发送多条消息

**场景**：
```
T=0: 发送消息1 → pendingMessageRef = msg1
T=50ms: 消息1 开始流 → isLoading = true
T=100ms: 用户发送消息2 → pendingMessageRef = msg2  (覆盖了 msg1)
T=150ms: 用户停止 → 撤回 msg2，但 msg1 已在历史中且无法再撤回
```

**处理方式**：
- ✅ 接受这个限制。用户发送新消息后，前一条消息已锁定。
- 文档说明：只有最后一条待发送消息能被撤回。
- 此时 isLoading 应为 false，无法再发送消息，所以不会出现这个情况。

### 边界 Case 2：消息已部分流式传输

**场景**：
```
T=0: 发送用户消息
T=100ms: assistant 回复开始："您好..."
T=150ms: 用户停止
```

**处理方式**：
- ✅ 检查 assistant 消息是否为空
- 如果 assistant 有内容，不撤回用户消息（用户看到了回复，撤回不合理）
- 仅中止流，保留已有的对话

**代码守卫**：
```typescript
const assistantMsg = updated[pending.messageIndex + 1];
if (assistantMsg?.role === 'assistant' && 
    (assistantMsg.content.trim() || assistantMsg.parts?.length)) {
  // 不撤回，仅中止流
  pendingMessageRef.current = null;
  return updated;
}
```

### 边界 Case 3：网络重连中停止

**场景**：
```
T=0: 发送消息 → reconnecting phase
T=100ms: 用户停止
T=200ms: 重连重试逻辑还在 for 循环中...
```

**处理方式**：
- ✅ abort() 设置 signal.aborted = true
- for 循环中有检查：`if (controller.signal.aborted) break;` (line 169)
- 重连会停止，AbortError 被捕获，撤回逻辑执行

### 风险 1：状态不同步

**风险**：inputValueRef 与 React state 的 input 不同步。
**缓解**：
- 修改 input state（直接调用 setInput）而非 ref
- 确认 inputValueRef 在下次 render 更新

### 风险 2：用户消息丢失（如果有并发修改）

**风险**：如果在 stop 执行时，同时有其他地方在修改 messages。
**缓解**：
- stop 使用 `setMessages(prev => ...)` 的函数式更新
- 原子操作，避免竞态条件

### 风险 3：Undo 栈复杂性

**风险**：用户期望 Ctrl+Z 撤销停止操作，但当前没有 undo 栈。
**缓解**：
- 当前不实现 undo，仅撤回一层（消息回到输入框）
- 如果未来需要完整 undo，再考虑额外的栈机制

## 验收标准

### 功能验收

- [ ] **消息发送后停止** → 消息撤回到输入框
  - 条件：assistant 消息为空（尚未开始流）
  - 结果：input 框显示原始文本，历史中无该消息

- [ ] **消息部分流后停止** → 保留已有对话，不撤回
  - 条件：assistant 消息已有内容
  - 结果：用户消息保留，assistant 回复保留（截断）

- [ ] **网络重连中停止** → 撤回消息
  - 条件：在 reconnecting phase 点击 stop
  - 结果：消息撤回，输入框恢复

- [ ] **附带图片/文件的消息撤回** → 附件也被恢复
  - 条件：消息包含 images / attachedFiles / uploadedFileNames
  - 结果：输入框恢复文本，image preview/file list 也恢复

- [ ] **Skill 选择状态恢复** → 撤回时 skill 也还原
  - 条件：用户选择了 /skill 后发送
  - 结果：slash command UI 恢复为该 skill 选择状态

### UI/UX 验收

- [ ] **无误导用户** → Stop 按钮仍显示，功能如预期
- [ ] **焦点管理** → 消息撤回后，输入框自动获焦点
- [ ] **视觉反馈** → 消息消失、输入框填充，无突兀闪烁

### 边界验收

- [ ] **多消息场景** → 仅最后一条未发送完成的消息可撤回
- [ ] **快速操作** → 连续发送/停止/发送，状态正确
- [ ] **错误网络** → 网络失败的消息不被意外撤回

### 后向兼容性

- [ ] **现有会话不破坏** → 旧对话历史显示正常
- [ ] **API 不受影响** → 被 abort 的消息不发送

