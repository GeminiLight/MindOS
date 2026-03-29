好的，我同意，更新下spec吧                                                         

● Read 1 file (ctrl+o to expand)

● 发现文件末尾有重复的 SPEC-OB-02/03/04，一并清理，同时更新 OB-04/05：

● Update(wiki/task-spec-user-onboard.md)
  ⎿  Added 3 lines, removed 1 line
      164  2. **app 内两个 route 字典完全重复**：`agents/route.ts` 和
           `install/route.ts` 定义了完全相同的 `MCP_AGENTS`，可立即合并
      165  3. **CLI 无 LLM 测试连通性**：GUI 目前也未做，填写 API Key
           后未验证有效性
      166  4. **GUI Step 5 无跳过按钮**：选 0 个 Agent 可以继续，但 UX
           上可以加 "Skip this step" 明确提示
      167 -5. **端口变更后 CLI 无自动重启**：需要用户手动执行 `mindos         
          -restart`                                                           
      167 +5. **再次 onboard 时端口检测有 false                               
          +positive**：服务已在跑，检测自身端口会误报"占用"                   
      168 +6. **再次 onboard 时端口默认值为硬编码 3000/8787**：应读取当前     
          +config 作为默认值                                                  
      169 +7. **配置变更后无重启提示**：端口/路径/token                       
          +变了，服务行为不会自动更新                                         
      170   
      171  ---
      172   

● Now replace the duplicate + outdated OB-04 sections with clean updated versions:

