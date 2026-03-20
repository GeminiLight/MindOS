# AIP-004: 并发控制技术规格文档

## 文档信息

**版本：** v1.0  
**状态：** 草案 (Draft)  
**创建日期：** 2026-03-20  
**最后更新：** 2026-03-20  
**负责人：** 架构团队

## 概述

本规格文档定义了 MindOS 并发控制系统的技术实现细节，包括接口定义、数据结构、算法流程和错误处理机制。

## 核心接口定义

### 1. 文件版本元数据接口

```typescript
/**
 * 文件版本元数据
 */
interface FileVersion {
  /** 文件路径（相对于知识库根目录） */
  path: string;
  
  /** 版本号（单调递增，从1开始） */
  version: number;
  
  /** 最后修改时间（ISO 8601格式） */
  lastModified: string;
  
  /** 文件内容SHA-256哈希值 */
  hash: string;
  
  /** 文件大小（字节数） */
  size: number;
  
  /** 修改者标识（Agent ID 或用户ID） */
  author?: string;
  
  /** 父版本号（用于冲突解决） */
  parentVersion?: number;
  
  /** 修改类型（创建、修改、删除） */
  changeType: 'create' | 'modify' | 'delete';
  
  /** 修改摘要（可选） */
  summary?: string;
}
```

### 2. 版本存储接口

```typescript
/**
 * 版本存储管理器
 */
interface VersionStore {
  /**
   * 获取文件当前版本
   */
  getVersion(path: string): Promise<FileVersion | null>;
  
  /**
   * 设置文件版本
   */
  setVersion(path: string, version: FileVersion): Promise<void>;
  
  /**
   * 获取文件版本历史
   * @param limit 限制返回的版本数量
   */
  getHistory(path: string, limit?: number): Promise<FileVersion[]>;
  
  /**
   * 删除文件版本历史
   */
  deleteHistory(path: string): Promise<void>;
  
  /**
   * 检查文件是否存在
   */
  exists(path: string): Promise<boolean>;
}
```

### 3. 并发编辑管理器接口

```typescript
/**
 * 并发编辑管理器
 */
interface ConcurrentEditManager {
  /**
   * 获取文件编辑锁
   * @param path 文件路径
   * @param author 编辑者标识
   * @param timeoutMs 超时时间（毫秒）
   * @returns 当前文件版本
   */
  acquireLock(
    path: string, 
    author: string, 
    timeoutMs?: number
  ): Promise<FileVersion>;
  
  /**
   * 释放文件编辑锁
   */
  releaseLock(path: string, author: string): Promise<void>;
  
  /**
   * 提交文件修改
   * @param path 文件路径
   * @param baseVersion 编辑开始时的版本
   * @param newContent 新内容
   * @param author 编辑者标识
   * @param summary 修改摘要
   */
  commitChanges(
    path: string,
    baseVersion: FileVersion,
    newContent: string,
    author: string,
    summary?: string
  ): Promise<CommitResult>;
  
  /**
   * 检查文件是否被锁定
   */
  isLocked(path: string): Promise<boolean>;
  
  /**
   * 获取文件锁定信息
   */
  getLockInfo(path: string): Promise<LockInfo | null>;
}
```

### 4. 冲突解决接口

```typescript
/**
 * 冲突信息
 */
interface Conflict {
  /** 冲突开始行号 */
  startLine: number;
  
  /** 冲突结束行号 */
  endLine: number;
  
  /** 共同祖先内容 */
  baseContent: string;
  
  /** 当前版本内容 */
  currentContent: string;
  
  /** 传入版本内容 */
  incomingContent: string;
  
  /** 冲突类型 */
  type: 'modify' | 'delete' | 'insert';
  
  /** 冲突严重程度 */
  severity: 'low' | 'medium' | 'high';
}

/**
 * 冲突解决结果
 */
interface ConflictResolution {
  /** 解决后的内容 */
  content: string;
  
  /** 解决的冲突列表 */
  resolvedConflicts: Conflict[];
  
  /** 是否还有未解决的冲突 */
  hasUnresolvedConflicts: boolean;
  
  /** 解决策略 */
  strategy: 'auto' | 'manual' | 'current' | 'incoming';
}

/**
 * 冲突解决器
 */
interface ConflictResolver {
  /**
   * 检测冲突
   */
  detectConflicts(
    base: string,
    current: string,
    incoming: string
  ): Promise<Conflict[]>;
  
  /**
   * 自动解决冲突
   */
  resolveConflicts(
    base: string,
    current: string,
    incoming: string,
    strategy?: 'current' | 'incoming' | 'merge'
  ): Promise<ConflictResolution>;
  
  /**
   * 手动解决冲突
   */
  manualResolve(
    conflict: Conflict,
    resolution: string
  ): Promise<void>;
}
```

