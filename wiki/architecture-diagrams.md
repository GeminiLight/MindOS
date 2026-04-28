# MindOS 技术架构图 (Architecture Diagrams)

## 系统整体架构图

```mermaid
graph TB
    subgraph "用户界面层"
        A[Web GUI<br/>Next.js 16 App]
        B[CLI 工具<br/>Node.js CLI]
    end
    
    subgraph "服务层"
        C[API Server<br/>Next.js API Routes]
        D[MCP Server<br/>MCP Protocol]
    end
    
    subgraph "数据层"
        E[本地知识库<br/>Markdown + JSON + CSV]
        F[Git 版本控制<br/>自动同步]
    end
    
    subgraph "外部集成"
        G[AI Agent<br/>Claude, Cursor等]
        H[AI Provider<br/>Anthropic, OpenAI]
    end
    
    A --> C
    B --> C
    C --> E
    D --> E
    G --> D
    C --> H
    E --> F
    
    style A fill:#f59e0b,stroke:#d97706,color:#fff
    style B fill:#f59e0b,stroke:#d97706,color:#fff
    style C fill:#10b981,stroke:#059669,color:#fff
    style D fill:#10b981,stroke:#059669,color:#fff
    style E fill:#6366f1,stroke:#4f46e5,color:#fff
    style F fill:#6366f1,stroke:#4f46e5,color:#fff
    style G fill:#64748b,stroke:#475569,color:#fff
    style H fill:#64748b,stroke:#475569,color:#fff
```

## 数据流程图

### AI 对话数据流

```mermaid
sequenceDiagram
    participant U as 用户
    participant G as Web GUI
    participant A as API Server
    participant AI as AI Provider
    participant KB as 知识库
    
    U->>G: 发送消息
    G->>A: POST /api/ask
    A->>KB: 读取上下文文件
    KB-->>A: 返回上下文
    A->>AI: 流式请求 (Vercel AI SDK)
    AI-->>A: 流式响应
    A-->>G: 流式显示
    G-->>U: 实时显示结果
    
    Note over A,KB: 自动注入：Skill + Bootstrap + 当前文件
```

### MCP 协议数据流

```mermaid
sequenceDiagram
    participant AG as AI Agent
    participant MS as MCP Server
    participant KB as 知识库
    participant FS as 文件系统
    
    AG->>MS: MCP 工具调用 (stdio/HTTP)
    MS->>MS: Bearer Token 验证
    MS->>MS: 路径沙箱检查
    MS->>KB: 执行文件操作
    KB->>FS: 读写文件
    FS-->>KB: 操作结果
    KB-->>MS: 返回数据
    MS-->>AG: MCP 响应
    
    Note over MS,KB: 工具覆盖：读取、搜索、写入、管理
```

## 组件关系图

### 前端应用架构

```mermaid
graph LR
    subgraph "Next.js App Router"
        P1[页面组件<br/>App Router]
        P2[API Routes<br/>16个端点]
    end
    
    subgraph "UI 组件层"
        C1[核心组件<br/>编辑器、导航]
        C2[插件渲染器<br/>10个渲染器]
        C3[设置面板<br/>多标签页]
    end
    
    subgraph "业务逻辑层"
        L1[文件系统操作<br/>fs.ts]
        L2[内置 Agent<br/>agent/]
        L3[配置管理<br/>settings.ts]
    end
    
    P1 --> C1
    P1 --> C2
    P1 --> C3
    C1 --> L1
    C1 --> L2
    C1 --> L3
    P2 --> L1
    P2 --> L2
    P2 --> L3
```

### MCP 服务器架构

```mermaid
graph TB
    subgraph "传输层"
        T1[stdio 传输<br/>本地 Agent]
        T2[HTTP 传输<br/>远程 Agent]
    end
    
    subgraph "协议层"
        P1[MCP 协议解析<br/>@modelcontextprotocol/sdk]
        P2[工具路由<br/>与 App API 对齐]
    end
    
    subgraph "安全层"
        S1[Bearer Token 认证]
        S2[路径沙箱检查]
        S3[写保护机制]
    end
    
    subgraph "业务层"
        B1[文件操作<br/>读取、搜索、写入]
        B2[语义编辑<br/>插入、更新、删除]
        B3[管理操作<br/>重命名、移动]
    end
    
    T1 --> P1
    T2 --> P1
    P1 --> S1
    P1 --> S2
    P1 --> S3
    S1 --> B1
    S2 --> B2
    S3 --> B3
    B1 --> FS[文件系统]
    B2 --> FS
    B3 --> FS
```

## 技术支柱架构图

### Pillar 1: 群体智能调度

```mermaid
graph LR
    subgraph "调度器"
        S1[任务感知路由<br/>动态上下文裁剪]
        S2[并发冲突解决<br/>锁机制 + 合并]
        S3[细粒度权限<br/>语义级访问控制]
    end
    
    subgraph "Agent 池"
        A1[Claude Code]
        A2[Cursor]
        A3[其他 Agent]
    end
    
    subgraph "知识库"
        K1[代码区]
        K2[Profile]
        K3[SOP]
    end
    
    A1 --> S1
    A2 --> S1
    A3 --> S1
    S1 --> K1
    S2 --> K2
    S3 --> K3
```