● Update(wiki/task-spec-user-onboard.md)
  ⎿  Added 57 lines, removed 52 lines
      263   
      264  ---
      265   
      266 -### SPEC-OB-04：端口变更后 CLI 自动重启提示                        
      266 +### SPEC-OB-04：配置变更后的重启提示（GUI + CLI）                  
      267   
      268 -**优先级**: P3                                                     
      269 -**范围**: CLI Step 3                                               
      268 +**优先级**: P2                                                     
      269 +**范围**: GUI Review 页 + CLI 完成阶段                             
      270   
      271  **背景**
      272 -用户修改端口后，onboard 完成但服务仍在旧端口，没有任何提示。       
      272 +用户再次 onboard 修改配置后，服务行为不会自动更新。当前 GUI        
          +只判断了 `portChanged`，CLI                                        
          +完全没有提示。需要区分哪些配置变更需要重启，哪些不需要。           
      273   
      274 -**方案**                                                           
      275 -检测到端口与原 config 不同时，完成后输出：                         
      276 -```                                                                
      277 -⚠  Port changed. Run `mindos restart` to apply.                    
      278 -```                                                                
      279 -带 `--install-daemon` flag 时自动执行 restart。                    
      274 +**需要重启的配置项**                                               
      275   
      276 -**验收标准**                                                       
      277 -- [ ] 端口未变：无额外提示                                         
      278 -- [ ] 端口变更：末尾显示重启提示                                   
      279 -- [ ] `--install-daemon` 模式：自动重启                            
      276 +| 配置项 | 原因 |                                                  
      277 +|--------|------|                                                  
      278 +| `port` / `mcpPort` | 服务监听端口变了 |                          
      279 +| `mindRoot` | 服务需要重新加载知识库路径 |                        
      280 +| `authToken` | middleware 验证 token 变了 |                       
      281 +| `webPassword` | middleware 读取密码变了 |                        
      282   
      283 ----                                                                
      283 +**不需要重启的配置项**                                             
      284   
      285 -### SPEC-OB-02：API Key 连通性验证                                 
      285 +| 配置项 | 原因 |                                                  
      286 +|--------|------|                                                  
      287 +| AI Provider / API Key | 每次请求动态读取 |                       
      288 +| Agent MCP 配置 | 写入 Agent 自己的 config，与服务无关 |          
      289   
      290 -**优先级**: P2                                                     
      291 -**范围**: GUI Step 2 + CLI Step 6                                  
      292 -                                                                   
      293 -**背景**                                                           
      294 -用户填写 API Key 后直接进入下一步，填错的 Key 要到真正调用 AI      
          -时才会报错，体验差。                                               
      295 -                                                                   
      290  **方案**
      291 -- GUI：在 Step 2 API Key 输入框失焦后，调用 `POST                  
          -/api/setup/check-ai` 发送一个最小测试请求（如 `messages: [{role:   
          -'user', content: 'hi'}], max_tokens: 1`）                          
      292 -- CLI：填写完 Key 后自动测试，显示 `✔ API key valid` 或 `✘         
          -Invalid key`，失败可重填                                           
      293 -- 两端统一：Skip 模式下跳过验证                                    
      291 +- GUI：完成后对比新旧                                              
          +config，若上述任意一项有变化，显示重启提示；否则直接跳转 `/`       
      292 +- CLI：同理，完成后输出对应提示：                                  
      293 +  ```                                                              
      294 +  ⚠  Config changed. Run `mindos restart` to apply.                
      295 +  ```                                                              
      296 +  带 `--install-daemon` flag 时自动执行 restart                    
      297   
      298  **验收标准**
      299 -- [ ] 填写有效 Key：显示绿色 ✔ 提示                                
      300 -- [ ] 填写无效 Key：显示红色 ✘                                     
          -提示，不阻断（可继续下一步但有警告）                               
      301 -- [ ] Skip 模式：不触发验证                                        
      299 +- [ ] 只改 API Key：完成后直接跳转，无重启提示                     
      300 +- [ ] 改了端口/路径/token/password：显示重启提示                   
      301 +- [ ] CLI `--install-daemon` 模式：自动重启                        
      302 +- [ ] GUI 重启提示页显示"已变更的配置项"摘要                       
      303   
      304  ---
      305   
      306 -### SPEC-OB-03：GUI Step 5 明确跳过入口                            
      306 +### SPEC-OB-05：再次 onboard 的端口默认值与检测逻辑                
      307   
      308 -**优先级**: P3                                                     
      309 -**范围**: GUI Step 5                                               
      308 +**优先级**: P1                                                     
      309 +**范围**: GUI Step 3 + CLI Step 3                                  
      310   
      311  **背景**
      312 -当前未选任何 Agent                                                 
          -时只显示一行灰色提示文字，用户不确定是否可以跳过。                 
      312 +存在两个问题：                                                     
      313   
      314 +1. **默认值硬编码**：SetupWizard 初始化 `webPort: 3000 / mcpPort:  
          +8787`，再次 onboard 时用户看到的不是当前实际端口，容易误改         
      315 +2. **端口检测 false positive**：GUI                                
          +能被打开说明服务已在跑，检测自身端口（如 3000）会误报"端口已占用"  
      316 +                                                                   
      317  **方案**
      318 -在 Step 5 底部增加 `Skip — configure later`                        
          -次级链接按钮，点击直接跳到 Step 6（Review），效果与"不选任何 Agent 
          - 点 Next"一致，但意图更清晰。                                      
      318   
      319 -**验收标准**                                                       
      320 -- [ ] Step 5 底部显示 Skip 链接                                    
      321 -- [ ] 点击 Skip → 跳到 Step 6，selectedAgents 保持空               
      322 -- [ ] 正常选择 Agent 后 Skip 链接仍可用（不影响已选项）            
      319 +**默认值**：进入 Step 3 前，从 `GET /api/setup`（读取当前          
          +config）拿到 `port` / `mcpPort` 作为初始值                         
      320   
      321 ----                                                                
      321 +**端口检测增加 `isSelf` 判断**：                                   
      322 +```                                                                
      323 +isPortInUse(port)                                                  
      324 +  → false → ✅ Available（可用）                                   
      325 +  → true  → GET http://localhost:{port}/api/health                 
      326 +               → 返回 MindOS 标识 → ✅ Current                     
          +port（当前服务，无需变更）                                         
      327 +               → 无响应/其他服务  → ❌ In use（冲突，推荐 +1）     
      328 +```                                                                
      329   
      330 -### SPEC-OB-04：端口变更后 CLI 自动重启提示                        
      330 +**三种端口状态 badge**：                                           
      331   
      332 -**优先级**: P3                                                     
      333 -**范围**: CLI Step 3                                               
      332 +| 状态 | badge | Next 可用 |                                       
      333 +|------|-------|-----------|                                       
      334 +| `available` | 绿色"Available" | ✅ |                             
      335 +| `self` | 绿色"Current port" | ✅ |                               
      336 +| `unavailable` | 橙色"Port in use + 推荐" | ❌ |                  
      337   
      338 -**背景**                                                           
      339 -用户修改端口后，CLI 完成配置但不提示需要重启，服务仍在旧端口运行。 
      338 +**portChanged 判断**：用户提交的端口值与从 config                  
          +读取的原始值对比，不同则 `portChanged = true`                      
      339   
      340 -**方案**                                                           
      341 -- 检测到用户修改了端口（与原 config 不同），在 onboard             
          -完成后输出：                                                       
      342 -  ```                                                              
      343 -  ⚠  Port changed. Run `mindos restart` to apply.                  
      344 -  ```                                                              
      345 -- 若用户同时带 `--install-daemon` flag，自动执行 restart           
      340 +**API 变更**：                                                     
      341 +- `POST /api/setup/check-port` 增加返回字段 `isSelf: boolean`      
      342 +- `GET /api/setup` 返回当前 config（port、mcpPort、mindRoot 等）   
      343   
      344  **验收标准**
      345 -- [ ] 端口未变：无额外提示                                         
      346 -- [ ] 端口变更：末尾显示重启提示                                   
      347 -- [ ] `--install-daemon` 模式：自动重启                            
      345 +- [ ] 再次 onboard 进入 Step 3，默认值为当前运行端口               
      346 +- [ ] 检测自身端口显示"Current port"而非"In use"                   
      347 +- [ ] 检测其他服务占用的端口显示警告 + 推荐                        
      348 +- [ ] 未改端口直接 Complete：`portChanged = false`，完成后直接跳转 
      349 +- [ ] CLI 同步：`isPortInUse` 检测时同样识别自身服务（通过         
          +`/api/health` 探测）                                               

