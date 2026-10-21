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

| 目录                                             | 内容                                 |
| ------------------------------------------------ | ------------------------------------ |
| `pages/`、`components/`                          | 页面入口和 Vue 组件                  |
| `composables/`、`lib/`                           | 前端请求、状态与展示工具             |
| `shared/`                                        | 前后端共用的类型和规则               |
| `server/api/`                                    | 读取请求参数、调用业务模块、返回结果 |
| `server/lib/config/`                             | 默认配置、校验和保存                 |
| `server/lib/auth/`、`server/middleware/`         | 管理员会话、请求鉴权和来源校验       |
| `server/lib/playlist/`                           | 收藏的歌单和专辑                     |
| `server/lib/source-initialization/`              | 首次接管分析、候选选择和确认         |
| `server/lib/sync/`                               | 来源调度、媒体关联和 Plex 歌单同步   |
| `server/lib/download/`                           | 文件任务、并发下载和标签修复         |
| `server/lib/run/`、`server/lib/log/`             | 运行记录和诊断日志                   |
| `server/lib/tasks/`                              | 异常记录、批量处理与重试路由         |
| `server/lib/db.ts`、`server/lib/db/`             | 数据库连接、结构与初始化             |
| `server/lib/runtime/`、`server/lib/maintenance/` | 就绪状态与运行数据保留策略           |
| `assets/css/`                                    | 基础样式、共享控件和页面样式         |
| `tests/`                                         | 单元、集成、浏览器测试及测试工具     |
| `scripts/`、`deploy/`                            | 开发检查、诊断、备份和部署工具       |

Nuxt 自动导入 Vue API、组件和 composable。浏览器共享一个 SSE 连接，页面离开时释放订阅；连接恢复后重新读取当前状态。

`server/lib/plex-notifications.ts` 管理 Plex 事件连接、解析与重连；`plex-scan-events.ts` 关联单次扫描，`plex-library-monitor.ts` 负责缓存失效和歌单变化提示。失败处理由下一次来源同步或异常记录中的手动重试驱动，歌单写入仍由来源队列调用 `sync/service.ts` 完成。具体完成条件见[同步流程](sync-flow.md#plex-完成条件)。

## 一次同步怎样执行

手动、批量、重试和定时同步共用以下流程：

```text
sync/source-requests.ts 接受请求
  → sync/request-store.ts 保存请求
  → sync/worker.ts 依次执行
  → 需要首次接管时，调用 source-initialization/service.ts 分析并安排歌曲
  → 可以同步时，调用 sync/service.ts
      → 获取网易云歌曲与顺序
      → lookup.ts 查已有媒体，source-downloads.ts 安排缺失文件
      → source-plex-reconciliation.ts 更新 Plex 歌单并重新读取结果
      → source-finalization.ts 保存结果
```

同步请求串行执行，下载任务按全局并发数执行。`source-schedule-store.ts` 计算来源下次运行时间，并处理请求领取和重启恢复。API 只调用这套流程。

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

业务成功响应由 `server/lib/response.ts` 返回 `{ code: 0, msg: "ok", data }`。业务失败响应包含用户说明和错误码、类别、严重度、可重试标记；对应定义在 `shared/domain-errors.ts`。页面、队列和日志共用这份定义，诊断信息在进入日志和响应前脱敏。认证中间件等入口也可能直接返回 HTTP 错误，调用方应同时处理 HTTP 状态与业务 `code`。

配置保存经过校验再合并。来源设置中的 `null` 表示继承全局值，`true` 和 `false` 都是明确选择。
