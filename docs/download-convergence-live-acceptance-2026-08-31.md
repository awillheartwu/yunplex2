# 2026-08-31 下载链路与首次媒体接管真实验收

本文是当日版本的验收记录，不覆盖 2026-09-07 的入口统一与状态衔接修改。当前行为及待验收项见 [真实环境验收手册](external-acceptance.md)。

## 结论

本轮在真实网易云、真实下载目录、真实 Plex 和当前 SQLite 数据库上完成了下载链路收敛的运行时验收。全局并发、服务重启恢复、失败重试、下载并保存来源、Repair、首次媒体接管两阶段硬门，以及后续 Source Convergence 均符合设计。

- Git 基线：`e00ad2ff4e7cb4b4a7d8025cc970139c4326adf7` 加当前未提交实现。
- 验收前临时备份：系统临时目录中的 `reyunplex-pre-download-convergence-live-20260831.db`，`integrity_check=ok`，无外键错误。
- 验收结束：下载并发恢复为 `3`；无 pending/downloading/tagging 任务；无 running Run；当前数据库 `integrity_check=ok`，无外键错误。
- 3450 首生产来源 `3883b362-cb4a-45c9-9260-7abca7a049da` 全程保持 disabled，历史下载任务数保持 `3348`，未被本轮 Source Convergence 触发。

## 隔离测试对象

| 对象                 | 标识                                   | 结束状态                     |
| -------------------- | -------------------------------------- | ---------------------------- |
| 网易云小歌单         | `3151434509`，9 首                     | 仅用于隔离验收               |
| 新建同步来源         | `180f9af2-24b6-48d6-b51d-dbada4d04d22` | disabled，首次接管 completed |
| 新建 Plex 歌单       | `46213`                                | 保留作复核证据               |
| 既有 Repair 测试来源 | `9e474a5e-e02e-4cb9-bb6f-2657b7272643` | disabled                     |

测试来源和测试媒体暂不删除。媒体删除会影响实际文件，应另行确认。

## 验收结果

### 1. 进程级全局下载并发

临时将 `downloadConcurrency` 从 `3` 调为 `2`，同时提交 3 个批次、共 8 首歌：

- batch `608383f9-8cbd-4a31-a598-1afb76bfe45b`
- batch `56fb1e39-1c28-408d-9f25-4726ccb33f50`
- batch `c5a93894-b7b6-4c68-b588-f51c5786ea19`

结果：8/8 成功；观测到的最大 active 数严格为 `2`，最大 pending 数为 `6`。这些一次性下载没有来源归属、没有创建身份绑定，也没有修改 Plex 歌单。测试后并发恢复为 `3`。

### 2. 服务重启恢复

临时以并发 `2` 提交 7 首歌，并在观测到 2 active、5 pending 后终止服务：

- batch `e270444e-4b4f-4e1e-9852-4b85a47b1fb9`
- batch `a387000e-ae65-45fd-bd7d-66b41a9c4299`

服务停止时数据库包含 done、failed、pending、tagging 状态。重启后，同一组 task ID 继续收敛，没有为同一首歌复制任务：最终 6 首成功，1 首因网易云没有下载链接而失败。失败发生在重启前，不是恢复器制造的失败。

### 3. 重试策略

对失败任务 `ef2ac089-0142-4696-b6cd-acf1a098b2f8` 执行单任务重试：

- 原 task ID 被复用，`retry_count=1`。
- 再次失败原因仍为“无法获取歌曲 2643483961 的下载链接”。
- failure kind 为 `copyright_restricted`。
- failure 批量重试返回 0，并明确拒绝绕过该错误策略。

这证明单任务重试进入同一持久 Worker，而批量重试继续受统一错误策略约束。

### 4. 下载并保存为来源

从 9 首小歌单中选择 2 首尚无 Local Media Asset 的歌曲，调用组合命令：

- batch `c73dc578-a19f-452c-b542-a731428f5318`
- source `180f9af2-24b6-48d6-b51d-dbada4d04d22`

结果：

