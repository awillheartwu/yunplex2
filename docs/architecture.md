# 代码结构

YunPlex 是 Nuxt 4 网页应用，后端使用 Nitro 和 SQLite。一个应用进程负责 API、自动调度和后台任务，标签写入使用进程内的 Worker 线程。

## 项目范围与运行边界

项目持续维护，目前处于首版发布准备阶段。当前工程基线对应以下实际需求：

| 维度       | 当前约束                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------ |
| 使用与责任 | 自托管实例读取网易云账号数据，写入音乐文件和 Plex 歌单；人工媒体选择、配置与凭据需要保留。 |
| 运行       | 单机常驻，每个实例独立运行。来源请求串行执行，文件下载使用全局并发上限。                   |
| 数据       | SQLite 保存配置、关联和任务，音乐文件单独保存；数据目录与音乐都需备份。                    |
| 协作与交付 | 在 `dev` 开发和验收；`main` 推送会触发 NAS 部署。正式镜像分发复用已验收产物。              |

每个实例使用独立数据目录，同一 Plex 歌单只由一个实例管理。当前进程与 SQLite 内的持久队列满足这套运行方式；运行方式变化时再评估组件边界。部署和恢复见[运维手册](operations.md)，未完成的验收与功能见[待办](../ROADMAP.md)。

## 请求与事件

```text
页面 → composables/useApi.ts → server/api/ → 业务模块 → SQLite / 网易云 / Plex
页面 ← composables/sse.ts ← /api/sync/events ← 后台任务进度
同步扫描核对 ← plex-scan-events.ts ← plex-notifications.ts ← Plex SSE
页面提示、缓存失效 ← plex-library-monitor.ts ← 同一 Plex SSE 连接及定时核对
```

## 文件放在哪里

| 目录                                             | 内容                                   |
| ------------------------------------------------ | -------------------------------------- |
| `pages/`、`components/`                          | 页面入口和 Vue 组件                    |
| `composables/`、`lib/`                           | 前端请求、状态与展示工具               |
| `shared/`                                        | 前后端共用的类型和规则                 |
| `server/api/`                                    | 读取请求参数、调用业务模块、返回结果   |
| `server/lib/config/`                             | 默认配置、校验和保存                   |
| `server/lib/auth/`、`server/middleware/`         | 管理员会话、请求鉴权和来源校验         |
| `server/lib/playlist/`                           | 收藏的歌单和专辑                       |
| `server/lib/source-initialization/`              | 首次接管分析、候选选择和确认           |
| `server/lib/sync/`                               | 来源调度、媒体关联和 Plex 歌单同步     |
| `server/lib/download/`                           | 文件任务、并发下载和标签修复           |
| `server/lib/run/`、`server/lib/log/`             | 运行记录和诊断日志                     |
| `server/lib/tasks/`                              | 当前问题、完成证据、批量处理与重试路由 |
| `server/lib/db.ts`、`server/lib/db/`             | 数据库连接、结构与初始化               |
| `server/lib/runtime/`、`server/lib/maintenance/` | 就绪状态与运行数据保留策略             |
| `assets/css/`                                    | 基础样式、共享控件和页面样式           |
| `tests/`                                         | 单元、集成、浏览器测试及测试工具       |
| `scripts/`、`deploy/`                            | 开发检查、诊断、备份和部署工具         |

Nuxt 自动导入 Vue API、组件和 composable。浏览器共享一个 SSE 连接，页面离开时释放订阅；连接恢复后重新读取当前状态。