## 数据结构设计

### 1. 版本存储格式

```typescript
// 版本索引文件格式（JSON）
interface VersionIndex {
  version: 1;
  files: {
    [path: string]: {
      currentVersion: number;
      lastModified: string;
      hash: string;
      size: number;
    };
  };
}

// 版本历史文件格式（按版本号存储）
interface VersionHistoryEntry {
  version: number;
  timestamp: string;
  author: string;
  hash: string;
  size: number;
  changeType: 'create' | 'modify' | 'delete';
  parentVersion?: number;
  summary?: string;
}
```

### 2. 锁管理数据结构

```typescript
interface LockInfo {
  path: string;
  author: string;
  acquiredAt: string;
  expiresAt: string;
  version: FileVersion;
}

// 内存锁表
class LockTable {
  private locks = new Map<string, LockInfo>();
  private timers = new Map<string, NodeJS.Timeout>();
  
  // 锁超时时间（默认5分钟）
  private static readonly DEFAULT_TIMEOUT = 5 * 60 * 1000;
}
```

### 3. 差异算法数据结构

```typescript
// 差异片段
interface DiffSegment {
  type: 'unchanged' | 'insert' | 'delete' | 'modify';
  baseLines?: string[];
  currentLines?: string[];
  incomingLines?: string[];
  startLine: number;
  endLine: number;
}

// 合并结果
interface MergeResult {
  content: string;
  conflicts: Conflict[];
  appliedChanges: DiffSegment[];
  mergeStrategy: string;
}
```

## 算法规格

### 1. 三向合并算法

```typescript
/**
 * 三向合并算法实现
 */
class ThreeWayMerge {
  async merge(
    base: string,
    current: string,
    incoming: string
  ): Promise<MergeResult> {
    // 步骤1: 行级分词
    const baseLines = this.splitLines(base);
    const currentLines = this.splitLines(current);
    const incomingLines = this.splitLines(incoming);
    
    // 步骤2: 计算差异
    const currentDiff = this.computeDiff(baseLines, currentLines);
    const incomingDiff = this.computeDiff(baseLines, incomingLines);
    
    // 步骤3: 冲突检测
    const conflicts = this.detectConflicts(currentDiff, incomingDiff);
    
    // 步骤4: 自动合并
    const mergedLines = this.applyMerge(baseLines, currentDiff, incomingDiff, conflicts);
    
    // 步骤5: 生成结果
    return {
      content: mergedLines.join('\n'),
      conflicts,
      appliedChanges: [...currentDiff, ...incomingDiff],
      mergeStrategy: conflicts.length > 0 ? 'manual' : 'auto'
    };
  }
  
  private computeDiff(base: string[], modified: string[]): DiffSegment[] {
    // 实现基于行的差异计算
    // 使用 Myers diff 算法或类似算法
  }
  
  private detectConflicts(currentDiff: DiffSegment[], incomingDiff: DiffSegment[]): Conflict[] {
    // 检测重叠的修改区域
  }
}
```

### 2. 乐观锁算法

```typescript
/**
 * 乐观锁实现
 */
class OptimisticLockManager {
  async acquire(path: string, author: string): Promise<FileVersion> {
    // 检查是否已锁定
    if (await this.isLocked(path)) {
      throw new MindOSError(
        ErrorCodes.CONCURRENT_MODIFICATION,
        `File ${path} is locked by another user`
      );
    }
    
    // 获取当前版本
    const currentVersion = await this.versionStore.getVersion(path);
    
    // 创建锁记录
    const lockInfo: LockInfo = {
      path,
      author,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + LOCK_TIMEOUT).toISOString(),
      version: currentVersion || this.createInitialVersion(path)
    };
    
    // 设置锁
    await this.lockTable.setLock(path, lockInfo);
    
    return lockInfo.version;
  }
  
  async commit(path: string, baseVersion: FileVersion, newContent: string): Promise<void> {
    // 验证版本一致性
    const currentVersion = await this.versionStore.getVersion(path);
    if (!currentVersion || currentVersion.version !== baseVersion.version) {
      throw new MindOSError(
        ErrorCodes.CONCURRENT_MODIFICATION,
        'File has been modified since lock acquisition'
      );
    }
    
    // 释放锁
    await this.lockTable.releaseLock(path);
    
    // 创建新版本
    const newVersion: FileVersion = {
      ...baseVersion,
      version: baseVersion.version + 1,
      lastModified: new Date().toISOString(),
      hash: await this.calculateHash(newContent),
      size: newContent.length,
      parentVersion: baseVersion.version
    };
    
    // 保存新版本
    await this.versionStore.setVersion(path, newVersion);
  }
}
```