● 更新完成。改动总结：

  已知差异 补了 3 条新问题（false positive、硬编码默认值、无重启提示）

  Spec 变更：
  - SPEC-OB-04 重写：从"只提示端口变更"扩展为"区分所有需要/不需要重启的配置项"，GUI +
   CLI 统一
  - SPEC-OB-05（新增，P1）：再次 onboard 的端口问题，包含：
    - 默认值从 GET /api/setup 读取
    - check-port 增加 isSelf 探测（通过 /api/health）
    - 三种端口 badge 状态（available / self / unavailable）
    - portChanged 改为与原 config 对比而非硬编码

✻ Baked for 1m 6s

❯ 为什么还需要用户手动重新启动呢，有没有可能询问一下是否重新启动，或者默认重新启动？ 
  ⎿  ⧉ Selected 1 lines from wiki/task-spec-user-onboard.md in Visual Studio Code

● 好问题。既然我们知道哪些配置变了、服务正在跑，完全可以主动处理。

  ---
  重新思考重启策略

  三种情况：

  ┌──────────────────┬──────────────┬────────────────────────────────────────────┐
  │       场景       │ 当前服务状态 │                  最佳处理                  │
  ├──────────────────┼──────────────┼────────────────────────────────────────────┤
  │ 服务在跑（daemon │ 后台进程存在 │ 询问"是否立即重启？" → 用户确认后自动      │
  │  模式）          │              │ mindos restart                             │
  ├──────────────────┼──────────────┼────────────────────────────────────────────┤
  │ 服务在跑（前台   │ terminal     │ 无法自动重启，提示用户 Ctrl+C 再重启       │
  │ dev 模式）       │ 里跑着       │                                            │
  ├──────────────────┼──────────────┼────────────────────────────────────────────┤
  │ 服务未跑         │ 没有进程     │ 不需要重启提示，配置已保存，下次启动时生效 │
  └──────────────────┴──────────────┴────────────────────────────────────────────┘

  ---
  方案调整

  GUI：
  - Complete 后检测服务状态（GET /api/health 是否响应）
  - 配置有变更 + 服务在跑 → 弹确认框："配置已保存，需要重启服务才能生效。立即重启？"
    - 确认 → POST /api/restart（后端执行 mindos restart）→ 跳转 /（等服务重启完）
    - 取消 → 提示"稍后运行 mindos restart"，不跳转
  - 配置有变更 + 服务未跑 → 直接跳转 /，无需提示

  CLI：
  - 检测是否有 daemon 进程（mindos gateway status）
  - 有 daemon → 询问：Restart service now? [Y/n] → 默认 Y，自动重启
  - 无 daemon（前台模式）→ 提示 ⚠ Restart your terminal process to apply changes
  - --yes flag → 跳过询问，直接重启

  ---
  要我把这个逻辑更新到 SPEC-OB-04 里吗？

❯ 好的，我同意                                                                       