`server/lib/plex-notifications.ts` 管理 Plex 事件连接、解析与重连；`plex-scan-events.ts` 关联单次扫描，`plex-library-monitor.ts` 负责缓存失效和歌单变化提示。失败处理由持久来源请求、文件恢复安排或异常记录中的手动重试驱动，歌单写入仍由来源队列调用 `sync/service.ts` 完成。具体完成条件见[同步流程](sync-flow.md#plex-完成条件)。

## 一次同步怎样执行

手动、批量、重试和定时同步共用以下流程：

```text
sync/source-requests.ts 接受请求
  → sync/request-store.ts 保存请求
  → sync/worker.ts 依次执行
  → 需要首次接管时，调用 source-initialization/service.ts 分析并安排歌曲
  → 可以同步时，sync/service.ts 创建运行并串行调用 source-convergence.ts
      → 获取并观察网易云、Plex 的状态，判定是否需要继续
      → lookup.ts 查已有媒体
      → source-downloads.ts 返回下载后的解析结果及刷新需求
      → source-plex-reconciliation.ts 消费下载输出，更新 Plex 并读回
      → source-finalization.ts 核对检查点并保存来源结果
```

`service.ts` 管理运行生命周期、来源选择与串行循环、取消和关闭、全局状态与 SSE、总体汇总。`source-convergence.ts` 负责单个来源的观察、判定、比较、下载、Plex 协调和来源级异常，只通过阶段、失败和日志回调报告进度，不读写服务层状态。

单来源返回未变化、延后、完成或失败的明确结果。下载与 Plex 阶段接收只读解析条目，在入口浅复制实际会修改的条目，歌曲和未修改的元数据保持共享；下载返回的新解析结果显式交给 Plex。Plex 是终端阶段，返回检查点而不重复暴露无人消费的数据。`RunBuilder` 仍是各阶段明确共享的进度和运行结果记录。

同步请求串行执行，下载任务按全局并发数执行。`source-schedule-store.ts` 计算来源下次运行时间，并处理请求领取和重启恢复。`shared/error-recovery.ts` 统一决定恢复动作和退避间隔，`sync/recovery.ts` 安排来源后续请求，`download/recovery.ts` 恢复到期的独立文件任务。异常记录不会因次数耗尽而自动忽略；实际操作模块凭完成证据解决问题。API 只调用这套流程。

`lookup.ts` 在内存中核对候选、重复身份和本地文件观测；`lookup-identity.ts` 在身份锁内检查原绑定版本及文件记录，再统一提交接受的结果。查询和批量验证的 Plex 网络读取都在锁与数据库事务外进行，旧观测不能覆盖期间完成的下载或人工选择。

`effective-settings.ts` 按来源实际生效值识别需要重新核对的配置变化；`source-checkpoint.ts` 保存本轮写入边界确认的绑定版本、实际 Plex 编号和文件快照。完整协调和纯换序共用 `source-finalization.ts` 收尾，最后一次网络等待后核对快照，再同步保存结果与对齐证据。媒体验证可以记录成员情况或要求重新对齐，来源待协调标记只由完整执行同步后的收尾清除。

错误处理按下表分工。执行模块报告实际失败或完成事实，恢复模块安排后续动作，页面读取当前投影。

| 模块                                                                 | 职责                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `domain-error.ts`、`error-signals.ts`、`shared/domain-errors.ts`     | 识别错误原因、保留外部上下文并提供脱敏说明                   |
| `shared/error-recovery.ts`                                           | 唯一的自动恢复动作、快速退避和长期冷却规则                   |
| `tasks/failure-records.ts`、`failure-queries.ts`、`failure-model.ts` | 异常写入与去重、状态操作、读取与展示投影；不启动任务         |
| `tasks/recovery-targets.ts`、`sync/failure-policy.ts`                | 来源、成员、原文件和调用方资格，以及来源和删除问题的暂缓判断 |
| `tasks/completion.ts`、`completion-evidence.ts`                      | 文件、歌曲详情、当前身份、歌单读回及指定条目删除的完成确认   |

手动、自动和环境恢复共用目标资格事实，并显式区分触发权限。`sync/request-store.ts` 管理恢复请求的去重、替代及持久标记，环境恢复只协调检查和所属模块的命令；网络检查在事务外执行，状态与排队提交后再唤醒 worker。`run/failure-recording.ts` 归集运行失败，`run/recovery.ts` 协调启动恢复，运行存储不反向调用文件队列。

首次接管分析不会下载歌曲或修改 Plex；自动模式分析后排队应用，审批模式等用户提交。两种模式均由来源队列应用安排并接续同步，暂停自动同步的收藏也能执行这一次手动请求。具体操作见[首次接管](initialization-matching.md)。

## 文件怎样保存

手动下载、同步下载、重下和标签修复共用一个文件队列：

```text
download/file-task-command.ts 保存文件任务
  → download/worker.ts 领取任务
  → download/single-song.ts 下载或修复
  → tag-writer.ts 写标签与辅助文件
  → download/media-write.ts 保存文件记录和任务结果
```

`download/options.ts` 组装单曲配置。多个来源需要同一文件时共用任务，各自记录结果。替换先在临时文件上完成校验，再切换到正式路径；失败保留原文件。修复标签和词图可以刷新 Plex 媒体库，不直接修改歌单。

完整音频先保存在数据目录的 `download-cache/`，标签处理使用工作副本。FLAC 与 MP3 在 Worker 内写入并回读核验，通过后发布目标文件并记录结果；重试可以复用已下载的音频。格式和重试规则见[同步与下载](sync-flow.md#下载队列)。

## 数据分别记什么

来源是一份收藏的网易云歌单或专辑；媒体关联记录某首网易云歌曲使用哪个 Plex 媒体；Plex 歌单条目则是这份媒体在歌单中的一次出现。同一歌曲可以在一个歌单中出现多次。

| 表                                                                               | 保存的内容                             |
| -------------------------------------------------------------------------------- | -------------------------------------- |
| `config`、`app_state`、`auth_admin`、`auth_sessions`                             | 配置、初始化状态、管理员密码哈希与会话 |
| `playlist_sources` 及歌曲条目表                                                  | 来源设置、歌曲快照和顺序               |
| `netease_song_details`                                                           | 网易云歌曲详情原文，按歌曲 ID 复用     |
| `source_sync_queue`                                                              | 等待或正在执行的分析与同步请求         |
| `song_identity_bindings`                                                         | 当前歌曲与 Plex 媒体的关联             |
| `local_media_assets`                                                             | 本地文件路径、归属与状态               |
| `download_tasks`、`run_file_tasks`                                               | 文件任务及哪些运行使用了它             |
| `source_initializations` 及其条目表                                              | 首次接管方案和你的选择                 |
| `initialization_quick_operations`、`source_media_decisions`、`media_corrections` | 快速方案、来源歌曲安排和媒体纠错       |
| `task_runs`、`failure_records`、`logs`                                           | 运行结果、待处理异常和日志             |

数据库是 `<dataDir>/data.db`，默认放在项目 `data/`，使用 WAL 和外键。`db.ts::initDb()` 打开并初始化数据库；`db/schema.ts` 是结构入口，文件队列和快速方案分别使用 `db/file-task-schema.ts`、`db/quick-initialization-schema.ts`。配置、凭据和运行数据留在数据目录，不放进版本库。

业务配置保存在 SQLite。`db/config-seed.ts` 只在配置表为空时从环境变量或 `seed.json` 导入初值，之后修改业务配置应使用网页。`NUXT_DATA_DIR`、监听地址和可信代理等运行参数仍由进程环境决定，具体见[配置与访问](operations.md#配置与访问)。

日常同步由手动选择或唯一的托管文件准确路径确认媒体关联。首次准备可按用户选择的自动方案采用评分候选，应用时仍检查身份版本、共享归属和具体路径。同步删除针对具体 `playlistItemID`；执行前核对当前关联，写 Plex 后重新读取成员与顺序。

## 启动、恢复与关闭

`server/plugins/sync-daemon.ts` 统一初始化数据库、恢复来源和运行记录、启动来源与下载 worker，并接续已请求的首次接管步骤。执行中断与待执行任务的处理规则见[同步与下载](sync-flow.md#下载队列)。

`maintenance/data-lifecycle.ts` 在启动时和此后每六小时执行保留策略，清理过期日志、历史明细、已解决异常与无用音频缓存。人工媒体关联和本地文件归属独立保存，历史任务清理不会抹去这些记录。关闭时先标记停止状态，释放 SSE、监听器与计时器，再等待后台消费者结束。

## API、鉴权与错误

`server/middleware/auth.ts` 检查管理员会话和初始化状态，写请求校验同源与 CSRF。`401` 表示需要登录，`428` 表示需要完成初始化；`composables/useApi.ts` 处理状态刷新和页面跳转。普通写请求不会因等待超时自动重发。

业务成功响应由 `server/lib/response.ts` 返回 `{ code: 0, msg: "ok", data }`。业务失败响应包含用户说明和错误码、类别、严重度；对应定义在 `shared/domain-errors.ts`。响应中保留的 `retryable` 是原 API 的提示，异常列表中的同名字段表示是否有可手动重试的目标，两者都不决定自动执行；自动动作只由 `shared/error-recovery.ts` 计算。诊断信息在进入日志和响应前脱敏。认证中间件等入口也可能直接返回 HTTP 错误，调用方应同时处理 HTTP 状态与业务 `code`。

诊断日志直接读取恢复策略，区分按规则自动重试、等待环境修复和等待人工处理；不使用响应中的兼容提示推断自动恢复。

配置保存经过校验再合并。来源设置中的 `null` 表示继承全局值，`true` 和 `false` 都是明确选择。
