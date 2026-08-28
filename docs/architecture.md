# reYunPlex 当前架构

本文描述当前工作树的模块责任和主要调用链。领域术语以 [CONTEXT.md](../CONTEXT.md) 为准，同步细节以 [sync-flow.md](sync-flow.md) 为准。

## 运行拓扑

```text
浏览器（Nuxt SPA）
  pages -> components/composables -> useApi -> Nitro /api
  composables/sse.ts <- /api/sync/events

Nitro 单进程服务
  HTTP API
  SQLite data/data.db
  Source Convergence 单实例
  来源级持久调度队列 + 单消费者
  持久下载队列 + 全局下载并发
  Plex / 网易云外部调用
```

当前部署模型是单进程、单数据库。来源调度器按每个 Playlist Source 的独立间隔幂等写入 Source Convergence Request，单消费者严格串行领取；同步服务继续用 `isRunning` 作为第二层互斥。下载队列可以并发，但并发数仍来自全局配置。

## 前端边界

| 区域 | 页面/模块 | 责任 |
|---|---|---|
| 初始化与认证 | `pages/setup.vue`、`pages/login.vue`、`middleware/` | 初始管理员、连接配置、会话保护 |
| 仪表盘 | `pages/index.vue`、`components/dashboard/`、`components/system/SystemMonitorPanel.vue` | 可行动摘要、同步操作、来源健康、依赖健康和当前资源 |
| 来源管理 | `pages/sync-sources.vue`、`components/sources/`、`composables/useSyncSourcesPage.ts` | 歌单/专辑来源、过滤、批量操作、来源级策略、歌曲与媒体接管 |
| 手动下载 | `pages/manual-download.vue`、`components/manual-download/` | 解析歌单/专辑/歌曲、勾选并创建下载任务 |
| 任务中心 | `pages/task-center/`、`components/task-center/`、`components/jobs/` | 当前工作、实时进度、下载队列、异常处理和运行记录 |
| 高级媒体关联 | `pages/match-reviews.vue`、`components/sources/SourceMediaDetails.vue` | 仅发现和清理未被当前来源引用的孤立关联，不是一级入口 |
| 日志查看 | `pages/logs.vue`、`components/system/SystemLogsPanel.vue` | 警告、错误和系统诊断记录 |

`composables/sse.ts` 是浏览器端共享 SSE 连接。下载队列和同步状态采用 SSE 优先、必要时轮询回退；订阅者离开页面时必须释放 listener、timer 和引用。

## 服务端边界

| 模块 | 责任 | 不应承担 |
|---|---|---|
| `server/api/` | HTTP 参数、鉴权边界、调用领域服务、统一响应 | 复制同步或下载主流程 |
| `server/lib/config/` | 默认值、类型、迁移、校验、持久化、运行时应用 | 来源身份或 Plex mutation |
| `server/lib/db/` | 当前 schema 基线、结构初始化和配置种子 | 业务策略与旧版本兼容迁移 |
| `server/lib/playlist/` | Playlist Source CRUD、批量动作、来源状态 | 歌曲身份推断 |
| `server/lib/download/` | 持久任务、lease、并发消费、单曲文件执行、Managed Media Command 与一次资产提交 | Plex 歌单删除授权 |
| `server/lib/sync/` | Track Resolution、Identity Binding、Reconciliation Plan、Source Convergence | 第二套手动下载入口 |
| `server/lib/run/` | 统一 task run 记录、查询和清理 | 领域状态真相 |
| `server/lib/log/` | 诊断日志和有界保留 | 替代领域状态或身份事件 |

## 关键调用链

### Source Convergence

```text
手动全局/单源/批量/重试入口
  -> server/lib/sync/service.ts
  -> 获取 NetEase Target Song snapshot
  -> change-detection.ts
  -> source-pure-reorder.ts（仅完整强身份的纯重排）
     或 plex-reconciler.ts + lookup.ts（完整 Track Resolution）
  -> source-downloads.ts（需要下载或替换的 Local Media Asset）
  -> source-plex-reconciliation.ts
       身份版本校验 -> 应用本轮 binding -> Plex mutation -> read-back
  -> source-finalization.ts
       来源游标、当前异常投影和 task run
```

`service.ts` 是唯一编排入口。API handler、补全动作或调度 worker 不应自行拼接“查找—下载—扫描—重排”第二条链路。

### 来源级自动调度