- 2/2 成功，任务均归属于新来源，operation 均为 `managed_copy`。
- 两个 Local Media Asset 均为 `managed`。
- 来源默认 disabled，曲目总数为 9。
- 创建后没有普通同步排期、没有 Plex playlist ratingKey、没有身份绑定。
- 首次媒体接管状态为 pending。

### 5. Repair 共享 Worker

对既有 2 首隔离来源执行 Repair：

- Run `fef19d88-d1d`
- 1 首进入 `repair_existing` 并成功，1 首没有可修复目标而安全跳过。
- 任务带正确 source ID，target path 已持久化，完成后租约全部释放。
- Run success，无失败、无 Plex 刷新告警。

### 6. 首次媒体接管：只读分析

对新建的 disabled 来源启动分析，约 3.2 秒进入 `awaiting_review`：

- initialization `884e7bfc-6bbf-4e79-b51b-7aba0c5e4f85`
- Run `13e1a24f-8ce`
- 分布：preserved 2、strong_id 2、high_confidence 3、possible 1、ambiguous 1、unmatched 0。

分析前后该来源下载任务数都为 2，普通同步队列都为 0，来源仍 disabled，Plex playlist ratingKey 仍为空。本次新下载的两首没有在分析阶段产生身份绑定。歌单中另有两首 7 月已存在的绑定，被正确归为 preserved。

旧数据库的 `task_runs` CHECK 约束没有 `awaiting_action`，所以磁盘兼容保存为 `partial`；`getRun()` 和 HTTP API 根据关联 initialization 正确投影为 `awaiting_action`。新建数据库原生支持该状态。

### 7. 首次媒体接管：提交方案

将 1 个 high_confidence 项改为“下载并托管”，其余保持默认后提交：

- 接管 2、计划下载 1、暂缓 4、冲突 0。
- 两个 strong_id 形成 `manual` / Explicit Adoption 绑定。
- 活跃稀疏决定为 defer 4、download 1。
- initialization 和 Run 均完成为 success。
- 因来源 disabled，提交后没有新增下载任务、没有后续同步排期、没有创建 Plex 歌单。

### 8. Source Convergence 首轮

先执行 Preview，再执行 normal：

- Preview run ID `8895e860-163`；按现有设计 Preview 不持久化 Task Run，通过 `/sync/status` 验证完成。
- Preview 后下载任务数不变，Plex playlist ratingKey 仍为空。
- normal Run `03c329d5-09e`。

normal 结果：

- 仅“下载”决定对应的歌曲 `4909215` 创建 1 个任务并由统一 Worker 完成。
- Run success：新增 1、已存在 4、需关注 4；4 个 defer 项没有下载。
- 创建隔离 Plex 歌单 `46213`。
- 来源仍 disabled；全局来源队列为空；3450 首来源任务数未变化。

### 9. Source Convergence 第二轮幂等性

再次同步同一来源：

- Run `b12b5213-ef3`。
- 0 新下载，已存在 5、需关注 4。
- 复用 Plex 歌单 `46213`。
- 一次性 download 决定在精确路径确认后解除。
- 4 个 defer 决定继续有效。
- 来源仍 disabled；大歌单未变化；全局来源队列为空。

## 本轮没有自动执行的项目

- Forgejo CI：未推送、未触发外部平台。
- 整库 Plex scraper 切换：会影响完整媒体库，不属于安全隔离测试。
- 真实破坏性取消时机：普通下载的服务重启恢复已经实测；Source Convergence 的取消边界由自动化测试覆盖，本轮没有为了制造长任务再创建额外下载。
- 最终人工视觉验收：按用户此前要求暂缓，功能 Playwright 套件已通过 7/7。

## 最终判断

统一 Download Worker 已在真实环境覆盖一次性下载、来源归属下载、Repair、失败重试和 Source Convergence。首次媒体接管的“分析零写入 → 用户提交决定 → disabled 来源不自动继续 → 普通同步统一消费”的边界成立；第二轮同步证明下载决定能够收敛并解除，而 defer 决定保持稀疏有效。
