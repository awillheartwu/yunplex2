# 2026-09-08 至 09-09 入口衔接与恢复真实验收

本轮使用真实网易云、NAS 共享目录和 Plex，应用数据放在独立 SQLite 数据库中。生产数据库只读获取连接配置；自动调度始终关闭。新媒体集中于 `reYunPlex-acceptance-20260908-current` 子目录，未对既有生产来源发起同步。

## 版本与范围

- Git 基线：`e00ad2ff4e7cb4b4a7d8025cc970139c4326adf7` 加当前工作树。
- 后端实现 SHA-256：`5eef63ba80205a9e2ea15db4f0c63a5379ad1d70ba5ef51bd59eb38925938e59`。计算方式：依次遍历 `server`、`shared`，各目录内按路径排序所有非 `.test.ts` 的 TypeScript 文件，累计 `路径 + NUL + 文件内容 + NUL`。
- 外部调用使用现役应用命令、持久消费者、文件处理及 Source Convergence。故障注入和时序控制只在临时验收进程中进行，没有写入产品代码。
- 下载消费者修复：从整批快照等待改为按全局空闲槽位补充任务，仍通过 `processAll` 执行租约、文件验证及结果持久化，未增加另一条媒体写入路径。

## 受控对象

| 对象 | 标识 | 最终状态 |
| --- | --- | --- |
| 就绪来源 | `16d15d6a-cfe1-434c-94cd-ec1915146716`；网易云 `163334910`，限制 1 首 | disabled |
| 接管来源 | `a9076ce3-23d6-4286-b8cc-1f7e423bfcf9`；网易云 `3151434509`，限制 2 首 | disabled，接管 completed |
| 就绪来源 Plex 歌单 | `46216` | 一首验收媒体，ratingKey `46219`，playlistItemID `5971` |
| 接管来源 Plex 歌单 | `46222` | 一首验收媒体，ratingKey `46221`，playlistItemID `5972` |

两个来源只存在于独立验收数据库。三首测试媒体与两个 Plex 验收歌单保留供复核；没有删除既有文件或歌单。

## 结果与证据

| 场景 | 结果 | 可复核证据 |
| --- | --- | --- |
| 混合批次先执行就绪来源，再分析接管来源 | 通过 | 批次 `cc95dde8-ebef-4511-a528-41c2f8bb42ca`；同步 Run `a8f2492b-990` 于 09:22:00.762 UTC 完成，分析请求于下一毫秒开始；分析 Run `c23e630f-46c2-404d-8c37-874139ea205f` 进入 awaiting_review，队列请求均 completed |
| 忙时拒绝不额外入队 | 通过 | 同一批次受理后再次请求，返回 busy；队列数量仍为 2 |
| 禁用来源提交不自动续接 | 通过 | 两首下载决定提交后 shouldSync=false、followUpRequestId=null；绑定数 1、文件任务数 1、来源请求数 2 均未变化，未创建该来源的 Plex 歌单 |
| 分析中强制终止并重启 | 通过 | 在 analyzing 时 SIGKILL 验收进程；新进程恢复请求 `7e400175-3309-460f-946e-514a0b9969a4`，attempts=2，仍关联 Run `315c5c88-e564-45f6-9dba-ff4daa0db3b2`；两个审核项未提交，下载数量不变 |
| 共享下载保留各调用者归属 | 通过 | 两个 Run `9ab174bc-3d75-4cfc-a52b-36501a85e00d`、`e5f3b27b-d547-471f-9e65-5f811ce4b90d` 共用 task `25bf84cd-9d78-499c-a11a-a10bd8a1f773`，两个结果均 success；文件完成投影 awaitingSourceSync=true，原验收歌单未变化 |
| 接管提交后、消费者启动前退出与恢复 | 通过 | 对新验收路径显式接管 1 首、暂缓 1 首；重复提交得到同一结果及请求 `283add5a-4c12-4d9f-acda-5c4ef460632a`；新进程执行 Run `e4c86b3c-c89`，双向 Run 关联各一条、绑定仍为 2 个；Plex 读回仅含 ratingKey `46221` |
| Repair 文件完成、Plex 刷新前崩溃 | 通过 | Run `79a328b9-953` 的 task `b540cfd7-9d87-43fa-9d50-6e5450752536` 已 done 时，在刷新调用边界 SIGKILL；新进程通过现役启动恢复逻辑补发真实 `/library/sections/12/refresh` 并收到成功响应，Run success、warnings=0，任务 ID 不变、租约清空，歌单成员不变 |
| Repair 不等待无关下载 | 修复后通过 | 向另一首验收歌曲的音频网络请求注入受控延迟。修复前 Repair 被旧批次阻挡；修复后 Run `facad81c-f20` 成功时，无关 task `2d6e76f9-c5f4-498f-8ea9-153e0a6cdc2a` 仍 downloading。释放延迟后，该真实下载也完成 |
| 单曲失败重试与显式同步边界 | 通过 | 注入一次文件处理失败，原文件 SHA-256 与身份绑定均不变；task `2b8ca8d2-5955-45a9-b8ee-a94c5108a198` 由真实消费者重试后 done、retryCount=1、awaitingSourceSync=true；Plex occurrence 未变化。随后显式同步 Run `1250c078-bb8` 完成，读回正确且待同步标记清除 |

## 最终状态

最终只读审计时间为 2026-09-09 00:18:22（Asia/Shanghai）：

- pending/downloading/tagging 文件任务：0；pending/running 来源请求：0；running Run：0。
- 两个验收来源均 disabled；所有已记录的测试文件路径均位于新验收子目录，共 3 个文件。
- SQLite `integrity_check=ok`，`foreign_key_check` 无错误。
- 两个新 Plex 歌单均完成实际读回，曲目 ratingKey 与预期一致。

这份报告覆盖当前入口统一、请求持久化、共享下载及恢复行为。长期 NAS soak、整库 scraper 切换、Forgejo 平台验收和整库批量接管不在本轮范围内，仍按各自里程碑处理；历史报告不替代本报告的当前版本证据。