● Update(wiki/task-spec-user-onboard.md)
  ⎿  Added 38 lines, removed 11 lines
      263   
      264  ---
      265   
      266 -### SPEC-OB-04：配置变更后的重启提示（GUI + CLI）                  
      266 +### SPEC-OB-04：配置变更后智能重启（GUI + CLI）                    
      267   
      268  **优先级**: P2
      269  **范围**: GUI Review 页 + CLI 完成阶段
      270   
      271  **背景**
      272 -用户再次 onboard 修改配置后，服务行为不会自动更新。当前 GUI        
          -只判断了 `portChanged`，CLI 完全没有提示。                         
          -需要区分哪些配置变更需要重启，哪些不需要。                         
      272 +用户再次 onboard 修改配置后，服务行为不会自动更新。当前 GUI        
          +只判断了 `portChanged` 并提示"手动重启"，CLI 完全没有提示。        
          +应根据服务运行状态智能决策，而非一律要求用户手动操作。             
      273   
      274  **需要重启的配置项**
      275   
     ...
      287  | AI Provider / API Key | 每次请求动态读取 |
      288  | Agent MCP 配置 | 写入 Agent 自己的 config，与服务无关 |
      289   
      290 +**三种场景的处理策略**                                             
      291 +                                                                   
      292 +| 场景 | 服务状态 | 处理 |                                         
      293 +|------|---------|------|                                          
      294 +| 配置未变更 | 任意 | 直接跳转 `/`，无提示 |                       
      295 +| 配置变更 + 服务未跑 | 无进程 | 直接跳转 `/`，下次启动自动生效 |  
      296 +| 配置变更 + daemon 在跑 | 后台进程 | 询问用户是否立即重启，默认   
          +Yes |                                                              
      297 +| 配置变更 + 前台模式在跑 | 前台进程 | 提示用户手动 Ctrl+C 再重启  
          +|                                                                  
      298 +                                                                   
      299  **方案**
      300 -- GUI：完成后对比新旧                                              
          -config，若上述任意一项有变化，显示重启提示；否则直接跳转 `/`       
      301 -- CLI：同理，完成后输出对应提示：                                  
      302 -  ```                                                              
      303 -  ⚠  Config changed. Run `mindos restart` to apply.                
      304 -  ```                                                              
      305 -  带 `--install-daemon` flag 时自动执行 restart                    
      300   
      301 +GUI：                                                              
      302 +1. Complete 保存 config 后，对比新旧配置检测是否有需要重启的变更   
      303 +2. 无变更 → 直接 `window.location.href = '/'`                      
      304 +3. 有变更 → `GET /api/health` 检测服务状态                         
      305 +   - 服务未响应（未跑）→ 直接跳转 `/`                              
      306 +   - 服务响应（在跑）→                                             
          +显示确认框："配置已保存，需要重启生效。立即重启？"                 
      307 +     - 确认 → `POST /api/restart` → 等待重启完成 → 跳转 `/`        
      308 +     - 取消 → 留在页面，显示 `mindos restart` 提示                 
      309 +                                                                   
      310 +CLI：                                                              
      311 +1. 完成后对比新旧 config，检测是否有需要重启的变更                 
      312 +2. 无变更 → 正常退出                                               
      313 +3. 有变更 → 检测 daemon 状态（`mindos gateway status`）            
      314 +   - 有 daemon → 询问：`Restart service now? [Y/n]`（默认 Y）→     
          +自动执行 `mindos restart`                                          
      315 +   - 无 daemon（前台模式）→ 输出：`⚠  Restart your terminal        
          +process to apply changes`                                          
      316 +   - `--yes` flag → 跳过询问，直接重启                             
      317 +                                                                   
      318 +**新增 API**                                                       
      319 +- `POST /api/restart`：后端执行服务重启，返回重启状态              
      320 +                                                                   
      321  **验收标准**
      322  - [ ] 只改 API Key：完成后直接跳转，无重启提示
      323 -- [ ] 改了端口/路径/token/password：显示重启提示                   
      324 -- [ ] CLI `--install-daemon` 模式：自动重启                        
      325 -- [ ] GUI 重启提示页显示"已变更的配置项"摘要                       
      323 +- [ ] 改了端口/路径/token/password + 服务未跑：直接跳转，无提示    
      324 +- [ ] 改了端口/路径/token/password + 服务在跑：弹出重启确认框      
      325 +- [ ] GUI 确认重启：调用 `/api/restart`，等待后跳转                
      326 +- [ ] GUI 取消重启：留在页面显示手动重启命令                       
      327 +- [ ] CLI daemon 模式：默认 Y 自动重启                             
      328 +- [ ] CLI 前台模式：提示手动重启                                   
      329 +- [ ] CLI `--yes` flag：跳过询问直接重启                           
      330   
      331  ---
      332   

