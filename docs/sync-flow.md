# 同步与身份匹配流程

本文档描述当前实现。歌曲身份只有两个正式事实源：

- `song_identity_bindings`：网易云歌曲到 Plex 媒体的持久身份。
- `local_media_assets`：本地媒体路径、来源和归属。

`song_lookup` 已退役。标题、艺人、专辑、音轨号和时长是候选证据，不单独建立身份。

## 进入同步

所有入口最终调用同一个同步服务，并显式传递 `mode`：

| 入口 | 模式 |
|---|---|
| 定时任务 | `normal` |
| 手动普通同步 | `normal` |
| 预览 | `preview` |
| 手动全量、失败重试、首次同步 | `full` |
| 重新评估自动匹配 | `rebuild_matching` |
| 重新下载 YunPlex 托管媒体 | `redownload_managed` |

`preview` 不写数据库业务状态、不下载文件、不修改 Plex。全局触发接口只接受
`normal`、`preview`、`full`；其余模式必须指定单个来源。

## 来源设置

`forceFullCompare`、`downloadWhenMediaMissing`、`skipPlexPlaylist`、
`skipRemoveExtraTracks` 是三态设置：

- `null`：继承全局设置。
- `true`：来源显式开启。
- `false`：来源显式关闭。

运行时统一通过 `resolveEffectiveSourceSyncSettings` 计算，不允许调用方自行使用
`||` 或 `??` 拼接。

## 匹配顺序

当“缺少已登记媒体时自动下载”开启时，先执行媒体策略：

1. active 人工绑定直接豁免。
2. active 且文件可验证的 managed/external 资产继续复用。
3. 可验证的历史下载或当前命名路径文件先登记再复用。
4. missing、replaced、无效或不存在的资产直接下载。
5. 下载后只使用精确文件路径等待 Plex 索引并建立绑定。

这条路径在自动绑定、provider GUID、MusicBrainz 和元数据候选之前短路。旧自动绑定在
新路径成功前仍保留，下载失败不会造成身份丢失。设置关闭时使用下面的完整匹配顺序。

1. 验证人工绑定。人工决定始终优先。
2. 验证现有自动绑定对应的 Plex 文件路径。
3. 查找唯一的 YunPlex 托管媒体路径。
4. 检查 Plex/网易云 provider GUID。
5. 对仍未决的候选按需查询 MusicBrainz recording。
6. 将元数据候选写入审核队列。
7. 检查正式本地媒体资产；不存在时进入下载。

普通同步快速跳过前会对当前来源执行轻量资产体检，只检查记录、文件类型、大小和修改时间；
发现 missing/replaced 后才进入完整处理。音频文件头校验只在完整处理阶段执行。

preview 使用同一规划器，但只报告“将登记”“将下载”等结果，不修复资产记录、不创建任务、
不扫描 Plex。

自动绑定只允许以下强证据：

- 唯一且可读回的托管文件路径。
- 精确 provider GUID。
- 两侧唯一且相同的 MusicBrainz recording。
- 人工确认。

MusicBrainz 使用持久缓存、并发请求合并、请求超时和熔断。超时只会降低自动确认能力，
不会让整轮同步失败。

## 保守标题规则

- 标点、空格和简繁差异可以归一化。
- `Part 1`、`Part 2` 等非版本括号内容保留为标题身份。
- `Live`、`Remix`、`Cover`、`Acoustic`、`Instrumental`、`Remaster` 等版本描述集合必须完全一致。
- 禁止用双向子串包含建立身份。
- 多个同强度候选不会采用 Plex 返回的第一项，而是进入人工审核。

## 重新评估自动匹配

`rebuild_matching` 在解析前：

1. 获取当前来源同步范围内的歌曲 ID。
2. 保留 `manual` 绑定和人工拒绝记录。
3. 将其他 active 绑定置为 `stale` 并写入身份审计事件。
4. 强制执行完整比较，按当前规则重新建立身份或创建审核项。

## Plex 权威镜像与删除保护

来源决定 Plex 目标歌单的成员和顺序，但删除额外项必须同时满足：

- 本轮网易云目标完整，没有缺失歌曲详情。
- 额外 Plex 项不存在待审核、身份冲突或未决候选。
- 项目达到配置要求的连续观察次数。
- 身份版本在计划和提交之间没有变化。
- Plex 写入后读回结果与目标一致。

任一条件不满足时只记录保护原因，不删除 Plex 条目或媒体文件。
