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
  来源请求持久队列（接管分析 / 同步）+ 单消费者
  持久下载队列 + 全局下载并发
  Plex / 网易云外部调用
```

当前部署模型是单进程、单数据库。来源请求应用服务统一分流接管分析与 Source Convergence，来源调度器按各来源独立间隔调用相同分流逻辑；单消费者严格串行领取，两类请求与 Repair 互斥。同步服务继续用 `isRunning` 和最终接管闸门作执行保护。下载队列可以并发，但并发数仍来自全局配置。

## 前端边界

| 区域         | 页面/模块                                                                              | 责任                                                                           |
| ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 初始化与认证 | `pages/setup.vue`、`pages/login.vue`、`middleware/`                                    | 初始管理员、连接配置、会话保护                                                 |
| 仪表盘       | `pages/index.vue`、`components/dashboard/`、`components/system/SystemMonitorPanel.vue` | 可行动摘要、同步操作、来源健康、依赖健康和当前资源                             |
| 来源管理     | `pages/sync-sources/index.vue`、`pages/sync-sources/[id].vue`、`components/sources/`   | 外层来源筛选与普通同步；详情页承载首次媒体接管、歌曲与媒体、运行记录及高级设置 |
| 手动下载     | `pages/manual-download.vue`、`components/manual-download/`                             | 解析歌单/专辑/歌曲、勾选并创建下载任务                                         |
| 任务中心     | `pages/task-center/`、`components/task-center/`、`components/jobs/`                    | 当前工作、实时进度、下载队列、异常处理和运行记录                               |
| 高级媒体关联 | `pages/match-reviews.vue`、`components/sources/SourceMediaDetails.vue`                 | 仅发现和清理未被当前来源引用的孤立关联，不是一级入口                           |
| 日志查看     | `pages/logs.vue`、`components/system/SystemLogsPanel.vue`                              | 警告、错误和系统诊断记录                                                       |

`composables/sse.ts` 是浏览器端共享 SSE 连接。下载队列和同步状态采用 SSE 优先、必要时轮询回退；订阅者离开页面时必须释放 listener、timer 和引用。

## 服务端边界

| 模块                   | 责任                                                                          | 不应承担                   |
| ---------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `server/api/`          | HTTP 参数、鉴权边界、调用领域服务、统一响应                                   | 复制同步或下载主流程       |
| `server/lib/config/`   | 默认值、类型、迁移、校验、持久化、运行时应用                                  | 来源身份或 Plex mutation   |
| `server/lib/db/`       | 当前 schema、配置种子、有界幂等结构升级                                       | 业务策略与完整历史迁移体系 |
| `server/lib/playlist/` | Playlist Source CRUD、批量动作、来源状态                                      | 歌曲身份推断               |
| `server/lib/download/` | 持久任务、lease、并发消费、单曲文件执行、Managed Media Command 与一次资产提交 | Plex 歌单删除授权          |
| `server/lib/sync/`     | Track Resolution、Identity Binding、Reconciliation Plan、Source Convergence   | 第二套手动下载入口         |
| `server/lib/run/`      | 统一 task run 记录、查询和清理                                                | 领域状态真相               |
| `server/lib/log/`      | 诊断日志和有界保留                                                            | 替代领域状态或身份事件     |

## 关键调用链

### Source Convergence

```text
手动全局/单源/批量/来源失败重试入口
  -> source-requests.ts（忙时拒绝、一次事务接受、逐来源结果）
  -> source_sync_queue（类型、模式、触发原因、批次、初始化关联）
  -> worker.ts（同一单消费者执行分析或同步）
  -> server/lib/sync/service.ts（Source Convergence 最终闸门）
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

### Media Repair Command

```text
同步源“修复标签、词图”
  -> media-repair-command.ts（解析现有本地目标并原子创建 Repair Run + tasks）
  -> file-task-command.ts（实际任务 ID、复用结果、调用者关联）
  -> download_tasks(operation=repair_existing, target_path=实际路径)
  -> worker.ts（全局消费者，通过 queue.ts 领取与续租）
  -> single-song.ts（标签与辅助文件）
  -> media-write.ts（先提交 Local Media Asset，再把 task 标记 done）
  -> 本批任务完成后 refreshLibrary（仅刷新 Plex 媒体库，不等待无关下载）
```