● 更新完成。核心变化：

  - 不再要求用户手动重启，而是根据服务状态智能决策：
    - 服务未跑 → 直接跳转，无提示
    - daemon 在跑 → 询问是否立即重启（默认 Yes）
    - 前台模式在跑 → 提示手动 Ctrl+C（无法自动处理）
  - 新增 POST /api/restart API 支持 GUI 触发重启
  - CLI 增加 --yes flag 跳过询问

❯ 你再仔细想想user onboard journal里面还有哪些可以优化的                             

● 让我先完整读一遍当前的 spec 和现有实现，再系统地思考：

● Read 1 file (ctrl+o to expand)

● 再看看实际的 setup API 和 page 入口逻辑：

● Read 2 files (ctrl+o to expand)

● 现在我对整个 onboarding
  流程有了完整的认识。以下是我发现的可以优化的点，分几个维度：

  ---
  新发现的优化点

  UX 层面

  1. GUI 入口：setupPending 只能首次进入，再次 onboard 没有入口
  用户完成 onboard 后 setupPending = false，/setup 就永久跳转回 /。想修改配置只能去
  Settings，但 Settings 没有 onboard 的引导感。需要在 Settings 里加"Re-run
  onboard"或者允许 /setup?force=1 强制打开。

  2. Step 1 模板选择后无预览
  用户选了 en 模板，只看到几个目录名，不知道模板里实际有什么文件。选 empty
  更不清楚会创建什么。应该加一个简单预览。

  3. Step 1 知识库路径已存在时无明确提示
  CLI 有"目录已存在"警告和选择（Use / Choose different）。GUI
  没有，直接继续会覆盖已有知识库的内容（如果目录非空）。

  4. Step 4 Security — Auth Token 的用途没解释
  用户不知道 token 是干什么的，为什么要复制它。需要一句说明："此 token 用于 MCP
  连接验证，配置 Agent 时会自动使用"。

  5. Step 6 Review — "完成" 按钮在 Agent 安装期间可以再次点击
  submitting 状态下按钮被 disable，但如果 agent install 报错后 submitting =
  false，用户可能重复提交，导致重复安装 Agent。

  6. CLI 步骤顺序和 GUI 不一致
  GUI：KB → AI Provider → Ports → Security → Agent Tools
  CLI：KB → Template → Ports → Auth Token → Password → AI Provider → Start Mode →
  Agent Tools

  Template 步骤在 GUI 里是 Step 1 的一部分，但 CLI 独立成 Step 2。AI Provider 在 GUI
  是 Step 2，CLI 是 Step 6。用户同时用两种方式 onboard 时体验割裂。

  7. onboard 完成后没有"下一步做什么"的引导
  跳到 / 后用户看到空的知识库，不知道如何开始。应该在首次完成后展示一个"Getting
  Started"提示（比如创建第一篇笔记、测试 MCP 连接等）。

  ---
  技术/健壮性层面

  8. GET /api/setup 不存在
  SPEC-OB-05 依赖 GET /api/setup 返回当前 config，但目前只有 POST
  /api/setup。需要补充 GET 实现。

  9. setup 完成后 setupPending 的清除时机
  目前 POST /api/setup 会把 setupPending 设为 false，但如果用户在 Agent
  安装阶段刷新页面，会直接跳回 /（因为 config 已保存），但 Agent
  没有装完。应该考虑两阶段：config 保存成功后才清除 setupPending，而 Agent
  安装失败不影响。

  10. CLI 没有"resume"机制
  onboard 中途 Ctrl+C 后重新运行，从头开始填。应该检测 config 已有值并作为默认值（CLI
   Step 6 AI Provider 目前有读取，但其他步骤没有）。

  ---
  要我把这些整理成新的 SPEC 条目加到文件里吗？哪些你觉得值得做？

✻ Brewed for 42s

❯ 你要给出每一条具体的优化点                                                         
  ⎿  Interrupted · What should Claude do instead?

❯ 你要给出每一条优化的方向                                                           

