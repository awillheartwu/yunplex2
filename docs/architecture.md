# 代码结构

reYunPlex 是 Nuxt 4 网页应用，后端使用 Nitro 和 SQLite。一个进程负责 API、自动调度和后台任务。

```text
页面 → composables/useApi.ts → server/api/ → 业务模块 → SQLite / 网易云 / Plex
页面 ← composables/sse.ts ← /api/sync/events ← 后台任务进度
```

## 文件放在哪里

| 目录                                 | 内容                                 |
| ------------------------------------ | ------------------------------------ |
| `pages/`、`components/`              | 页面入口和 Vue 组件                  |
| `composables/`、`lib/`               | 前端请求、状态与展示工具             |
| `shared/`                            | 前后端共用的类型和规则               |
| `server/api/`                        | 读取请求参数、调用业务模块、返回结果 |
| `server/lib/config/`                 | 默认配置、校验和保存                 |
| `server/lib/playlist/`               | 收藏的歌单和专辑                     |
| `server/lib/source-initialization/`  | 首次接管分析、候选选择和确认         |
| `server/lib/sync/`                   | 来源调度、媒体关联和 Plex 歌单同步   |
| `server/lib/download/`               | 文件任务、并发下载和标签修复         |
| `server/lib/run/`、`server/lib/log/` | 运行记录和诊断日志                   |
| `server/lib/db/`                     | 数据库结构与读写入口                 |
| `assets/css/`                        | 基础样式、共享控件和页面样式         |
| `tests/`                             | 单元、集成、浏览器测试及测试工具     |
| `scripts/`、`deploy/`                | 开发检查、诊断、备份和部署工具       |

Nuxt 自动导入 Vue API、组件和 composable。浏览器共享一个 SSE 连接，页面离开时释放订阅；连接恢复后重新读取当前状态。

## 一次同步怎样执行

手动、批量、重试和定时同步共用以下流程：

```text
sync/source-requests.ts 接受请求
  → sync/request-store.ts 保存请求
  → sync/worker.ts 依次执行
  → 需要首次接管时，调用 source-initialization/service.ts 分析并等你确认
  → 可以同步时，调用 sync/service.ts
      → 获取网易云歌曲与顺序
      → lookup.ts 查已有媒体，source-downloads.ts 安排缺失文件
      → source-plex-reconciliation.ts 更新 Plex 歌单并重新读取结果
      → source-finalization.ts 保存结果
```

同步请求串行执行，下载任务按全局并发数执行。`source-schedule-store.ts` 计算来源下次运行时间，并处理请求领取和重启恢复。API 只调用这套流程。

首次接管分析不会下载歌曲或修改 Plex；确认方案后，启用中的来源排队继续同步。具体操作见[首次接管](initialization-matching.md)。

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

## 数据分别记什么

来源是一份收藏的网易云歌单或专辑；媒体关联记录某首网易云歌曲使用哪个 Plex 媒体；Plex 歌单条目则是这份媒体在歌单中的一次出现。同一歌曲可以在一个歌单中出现多次。

| 表                                     | 保存的内容                     |
| -------------------------------------- | ------------------------------ |
| `playlist_sources` 及歌曲条目表        | 来源设置、歌曲快照和顺序       |
| `source_sync_queue`                    | 等待或正在执行的分析与同步请求 |
| `song_identity_bindings`               | 当前歌曲与 Plex 媒体的关联     |
| `local_media_assets`                   | 本地文件路径、归属与状态       |
| `download_tasks`、`run_file_tasks`     | 文件任务及哪些运行使用了它     |
| `source_initializations` 及其条目表    | 首次接管方案和你的选择         |
| `task_runs`、`failure_records`、`logs` | 运行结果、待处理异常和日志     |

数据库是 `<dataDir>/data.db`，默认放在项目 `data/`。`schema.ts` 定义结构，`initDb()` 负责打开并初始化。配置、凭据和运行数据留在数据目录，不放进版本库。

媒体关联由手动选择或唯一的托管文件准确路径确认。标题、艺人和专辑相似只用于候选推荐。同步删除针对具体 `playlistItemID`；执行前核对当前关联，写 Plex 后重新读取成员与顺序。

## API 与错误

成功响应由 `server/lib/response.ts` 返回 `{ code: 0, msg: "ok", data }`。失败响应包含用户说明和错误码、类别、严重度、可重试标记；对应定义在 `shared/domain-errors.ts`。页面、队列和日志共用这份定义，诊断信息在进入日志和响应前脱敏。

配置保存经过校验再合并。来源设置中的 `null` 表示继承全局值，`true` 和 `false` 都是明确选择。