Media Repair Command 不修改 Plex 歌单、不建立 Media Link，也不调用第二条
Source Convergence。服务重启时进行中的 repair task 回到 pending，启动插件续跑；
Source Schedule 在 repair 持有互斥状态时只排队，不启动 Source Convergence。

### 来源级自动调度

```text
playlist_sources.next_sync_at + 来源/全局间隔
  -> source-schedule-store.ts（计算到期与来源排期）
  -> source-requests.ts（共用按来源分流）
  -> request-store.ts / source_sync_queue（持久化与幂等请求）
  -> worker.ts 单消费者（通过 source-schedule-store.ts 领取、续租与恢复）
  -> analyzeSourceInitialization 或 service.prepareSyncForSource(..., trigger: schedule)
```

来源间隔为空时继承全局间隔。手动同步在已有执行、Repair 或已接受批次未结束时直接拒绝且不留下请求；空闲时原子接受混合批次，就绪来源先同步，再分析需接管来源，组内保留原顺序。等待审核只返回状态，不占租约。显式单源执行和分析允许禁用来源，自动调度与接管后的自动续接要求来源启用。自动调度关闭后消费者仍处理显式请求。停止服务时停止领取并中止当前分析等待；重启恢复同一请求并重新读取外部快照，审核草案不会自动提交。

SQLite 的部分唯一索引保证整个数据库最多只有一个 `running` 请求。请求使用 90 秒租约并每 30 秒续约；每轮排期都会回收过期租约，完成提交还必须匹配 lease owner。分析 Run 在排队时已创建，同步请求在启动前绑定 Run；有效租约或待恢复的分析请求不会被误判为失败。等待、执行与审核分别通过请求状态和 `awaiting_action` 投影展示。

### 手动下载

```text
pages/manual-download.vue
  -> server/api/download.post.ts
  -> server/lib/download/resource-selection.ts
  -> server/lib/download/download-command.ts
  -> file-task-command.ts（提交、唤醒、等待分离）
  -> download_tasks
  -> server/lib/download/worker.ts（唯一消费者）
  -> server/lib/download/single-song.ts
  -> server/lib/tag-writer.ts
  -> server/lib/download/media-write.ts（成功后一次提交 Local Media Asset）
```

歌单、专辑和单曲只在 Resource Selection 层使用不同 Adapter；其后都转换为同一种有序下载选择。Download Command 在一个事务中持久化 Run、实际 tasks 及本次调用的结果关联。去重保留原任务归属，各调用者通过实际任务 ID 读取自己的结果；取消来源同步只停止该次等待和后续 Plex 操作。同步、补全和重试需要单曲下载配置时，统一通过 `server/lib/download/options.ts` 装配默认值、下载模式和目标意图。

`single-song.ts` 只执行文件操作，不持久化身份。只有 `server/lib/download/worker.ts` 可以调用队列 drain 和单曲执行；它在标签成功后通过 `media-write.ts` 提交 Local Media Asset。`downloadConcurrency` 是该唯一 Worker 的进程级上限，手动下载、Source Convergence、Repair 和重试不再叠加并发。任务持久化非敏感 execution intent，Cookie 始终在执行时从当前配置读取。消费者按空闲槽位补充任务，唤醒时也会检查剩余并发容量；新增 Repair 可利用空闲槽位，无需等待此前快照的整批下载完成。单任务仍调用 `processAll`，沿用同一租约、文件验证和结果持久化路径。

### 下载并托管

```text
同步源歌曲上下文
  -> server/lib/download/managed-media-command.ts
  -> 带 Playlist Source 上下文的 manual_download task run + download task
  -> 唯一 Download Queue Worker
  -> single-song.ts（安全规划独立托管路径并写文件）
  -> media-write.ts（一次提交 Local Media Asset）
  -> 标记所有引用该 Target Song 的来源待重新对齐
  -> 后续 Source Convergence 按精确路径建立 path Media Link
```