### Pillar 2: 经验编译管道

```mermaid
graph TB
    I[人机交互<br/>对话日志]
    
    subgraph "经验提取"
        E1[交互增量分析<br/>diff 提取]
        E2[模式识别<br/>行为模式]
        E3[结构化转换<br/>SOP 格式]
    end
    
    subgraph "质量保证"
        Q1[验证机制<br/>有效性检查]
        Q2[反馈循环<br/>用户确认]
        Q3[版本控制<br/>演化追踪]
    end
    
    S[可执行 SOP<br/>Agent 指令]
    
    I --> E1
    E1 --> E2
    E2 --> E3
    E3 --> Q1
    Q1 --> Q2
    Q2 --> Q3
    Q3 --> S
```

### Pillar 3: 记忆代谢系统

```mermaid
graph LR
    subgraph "记忆层级"
        L1[工作记忆<br/>对话上下文]
        L2[短期记忆<br/>近期沉淀]
        L3[长期记忆<br/>全局 SOP]
        L4[归档记忆<br/>低频访问]
    end
    
    subgraph "代谢机制"
        M1[活跃度感知<br/>访问频率追踪]
        M2[碎片折叠<br/>自动合并]
        M3[矛盾检测<br/>冲突解决]
    end
    
    L1 --> M1
    L2 --> M1
    L3 --> M1
    L4 --> M1
    
    M1 --> M2
    M2 --> M3
    M3 --> L3
```

### Pillar 4: 认知镜像系统

```mermaid
graph TB
    subgraph "数据源"
        D1[交互日志<br/>工具调用记录]
        D2[编辑行为<br/>内容修改模式]
        D3[Profile 数据<br/>用户偏好]
    end
    
    subgraph "分析引擎"
        A1[偏好推断<br/>行为模式分析]
        A2[意图预测<br/>上下文感知]
        A3[演化追踪<br/>认知变化]
    end
    
    subgraph "个性化服务"
        P1[心智预设注入<br/>Agent 上下文]
        P2[主动推荐<br/>知识推送]
        P3[认知镜像<br/>用户模型]
    end
    
    D1 --> A1
    D2 --> A1
    D3 --> A1
    A1 --> A2
    A2 --> A3
    A3 --> P1
    A3 --> P2
    A3 --> P3
```

## 部署架构图

### 本地部署架构

```mermaid
graph TB
    subgraph "用户设备"
        U[用户浏览器]
        C[CLI 终端]
        A[AI Agent]
    end
    
    subgraph "MindOS 进程"
        W[Web Server<br/>端口 3456]
        M[MCP Server<br/>端口 8781]
        S[后台服务<br/>systemd/launchd]
    end
    
    subgraph "数据存储"
        K[知识库目录<br/>~/MindOS]
        G[Git 仓库<br/>版本控制]
        C[配置文件<br/>~/.mindos]
    end
    
    U --> W
    C --> W
    A --> M
    W --> K
    M --> K
    S --> W
    S --> M
    K --> G
```

### 网络部署架构

```mermaid
graph TB
    subgraph "客户端"
        U[用户浏览器]
        A[远程 AI Agent]
    end
    
    subgraph "网络边界"
        F[防火墙<br/>端口 3456/8781]
        L[负载均衡器<br/>可选]
    end
    
    subgraph "服务器"
        S1[主服务器<br/>MindOS 进程]
        S2[备份服务器<br/>可选]
    end
    
    subgraph "存储层"
        K[共享知识库<br/>网络存储]
        G[Git 远程仓库<br/>自动同步]
    end
    
    U --> F
    A --> F
    F --> L
    L --> S1
    L --> S2
    S1 --> K
    S2 --> K
    K --> G
```

## 安全架构图

```mermaid
graph TB
    subgraph "认证层"
        A1[Bearer Token<br/>API/MCP 认证]
        A2[Web Password<br/>GUI 访问控制]
        A3[环境变量<br/>API Key 管理]
    end
    
    subgraph "授权层"
        P1[路径沙箱<br/>操作范围限制]
        P2[写保护<br/>关键文件保护]
        P3[操作审计<br/>日志记录]
    end
    
    subgraph "数据安全"
        D1[本地存储<br/>数据主权]
        D2[原子写入<br/>防数据丢失]
        D3[Git 版本<br/>可恢复性]
    end
    
    subgraph "网络安全"
        N1[HTTPS 加密<br/>传输安全]
        N2[端口控制<br/>访问限制]
        N3[防火墙<br/>网络隔离]
    end
    
    A1 --> P1
    A2 --> P2
    A3 --> P3
    P1 --> D1
    P2 --> D2
    P3 --> D3
    D1 --> N1
    D2 --> N2
    D3 --> N3
```

## 总结

这些架构图展示了 MindOS 系统的完整技术架构，包括：

1. **分层架构**：清晰的 UI/服务/数据分层
2. **数据流**：详细的请求处理流程
3. **组件关系**：模块间的依赖和交互
4. **技术支柱**：四个核心创新点的实现架构
5. **部署方案**：本地和网络部署模式
6. **安全机制**：多层次的安全保护体系

这些图表有助于理解系统的复杂性，指导后续的开发和优化工作。