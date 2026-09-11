# 2026-08-29 真实环境验收结果

本文是当日版本的验收记录，不覆盖后续首次媒体接管、下载消费者和来源入口改动。当前行为及待验收项见 [真实环境验收手册](external-acceptance.md)。

## 结论

除 Forgejo CI 平台检查、真实切换整个 Plex 音乐库 scraper，以及同一路径重复
ratingKey 冲突外，本轮可安全自动执行的真实环境验收均已通过。

- Git revision：`e00ad2ff4e7cb4b4a7d8025cc970139c4326adf7`
- 数据库备份：`data/backups/pre-live-acceptance-20260829.db`
- 验收结束状态：同步服务 idle；SQLite `integrity_check=ok`，无外键错误。
- 原配置已恢复：自动同步 enabled，未验证媒体策略 `download_managed`；所有生产来源
  的 enabled、sync interval 和 next sync 状态按验收前快照恢复。

## 隔离测试对象

为保留复核证据，以下对象暂未删除，且两个 YunPlex 来源均为 disabled：

| 对象                       | 标识                                                  |
| -------------------------- | ----------------------------------------------------- |
| YunPlex 测试源             | `9e474a5e-e02e-4cb9-bb6f-2657b7272643`                |
| Plex 测试歌单              | `YunPlex Live Acceptance 2026-08-29` / `46136`        |
| YunPlex wait_manual 测试源 | `c00556ff-3a0e-4118-b66c-9d7e176d28e5`                |
| Plex wait_manual 测试歌单  | `YunPlex Wait Manual Acceptance 2026-08-29` / `46141` |

## 验收结果

| 场景                        | 结果             | 真实证据                                                                                                                                                       |
| --------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次托管同步                | 通过             | Run `7b4e62e7-784`：2/2 success；建立 ratingKey `46139`、`46140`                                                                                               |
| 精确路径复用                | 通过             | Run `62cf40eb-22a`：已存在 2 首；下载任务数仍各 1 条；playlistItemID `5962`、`5963` 未变化                                                                     |
| scraper 元数据独立性        | 通过（安全等价） | Plex 标题临时改为 `SCRAPER RENAMED 30903876`；Run `04d769db-780` 仍为已存在 2 首，ratingKey、路径和 occurrence 不变；原标题已恢复并解锁                        |
| wait_manual                 | 通过             | Run `f8e3a56e-b12`：歌曲 `423227295` 为 `awaiting_manual_match`，没有下载任务                                                                                  |
| 下载并托管                  | 通过             | batch `aa712925-cc76-4981-b93f-6efdf9e65645`；`managed_copy` done；Local Media Asset 为 managed；Run `8b36293b-4f8` 按路径绑定到 ratingKey `46143`             |
| Explicit Adoption           | 通过             | 歌曲 `30903876` 显式接管自己的 Plex 媒体；Run `b0bb1a2f-bd2` 后 bindingMethod 仍为 manual，playlistItemID 不变                                                 |
| 展示标题变化后同步          | 通过             | Run `04d769db-780`：已存在 2 首，不依赖 Plex 标题匹配                                                                                                          |
| manual binding 失效回退     | 通过             | 删除测试 ratingKey 后 Run `a1801289-cb0` 进入 `binding stale + wait_manual`，未猜测媒体、未误删其他 occurrence                                                 |
| ratingKey 变化恢复          | 通过             | 测试 track 从 `46139` 重新索引为 `46146`；Run `43432e40-3f6` 按唯一精确路径恢复，bindingMethod 保持 manual；新 playlistItemID `5965`                           |
| Media Repair 正常完成       | 通过             | Repair Run `c7bc771b-a1b`：2/2 success；任务均为 `repair_existing`，持久化 target_path，Plex refresh 无告警                                                    |
| Media Repair 重启恢复       | 通过             | 对同一隔离任务注入 `tagging/90%` 后重启；启动恢复器重新执行为 done/100%，lease 清空，Run 恢复 success；Plex occurrence 未改变                                  |
| 自动调度连续两轮            | 通过             | 第一轮 `b5207bd6-f5d` → `2e24d28d-414`；第二轮 `9765bff0-cdc` → `e4647db9-614`；每轮严格串行，均 success；两次诊断均 healthy、零违规                           |
| Docker build/runtime/health | 通过（修复后）   | 首次容器暴露 better-sqlite3 binding 缺失；加入 pnpm trusted native builds 与 build-stage 编译链后，Node `v24.20.0`，容器 `running healthy`，health API 返回 ok |
| SQLite/NAS 写入             | 通过             | 在线备份校验 ok；三首隔离媒体完成真实写入、标签、Plex 扫描与路径绑定                                                                                           |

## 3464 首生产歌单回归

网易云歌单 `49061121` 首次自动同步在 `fetching_playlist` 阶段失败。真实响应中有
10 首歌曲的 artist/album 名称为 `null`，旧代码在艺人别名规范化时直接调用
`.trim()`。修复后，这些歌曲仍保留在权威 trackId 集合中，但不进入下载和路径生成，
由现有缺失详情机制提供删除保护。

- 原失败 Run：`6c814d08-c52`
- 回归 Preview：读取 3464 个 trackId，记录 10 首缺少详情，未创建下载或 Plex mutation。
- 生产 Run：`c98c9c71-789`
- 初始持久化：3464 条 occurrence，其中 10 条 `metadata_complete=0`。
- 下载队列：3348 条任务；观察窗口内始终 3 条 downloading，其余 pending/done，符合并发 3。
- 数据库备份：`data/backups/pre-large-playlist-production-retry-20260829.db`
- 来源在初次全量完成前保持 disabled，避免失败或重启时被自动重复调度；手动 Run 不受影响。

## 未执行项

### 整库 scraper 切换

当前 Plex 音乐库约 4382 首。切换 metadata agent 并刷新整个库会影响全部生产媒体，
本轮没有自动执行。已通过只修改一个隔离 track 展示标题的安全等价测试证明身份解析不依赖
标题、艺人或专辑字段。

### 同一路径重复 ratingKey

当前单一 Plex 音乐库无法安全制造两个 ratingKey 指向完全相同的文件路径。该分支由
`pnpm acceptance:media-reuse` 的受控替身测试覆盖，真实环境记录为“无法安全构造”。

### Forgejo CI

用户明确要求本轮不操作 CI 平台，因此未推送分支、未触发 Forgejo Actions、未修改分支保护。

## Docker 运行时缺陷与修复

首次镜像能够构建，但容器启动时报错：pnpm 10 阻止了 `better-sqlite3` 原生安装脚本，
导致 Nitro runtime 找不到 `better_sqlite3.node`。已在 `package.json` 声明可信原生依赖，
并仅在 Docker build stage 安装 Python、make、g++；runtime stage 仍只复制 `.output`。

修复后重新从干净镜像构建并启动隔离容器，HEALTHCHECK 与 HTTP health API 均通过。

## 清理说明

- 临时 Docker 容器和本地验收镜像已删除，可重新构建。
- 临时认证会话每次 API 调用后立即撤销。
- 两个 YunPlex 测试源、两个 Plex 测试歌单和三首测试媒体暂时保留作为证据，且来源均 disabled。
- 如需清理，应先删除测试 Plex 歌单，再删除测试来源；测试媒体删除需单独确认，因为 Plex
  删除媒体接口会同时删除实际文件。