● 好，逐条给出具体方向：

  ---
  1. 再次 onboard 没有入口
  → Settings 页加 "Reconfigure / Re-run Setup" 按钮，点击跳转 /setup?force=1；/setup
  页检测 force 参数时跳过 setupPending 检查

  2. 模板选择无预览
  → Step 1 选中模板后，右侧或下方展开文件树预览（静态 JSON
  数据，不需要实际创建文件）；empty 模板显示"仅创建 README.md / CONFIG.json /
  INSTRUCTION.md"

  3. 知识库路径已存在无提示
  → 路径输入框失焦后，调用 POST /api/setup/check-path 检测目录是否存在且非空；存在非
  空目录时显示警告"目录已存在，继续会保留现有文件，模板不会覆盖"；CLI 已有此逻辑，GUI
   对齐

  4. Auth Token 用途不清晰
  → Step 4 加一行说明文字："MCP 连接时用于身份验证，Agent 配置会自动使用此
  token，无需手动填写"；同时在 token 旁加"What is this?"展开说明

  5. Review 页重复提交
  → Agent 安装失败后进入"可重试"状态而非回到 idle，失败的 Agent
  单独显示"Retry"按钮；Complete 按钮改为"已提交则不可再次触发整个流程，只能 Retry
  单个 Agent"

  6. CLI 与 GUI 步骤顺序不一致
  → CLI 将 Template 合并进 Step 1（KB + Template 一起问），AI Provider 提前到 Step
  2，与 GUI 对齐；Start Mode 移到最后或合并进 Review；最终两端顺序：KB+Template → AI
  → Ports → Security → Agent Tools → Review/Done

  7. 完成后缺少"下一步"引导
  → 首次完成 onboard（setupPending 从 true 变 false）后，跳转 / 时带 ?welcome=1
  参数；首页检测到参数后显示 Welcome banner，包含：创建第一篇笔记、测试 MCP
  连接（mindos mcp）、查看文档三个快捷入口；banner 可手动关闭且不再显示

  8. GET /api/setup 不存在
  → 补充 GET /api/setup 返回当前 config 的脱敏版本（API Key 只返回前6位+***，token
  完整返回）；SetupWizard mount 时调用此接口填充默认值

  9. setupPending 清除时机
  → 将 onboard 拆成两阶段：① POST /api/setup 保存 config + 清除 setupPending；② Agent
   安装独立进行，失败不回滚 config；Review 页加"Agent 安装可稍后在 Settings → MCP
  重试"的提示，明确告知两件事是独立的

  10. CLI 无 resume 机制
  → onboard 开始时读取 ~/.mindos/config.json 已有值作为每步默认值（路径、端口、AI
  Provider 等）；检测到 config 已存在时提示"Found existing config, press Enter to
  keep current value"；用户直接回车跳过即为保留原值

  ---
  哪几条你想先做？或者全部加进 spec？

❯ 全都加进去                                                                         

● Read 1 file (ctrl+o to expand)

● Update(wiki/task-spec-user-onboard.md)
  ⎿  Added 10 lines
      167  5. **再次 onboard 时端口检测有 false
           positive**：服务已在跑，检测自身端口会误报"占用"
      168  6. **再次 onboard 时端口默认值为硬编码 3000/8787**：应读取当前
           config 作为默认值
      169  7. **配置变更后无重启提示**：端口/路径/token
           变了，服务行为不会自动更新
      170 +8. **再次 onboard 没有入口**：完成后                               
          +`setupPending=false`，`/setup` 永久跳走，无法重新配置              
      171 +9. **模板选择无预览**：用户只看到目录名，不清楚模板实际内容        
      172 +10. **知识库路径已存在时 GUI 无提示**：CLI 有警告，GUI             
          +直接继续可能误操作已有知识库                                       
      173 +11. **Auth Token 用途不清晰**：用户不知道 token                    
          +是什么、为什么要复制                                               
      174 +12. **Review 页 Agent 安装失败后可重复提交整个流程**：应支持单个   
          +Agent 重试                                                         
      175 +13. **CLI 与 GUI 步骤顺序不一致**：Template 位置、AI Provider      
          +位置不同，体验割裂                                                 
      176 +14. **完成后缺少"下一步"引导**：跳到空知识库，用户不知道从哪里开始 
      177 +15. **`GET /api/setup` 不存在**：SPEC-OB-05 依赖此接口读取当前     
          +config                                                             
      178 +16. **`setupPending` 清除时机不明确**：Agent                       
          +安装失败会影响是否能进入知识库                                     
      179 +17. **CLI 无 resume 机制**：中途退出后重新运行从头填，已有 config  
          +值不作为默认值                                                     
      180   
      181  ---
      182   

● 现在在文件末尾追加新的 Spec 条目：
  ⎿  Interrupted · What should Claude do instead?