Managed Media Command 不执行 Plex 歌单 mutation，也不复制 Source Convergence。来源上下文贯穿 task run、下载任务和失败记录。

### 媒体接管

歌单首次同步先经过 `server/lib/source-initialization/`：串行读取网易云快照和 Plex 音乐库，写入 `source_initializations` 与分页审核项，Task Run 进入 `awaiting_action`。分析阶段不调用下载、身份写入或 Plex 变更。提交只写入人工身份和稀疏的 `defer/download` 决定；已启用来源随后通过持久 `source_sync_queue` 排队进入 Source Convergence。专辑来源直接跳过该阶段。

重新分析通过携带当前初始化 ID 的 `initialization/restart` 单请求，在同一事务中取消旧草案/Run 并保存新分析请求；排队、失败、取消后仍需通过接管闸门。提交把人工身份、稀疏决定、初始化/Run 结果和后续请求原子保存，最终事务重新检查来源启用状态，提交后才唤醒 worker。已完成方案重复提交返回保存的结果；初始化 ID 唯一关联续接请求，启动后建立双向 Run 链接。

`source-initialization/types.ts` 提供共享审核契约：保留已验证绑定的项目不可编辑，其他项目返回允许操作和限制原因。快照保存固定候选规则版本；不兼容草案仍可查看但必须重新分析后才能提交。元数据候选规则只用于首次接管且需最终确认，不参与日常自动身份判定。`useSourceInitialization` 管理分页、跨页选择、竞争响应与清理，面板拆为审核列表、证据抽屉和提交摘要。

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
- `source_sync_queue`：有界保留、可恢复的分析/同步请求，记录模式、触发原因、批次与初始化关联。
- `song_identity_bindings`：托管路径或人工接管形成的当前媒体关联。
- `local_media_assets`：本地路径、managed/external 归属、连续性和替换状态。
- `download_tasks`：可保留和恢复的媒体文件操作队列；`operation` 区分下载、替换、托管副本和 repair，`target_path` 保存可恢复操作的实际目标；它不是长期歌曲身份事实。
- `run_file_tasks`：运行与实际文件任务的关联，保留调用者的来源上下文；Run 或任务清理时级联删除，不改变文件任务的原始归属。
- `task_runs`、failure records：运行结果和可操作失败。
- `logs`：诊断记录；面向用户的执行历史统一由 `task_runs` 表达。

`server/lib/db/schema.ts` 定义全新数据库结构；`source-request-upgrade.ts` 对当前工作树的旧结构做有界、幂等补列和索引升级，保留数据、媒体、绑定、配置和历史，不恢复完整历史迁移体系。Run 查询对原生 `awaiting_action` 和旧 CHECK 约束下的初始化 `partial` 使用同一状态投影与筛选，真实部分成功保持 `partial`；结构能力缓存随数据库实例隔离。

## 系统不变量

1. Playlist Source 定义目标成员和顺序，但不能绕过删除保护。
2. Identity Binding、Local Media Asset 和 Playlist Occurrence 是三种不同事实。
3. 只有具体 Plex `playlistItemID` 可以被授权移除；同步不删除媒体文件。
4. 标题、艺人、专辑、GUID 和刮削器元数据都不能自动建立身份。
5. 下载替换先写临时文件并校验，失败保留旧媒体、旧身份和旧 Plex occurrence。
6. Plex mutation 前检查身份版本，写入后必须 read-back。
7. 配置的来源级布尔覆盖是三态值，`null` 表示继承，不能用普通 truthy 合并。
8. 外部服务、文件系统、重启和长时间运行验证必须与单元测试/构建结果分开陈述。
9. 调度器通过统一入口创建分析或同步请求；只有单消费者可以领取执行。分析不写媒体，Plex 歌单变更仍只由 Source Convergence 执行。