## 错误处理规格

### 1. 错误码定义

```typescript
export const ConcurrentControlErrorCodes = {
  // 锁相关错误
  FILE_LOCKED: 'FILE_LOCKED',
  LOCK_TIMEOUT: 'LOCK_TIMEOUT',
  LOCK_EXPIRED: 'LOCK_EXPIRED',
  
  // 版本相关错误
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  
  // 冲突相关错误
  CONFLICT_DETECTED: 'CONFLICT_DETECTED',
  AUTO_MERGE_FAILED: 'AUTO_MERGE_FAILED',
  
  // 系统错误
  STORAGE_ERROR: 'STORAGE_ERROR',
  LOCK_TABLE_FULL: 'LOCK_TABLE_FULL',
} as const;
```

### 2. 错误响应格式

```typescript
interface ConcurrentControlError {
  code: string;
  message: string;
  path?: string;
  currentVersion?: FileVersion;
  conflictingVersion?: FileVersion;
  conflicts?: Conflict[];
  suggestedResolution?: string;
}
```

## 性能指标

### 1. 响应时间要求

| 操作 | 目标响应时间 | 最大响应时间 |
|------|-------------|-------------|
| 获取锁 | < 10ms | < 50ms |
| 提交修改 | < 50ms | < 200ms |
| 冲突检测 | < 100ms | < 500ms |
| 自动合并 | < 200ms | < 1000ms |

### 2. 资源使用限制

| 资源 | 限制 | 监控指标 |
|------|------|---------|
| 内存使用 | < 100MB | 锁表大小、版本缓存 |
| 存储空间 | < 1GB | 版本历史大小 |
| 并发锁数 | < 1000 | 活跃锁数量 |

## 测试规格

### 1. 单元测试覆盖

```typescript
describe('ConcurrentControl', () => {
  describe('LockManager', () => {
    it('should acquire lock successfully', async () => {
      // 测试锁获取
    });
    
    it('should detect concurrent modifications', async () => {
      // 测试并发检测
    });
  });
  
  describe('ConflictResolver', () => {
    it('should resolve simple conflicts automatically', async () => {
      // 测试自动合并
    });
    
    it('should detect complex conflicts', async () => {
      // 测试冲突检测
    });
  });
});
```

### 2. 集成测试场景

- 多用户同时编辑不同文件
- 多用户同时编辑同一文件
- 网络中断后的恢复
- 大文件并发处理

## 部署配置

### 1. 环境变量配置

```bash
# 并发控制配置
CONCURRENT_CONTROL_ENABLED=true
LOCK_TIMEOUT_MS=300000  # 5分钟
MAX_CONCURRENT_LOCKS=1000
VERSION_HISTORY_LIMIT=100
AUTO_MERGE_ENABLED=true
```

### 2. 运行时配置

```typescript
interface ConcurrentControlConfig {
  enabled: boolean;
  lockTimeoutMs: number;
  maxConcurrentLocks: number;
  versionHistoryLimit: number;
  autoMergeEnabled: boolean;
  conflictResolutionStrategy: 'auto' | 'manual' | 'prompt';
}
```

## 兼容性说明

### 1. 向后兼容性
- 新版本系统可以读取旧版本文件
- 旧版本系统无法使用新版本功能
- 版本历史格式保持稳定

### 2. 向前兼容性
- 预留扩展字段支持未来功能
- 接口设计支持插件扩展
- 配置系统支持动态调整

## 安全考虑

### 1. 权限控制
- 文件操作权限验证
- 锁所有权检查
- 版本访问控制

### 2. 数据完整性
- 哈希校验防止篡改
- 事务性操作保证一致性
- 备份和恢复机制

---

**文档状态：** 草案  
**下次评审：** 2026-03-27  
**批准人：** 架构委员会