❯ '/data/home/geminitwang/code/mindos/wiki/task-spec-user-onboard.md'              
添加到这个文件                                                                       
  ⎿  ⧉ Selected 1 lines from wiki/task-spec-user-onboard.md in Visual Studio Code

● mindos - mindos_append_to_file (MCP)(path: "wiki/task-spec-user-onboard.md",
                                      content: "\n---\n\n### SPEC-OB-06：再次 onboard
                                       的入口\n\n**优先级**: P2\n**范围**: GUI
                                      Settings 页 + `/setup` 路由\n\n**方向**\n-
                                      Settings 页加 \"Reconfigure / Re-run Setup\"
                                      按钮，点击跳转 `/setup?force=1`\n- `/setup`
                                      页检测 `force=1` 参数时跳过 `setupPending`
                                      检查，强制显示 SetupWizard\n\n**验收标准**\n- [
                                       ] Settings 页有明确的重新配置入口\n- [ ]
                                      `/setup?force=1` 无论 `setupPending`
                                      状态都能打开\n- [ ] 重新完成后仍正常跳转
                                      `/`\n\n---\n\n### SPEC-OB-07：Step 1
                                      模板选择预览\n\n**优先级**: P3\n**范围**: GUI
                                      Step 1\n\n**方向**\n- 选中模板后，卡片下方展开
                                      完整文件树预览（静态数据，不需要创建文件）\n-
                                      `empty` 模板显示\"仅创建 README.md /
                                      CONFIG.json / INSTRUCTION.md\"\n-
                                      预览内容来自各模板的 manifest，无需 API
                                      调用\n\n**验收标准**\n- [ ]
                                      三个模板均有文件树预览\n- [ ]
                                      预览内容与实际创建结果一致\n\n---\n\n###
                                      SPEC-OB-08：知识库路径已存在时的 GUI
                                      提示\n\n**优先级**: P2\n**范围**: GUI Step
                                      1\n\n**方向**\n- 路径输入框失焦后，调用 `POST
                                      /api/setup/check-path`
                                      检测目录是否存在且非空\n-
                                      存在非空目录时显示警告：\"目录已存在，继续会保
                                      留现有文件，模板不会覆盖\"\n- 对齐 CLI
                                      已有的\"目录已存在\"交互逻辑\n\n**验收标准**\n-
                                       [ ] 路径不存在或为空目录：无提示，正常继续\n-
                                      [ ] 路径存在且非空：显示橙色警告，Next
                                      仍可点击\n- [ ] 新增 `POST
                                      /api/setup/check-path` 接口\n\n---\n\n###
                                      SPEC-OB-09：Auth Token 用途说明\n\n**优先级**:
                                      P3\n**范围**: GUI Step 4\n\n**方向**\n- Token
                                      输入框旁加一行说明：\"用于 MCP
                                      连接身份验证，配置 Agent
                                      时会自动使用，无需手动填写\"\n- 加\"What is
                                      this?\"可展开详细说明（MCP URL 示例、curl
                                      示例）\n\n**验收标准**\n- [ ] Step 4 有 token
                                      用途说明文字\n- [ ] 说明内容准确描述 token
                                      的使用场景\n\n---\n\n### SPEC-OB-10：Agent
                                      安装失败支持单个重试\n\n**优先级**:
                                      P2\n**范围**: GUI Step 5 / Review
                                      页\n\n**方向**\n- Agent 安装失败后，该 Agent 行
                                      显示\"Retry\"按钮，而非只能重新提交整个流程\n-
                                      Complete 按钮在首次提交后变为\"Done\"，不可再次
                                      触发整个流程\n- 重试只重新调用 `POST
                                      /api/mcp/install` 针对单个
                                      Agent\n\n**验收标准**\n- [ ] 安装失败的 Agent
                                      显示 Retry 按钮\n- [ ] Retry 只重装失败的
                                      Agent，不重新保存 config\n- [ ] Complete
                                      提交后不可再次触发完整流程\n\n---\n\n###
                                      SPEC-OB-11：CLI 与 GUI
                                      步骤顺序对齐\n\n**优先级**: P2\n**范围**: CLI
                                      scripts/setup.js\n\n**方向**\n- Template 合并进
                                       Step 1（KB 路径确认后紧接模板选择）\n- AI
                                      Provider 提前到 Step 2，与 GUI 对齐\n- Start
                                      Mode 合并进最后的 Review/Done
                                      阶段或作为独立末尾步骤\n-
                                      最终两端顺序统一：KB+Template → AI → Ports →
                                      Security → Agent Tools →
                                      Done\n\n**验收标准**\n- [ ] CLI 步骤顺序与 GUI
                                      一致（KB→AI→Ports→Security→Agents）\n- [ ]
                                      `TOTAL_STEPS` 和 `stepTitles` 更新\n- [ ]
                                      所有步骤功能不受影响\n\n---\n\n###
                                      SPEC-OB-12：完成后 Welcome 引导\n\n**优先级**:
                                      P2\n**范围**: GUI 首页\n\n**方向**\n- 首次完成
                                      onboard 后跳转 `/` 时带 `?welcome=1` 参数\n-
                                      首页检测到参数显示 Welcome
                                      banner，包含三个快捷入口：\n  1.
                                      创建第一篇笔记\n  2. 测试 MCP 连接（`mindos
                                      mcp`）\n  3. 查看文档\n- Banner
                                      可手动关闭，关闭后写入 localStorage
                                      不再显示\n\n**验收标准**\n- [ ] 首次完成跳转带
                                      `?welcome=1`\n- [ ] 首页显示 Welcome banner
                                      含三个入口\n- [ ] 关闭后不再显示（localStorage
                                      记录）\n- [ ] 再次 onboard
                                      完成后同样触发\n\n---\n\n### SPEC-OB-13：补充
                                      `GET /api/setup`\n\n**优先级**: P1\n**范围**:
                                      app API\n\n**方向**\n- 新增 `GET /api/setup`
                                      返回当前 config 的脱敏版本：\n  - API Key
                                      只返回前 6 位 + `***`\n  - `authToken`
                                      完整返回\n  -
                                      `port`、`mcpPort`、`mindRoot`、`provider`
                                      完整返回\n- SetupWizard mount
                                      时调用此接口填充默认值（替代硬编码
                                      3000/8787）\n\n**验收标准**\n- [ ] `GET
                                      /api/setup` 返回当前 config 脱敏数据\n- [ ]
                                      SetupWizard 初始化时读取并填充表单默认值\n- [ ]
                                       首次 onboard（config
                                      不存在）时返回默认值\n\n---\n\n###
                                      SPEC-OB-14：`setupPending`
                                      两阶段清除\n\n**优先级**: P2\n**范围**: app API
                                       + GUI\n\n**方向**\n- `POST /api/setup` 保存
                                      config 成功后立即清除
                                      `setupPending`（现有行为，保持）\n- Agent
                                      安装独立进行，失败不回滚
                                      config，不影响进入知识库\n- Review
                                      页加说明：\"Agent 配置失败可稍后在 Settings →
                                      MCP 重试\"\n- 用户刷新页面后（config
                                      已保存）正常进入 `/`，不回到
                                      `/setup`\n\n**验收标准**\n- [ ] Agent
                                      安装失败不影响进入知识库\n- [ ] Review 页有
                                      Agent 独立说明文字\n- [ ] 刷新页面后不回到
                                      setup\n\n---\n\n### SPEC-OB-15：CLI Resume
                                      机制\n\n**优先级**: P2\n**范围**: CLI
                                      scripts/setup.js\n\n**方向**\n- onboard
                                      开始时读取 `~/.mindos/config.json`
                                      已有值作为每步默认值\n- 检测到 config
                                      已存在时每步提示\"(current: xxx) Press Enter to
                                       keep\"\n- 用户直接回车 = 保留原值，输入新值 =
                                      覆盖\n- 适用步骤：KB 路径、端口、AI
                                      Provider、Auth Token、Web
                                      Password\n\n**验收标准**\n- [ ] 已有 config
                                      时每步显示当前值作为默认\n- [ ]
                                      直接回车保留原值\n- [ ] 首次 onboard（无
                                      config）行为不变\n")
  ⎿  Interrupted · What should Claude do instead?

❯ 我是让你更新'/data/home/geminitwang/code/mindos/wiki/task-spec-user-onboard.md'  
这个文件，而不是MindOS                                                               
  ⎿  ⧉ Selected 17 lines from wiki/task-spec-user-onboard.md in Visual Studio Code

● 明白，用本地的 Write/Edit 工具更新，不用 MindOS MCP。

● Reading 1 file… (ctrl+o to expand)
  ⎿  wiki/task-spec-user-onboard.md

✽ Elucidating… (32s · ↓ 118 tokens)

─────────────────────────────────────────────────────────────────────────────────────
❯  
─────────────────────────────────────────────────────────────────────────────────────
  esc to interrupt
