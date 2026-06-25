# 同步流程与缓存重建

本文档描述当前实际实现的同步主链路、对比决策、`song_lookup` 生命周期，以及 Docker 场景下的 Plex 路径替换规则。

## 核心原则

- 同步是否触发，只看网易云 `trackUpdateTime`
- Plex 只作为对齐目标，不参与“是否跳过同步”的判断
- 只有纯重排允许快捷路径
- 纯重排必须依赖完整可信的 `song_lookup.plex_rating_key`
- `song_lookup.file_path` 只保存 YunPlex 当前可访问的本地路径
- “重建匹配并同步”只清当前 source 本次同步范围内的 `song_lookup`

## 整体流程图

```mermaid
flowchart TD
  A["触发同步<br/>全局 / 单源 / 定时"] --> B["runSync()"]
  B --> C{"已有同步运行中?"}
  C -- 是 --> X["拒绝并发"]
  C -- 否 --> D["读取配置<br/>清理旧 task_runs / download_tasks<br/>配置 artist resolver"]

  D --> E["遍历 sources<br/>enabled 或指定 sourceId"]
  E --> F["Step 1 拉网易云歌曲<br/>playlist/detail 或 album songs"]
  F --> G["detectChanges()"]

  G --> H{"skipEntirely?"}
  H -- 是 --> H1["更新 source<br/>lastSyncedAt<br/>lastTrackUpdateTime<br/>consecutiveSkips+1"]
  H1 --> E

  H -- 否 --> I{"rebuildMatch?"}
  I -- 是 --> I1["删除当前 source 本次 songIds 对应的 song_lookup"]
  I1 --> K["进入 full compare"]
  I -- 否 --> J{"纯重排且非 forceFull?"}

  J -- 否 --> K
  J -- 是 --> J1["从 song_lookup 取 plex_rating_key"]
  J1 --> J2{"缓存完整?"}
  J2 -- 否 --> K
  J2 -- 是 --> J3["applyFullReorder()"]
  J3 --> J4["更新 source<br/>trackIdSnapshot<br/>lastFullCompareAt<br/>consecutiveSkips=0"]
  J4 --> E

  K["Step 2 full compare"] --> L["过滤已知版权受限 / ignored_failure"]
  L --> M["reconcileSource()"]
  M --> N["resolveTracks()<br/>DB cache -> Plex search -> local file -> needs_download"]
  N --> O["按 sourceId + neteaseSongId 回写 run songs"]

  O --> P{"needs_download > 0 ?"}
  P -- 是 --> Q["Step 3 下载<br/>enqueue + processAll + downloadSingleSong"]
  P -- 否 --> R["跳过下载"]
  Q --> S["更新下载结果 / file_path / 任务状态"]
  R --> T["整理 resolutions"]
  S --> T

  T --> U{"需要 Plex 重排?"}
  U -- 否 --> Z
  U -- 是 --> V["triggerRescan()<br/>findTrackWithRetry()"]
  V --> W["applyFullReorder()<br/>插入 / 删除 / LCS 重排"]
  W --> Z["更新 source<br/>trackIdSnapshot<br/>lastFullCompareAt<br/>plexPlaylistRatingKey<br/>failure caches"]
  Z --> E

  E --> AA["saveSyncRun()<br/>finishState()<br/>isRunning=false"]
```

## 对比决策图

```mermaid
flowchart TD
  A["拿到 trackUpdateTime + trackIds"] --> B{"trackUpdateTime 变化了吗?"}
  B -- 否 --> C["直接 skip<br/>不做 compare"]
  B -- 是 --> D{"rebuildMatch / forceFull / source.forceFull / global.forceFull ?"}
  D -- 是 --> E["强制 full compare"]
  D -- 否 --> F["比较 currentIdOrder 与 trackIdSnapshot"]
  F --> G{"纯重排?"}
  G -- 否 --> E
  G -- 是 --> H["校验 song_lookup 缓存完整性"]
  H --> I{"当前每首歌都有 plex_rating_key ?"}
  I -- 否 --> E
  I -- 是 --> J["走纯重排快捷路径"]
```

## `song_lookup` 与路径替换

### 字段语义

- `plex_rating_key`: Plex 库命中缓存
- `file_path`: YunPlex 当前可访问的本地路径缓存

### 路径映射规则

配置项：

- `download.dir`
- `download.plexLibraryPathPrefix`

当 Plex 返回媒体路径时：

1. 如果路径以 `plexLibraryPathPrefix` 开头
2. 则把这一段替换为 `download.dir`
3. 映射结果存在时，再写入 `song_lookup.file_path`

例子：

- `download.dir = /app/downloads/music`
- `plexLibraryPathPrefix = /music`
- Plex 返回 `/music/Jay/Album/01.mp3`
- 映射后保存 `/app/downloads/music/Jay/Album/01.mp3`

### 自愈规则

- `plex_rating_key` 无效：整条 `song_lookup` 删除
- `file_path` 映射后不存在：只清空 `file_path`
- `plex_rating_key` 仍有效时，不因为坏路径而丢掉 Plex 命中缓存

## 重建匹配并同步

“重建匹配并同步”是 source 级高级操作，不是新的任务类型。

行为：

1. 先拉当前 source 本次实际参与同步的网易云歌曲列表
2. 遵守 `syncLimit`
3. 删除这些 `songId` 对应的 `song_lookup`
4. 标记 rebuild 模式
5. 强制 full compare
6. 不清 `ignoredFailureIds`
7. 不清 `copyrightRestrictedIds`
8. 不清 `artist_resolution_cache`
9. 收尾时与正常 full compare 一样更新 `trackIdSnapshot`、`lastFullCompareAt`、`lastTrackUpdateTime`

## MusicBrainz 的定位

当前 MusicBrainz 只参与 artist alias 增强，不参与 title alias 生成。

候选优先级：

1. 原名
2. 手工 alias
3. MusicBrainz alias
4. 简繁转换

因此：

- `刘柏辛 -> Lexie Liu` 这类 artist 变体可由 MB 或手工 alias 处理
- 简繁 artist 变体可由脚本转换处理
- “标题被 Plex 刮成罗马音”不依赖 MusicBrainz，仍由标题规范化和保守匹配策略兜底
