# 同步比较决策

## 是否进入比较

同步先获取网易云目标快照和 Plex 观察快照，再由 `detectChanges` 决定：

- `normal`：来源和 Plex 均无变化时跳过；达到跳过次数或时间上限后自动全量比较。
- `preview`：始终比较，但不产生副作用。
- `full`：忽略增量跳过条件，执行完整比较。
- `rebuild_matching`：先失效非人工绑定，再执行完整比较。
- `redownload_managed`：执行完整比较，并仅重建 YunPlex 管理的媒体。

Plex 指纹变化会触发完整对齐，避免网易云未变时忽略用户在 Plex 中造成的漂移。

快速跳过前会执行轻量资产体检。所有资产健康时继续跳过；发现未登记、缺失或 replaced
资产时进入完整处理。`redownload_managed` 使用独立替换策略。

## 纯重排

只有以下条件全部满足才走纯重排快速路径：

1. 网易云成员集合未变，仅顺序变化。
2. 每首歌曲都有 active 正式身份绑定。
3. 每个 rating key 仍存在。
4. Plex 媒体路径仍与绑定路径一致。

任何验证失败都回退到完整解析，不使用元数据缓存猜测身份。

## 结果分类

- `matched_plex_playlist`：强身份已经在目标歌单中。
- `found_in_plex_library`：强身份存在于 Plex 库，等待加入歌单。
- `found_on_disk`：正式本地媒体存在，等待 Plex 索引。
- `needs_download`：没有可验证的托管路径或明确接管，需要建立托管副本。
- `unavailable`：同一托管路径对应多个 Plex 身份，必须先清理冲突。
- `copyright_restricted`：网易云明确不可下载。
- `ignored_failure`：达到下载失败暂停阈值。

身份冲突与下载失败都属于目标未收敛状态，不能授权删除 Plex 旧条目。