```text
playlist_sources.next_sync_at + 来源/全局间隔
  -> source-schedule-store.ts（计算到期、幂等入队、lease、恢复与保留）
  -> source_sync_queue（Source Convergence Request）
  -> worker.ts 单消费者
  -> service.runSyncForSource(..., trigger: schedule)
  -> Source Convergence
```

来源间隔为空时继承全局间隔。手动同步直接走 Source Convergence，不等待队列；若它在待执行请求之后完成，调度存储会取消被手动结果取代的旧请求。进程启动时运行中的请求回到等待态，关闭时停止领取新请求并等待当前请求结束。

SQLite 的部分唯一索引保证整个数据库最多只有一个 `running` 请求，即使开发热重载短暂产生多个内存 worker，也不能并行执行两个来源。请求使用 90 秒租约并每 30 秒续约；每轮排期都会回收过期租约，完成提交还必须匹配 lease owner。请求在启动同步前绑定 task run，另一插件实例不会把仍有有效租约的运行误判为失败；真正的进程中断记录为取消并自动重新排队。

### 手动下载

```text
pages/manual-download.vue
  -> server/api/download.post.ts
  -> server/lib/download/download-batch.ts
  -> server/lib/download/queue.ts
  -> server/lib/download/single-song.ts
  -> server/lib/tag-writer.ts
  -> server/lib/download/media-write.ts（成功后一次提交 Local Media Asset）
```

同步、补全和重试需要单曲下载配置时，统一通过 `server/lib/download/options.ts` 装配默认值、下载模式和目标意图。`single-song.ts` 只执行文件操作，不持久化身份；队列或直接调用者必须在标签成功后统一通过 `media-write.ts` 提交一次。全局下载并发由 queue 消费端控制。

### 下载并托管

```text
同步源歌曲上下文
  -> server/lib/download/managed-media-command.ts
  -> 带 Playlist Source 上下文的 manual_download task run + download task
  -> single-song.ts（安全规划独立托管路径并写文件）
  -> media-write.ts（一次提交 Local Media Asset）
  -> 标记所有引用该 Target Song 的来源待重新对齐
  -> 后续 Source Convergence 按精确路径建立 path Media Link
```

Managed Media Command 不执行 Plex 歌单 mutation，也不复制 Source Convergence。来源上下文贯穿 task run、下载任务和失败记录。

### 媒体接管

```text
同步源歌曲上下文搜索 Plex
  -> 用户选择一个具体 Plex 媒体
  -> song_identity_bindings(manual)
  -> 受影响来源标记为待对齐
  -> 下次 Source Convergence 按 ratingKey + 精确路径验证
```

人工接管是外部媒体唯一的身份入口。身份版本在计划和 Plex mutation 之间发生变化时，本轮必须安全中止。

## 数据责任

- `playlist_sources` 及 occurrence 表：来源配置、目标快照、顺序和同步游标。
- `source_sync_queue`：有界保留、可恢复的 Source Convergence Request；不是第二套同步流程。
- `song_identity_bindings`：托管路径或人工接管形成的当前媒体关联。
- `local_media_assets`：本地路径、managed/external 归属、连续性和替换状态。
- `download_tasks`：可保留和恢复的下载队列；不是长期歌曲身份事实。
- `task_runs`、failure records：运行结果和可操作失败。
- `logs`：诊断记录；面向用户的执行历史统一由 `task_runs` 表达。

`server/lib/db/schema.ts` 是全新数据库的唯一当前结构。本项目尚未对外发布，因此旧版本兼容迁移已经退役；结构变化直接形成新的开发期 schema 基线，测试数据库应重新创建。

## 系统不变量

1. Playlist Source 定义目标成员和顺序，但不能绕过删除保护。
2. Identity Binding、Local Media Asset 和 Playlist Occurrence 是三种不同事实。
3. 只有具体 Plex `playlistItemID` 可以被授权移除；同步不删除媒体文件。
4. 标题、艺人、专辑、GUID 和刮削器元数据都不能自动建立身份。
5. 下载替换先写临时文件并校验，失败保留旧媒体、旧身份和旧 Plex occurrence。
6. Plex mutation 前检查身份版本，写入后必须 read-back。
7. 配置的来源级布尔覆盖是三态值，`null` 表示继承，不能用普通 truthy 合并。
8. 外部服务、文件系统、重启和长时间运行验证必须与单元测试/构建结果分开陈述。
9. 调度器只创建 Source Convergence Request；只有单消费者可以把请求从等待态变为运行态，实际业务仍只由 Source Convergence 执行。
