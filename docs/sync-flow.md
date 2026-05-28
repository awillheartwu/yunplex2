# 同步业务流程

## 触发方式

| 触发 | 入口 | 参数 |
|------|------|------|
| 全局手动 | 首页「手动同步」| `dryRun`(可选预览), `sourceIds`(可选) |
| 单源手动 | 歌单源页「同步」icon | `sourceId`, `forceFull`(可选) |
| 单源强制全量 | 歌单源页「全量」icon | `sourceId`, `forceFull=true` |
| 自动定时 | 后台 worker 定时触发 | 无参数 |

---

## 整体流程

```
runSync()
  │
  ├─ 互斥锁：isRunning → 拒绝并发
  ├─ 读取配置 + 清理过期数据（job/日志/download_tasks/downloads）
  │
  ├─ for each 启用的歌单源:
  │   │
  │   ├─ Step 1: 抓取网易云歌单
  │   │   ├─ 验证 Cookie
  │   │   ├─ GET playlist/detail → trackIds + trackUpdateTime
  │   │   ├─ 比较 trackUpdateTime 与上次同步
  │   │   │   ├─ 相同 && 非 forceFull → 跳过（不消耗 song_detail API）
  │   │   │   └─ 不同或 forceFull → 继续
  │   │   └─ 分批发 song_detail（400首/批，含并发老API补publishTime）
  │   │
  │   ├─ Step 2: 对比（reconcileSource → TrackResolution[]）
  │   │   ├─ Plex 歌单查找：ratingKey 直查 → 名字搜 → 自动创建
  │   │   └─ 逐首决议（resolveTracks）：
  │   │       ├─ Plex 歌单已存在 → matched_plex_playlist
  │   │       ├─ DB song_lookup 缓存命中 → 验证 plex_rating_key
  │   │       │   ├─ 有效 → found_in_plex_library
  │   │       │   └─ 失效/过期 → 走搜索
  │   │       ├─ searchTrack (Plex 全库，4级降级)
  │   │       │   ├─ 精确(title+artist+album)
  │   │       │   ├─ 宽松(stripped title+artist)
  │   │       │   ├─ 纯标题兜底
  │   │       │   └─ 未找到 → 查磁盘 existsSync
  │   │       │       ├─ 文件存在 → found_on_disk
  │   │       │       └─ 不存在 → needs_download
  │   │       └─ 写入 DB song_lookup 缓存
  │   │
  │   ├─ 回写 job 歌曲状态:
  │   │   matched/found → skipped_existing
  │   │   unavailable → failed_download
  │   │   needs_download/found_on_disk → pending
  │   │
  │   ├─ Step 3: 下载（仅 needs_download）
  │   │   ├─ 入队 download_tasks
  │   │   ├─ 并发下载（可配置 downloadConcurrency，默认3）
  │   │   ├─ 每首流程：
  │   │   │   ├─ getSongUrl → 获取直链
  │   │   │   ├─ existsSync 检查 → 跳过已有文件
  │   │   │   ├─ 流式下载（ReadableStream）→ SSE 推送实时进度
  │   │   │   ├─ fetchLyric（可选）
  │   │   │   ├─ 写入 FLAC/MP3 标签（metaflac/node-id3）
  │   │   │   └─ saveDownload → 写入 downloads 永久表
  │   │   └─ 成功后写入 job.songs + DB song_lookup
  │   │
  │   ├─ Step 4: 重排 Plex 歌单
  │   │   ├─ triggerRescan（全库刷新）
  │   │   ├─ 下载的歌曲 findTrackWithRetry（最多 N 次，间隔 M 秒）
  │   │   ├─ 构建 targetOrder（所有有 plexRatingKey 的曲目）
  │   │   └─ applyFullReorder（LCS 最小移动）：
  │   │       ├─ 移除 target 中不存在的 extra tracks
  │   │       ├─ 插入 target 中有但歌单中缺失的 tracks
  │   │       └─ 按 LCS 重排：在 LCS 中的保持不动，不在的逐个 moveAfter
  │   │
  │   └─ 更新 playlist_sources 状态（lastStatus/Error/trackCount/ratingKey/trackUpdateTime）
  │
  └─ 全局汇总 → saveJob → finishState → isRunning=false
```

---

## 增量 vs 全量

| 模式 | 触发条件 | API 调用（3400首歌单） |
|------|---------|----------------------|
| 增量 | trackUpdateTime 未变 | 1 次（仅 playlist/detail） |
| 全量 | trackUpdateTime 变化 / forceFull / dryRun | 1 + 9 次（detail + song_detail×9） |

`trackUpdateTime` 是网易云 API 返回的歌单变更时间戳，每次同步后存入 `playlist_sources.last_track_update_time`。

---

## 关键数据结构

### TrackResolution（对比产出）
```
resolution:
  matched_plex_playlist   — Plex 歌单中已有
  found_in_plex_library   — Plex 库中有但不在该歌单
  found_on_disk           — 磁盘文件存在，Plex 未索引
  needs_download          — 三处都没有，需下载
  unavailable             — 网易云无下载链接且无本地副本
```

### Plex 搜索 4 级降级（searchTrack）
```
Strategy A: 按艺人搜 Plex → findMatch
Strategy B: 按标题搜 Plex（3种变体）→ findMatch

findMatch:
  1) 精确: title + artist + album 全等
  2) 宽松: stripped title + artist
  3) 兜底: 纯 stripped title
```

### LCS 重排（applyFullReorder）
```
输入: 当前 Plex 歌单顺序 + 目标网易云顺序
输出: 最小移动操作集

1. 移除 extra tracks（Plex有网易云无）
2. 插入 missing tracks（网易云有Plex歌单无）
3. 计算 LCS（最长公共子序列）
4. LCS 中的项目保持不动
5. 非 LCS 项目按目标顺序逐个 moveAfter
```

---

## 数据表关系

```
playlist_sources     — 歌单源规则（1源 = 1规则）
  ├─ song_lookup    — Plex track 路由缓存（netease_song_id → plex_rating_key）
  ├─ jobs           — 同步任务历史（1次同步 = 1条job，可能包含多个源）
  ├─ downloads      — 永久下载记录（成功后才写入）
  └─ download_tasks — 临时队列状态（pending→downloading→tagging→done/failed，定期清理）
```

---

## SSE 事件流

| 事件 | 触发时机 | 数据 |
|------|---------|------|
| `stage-change` | 阶段切换 | `{ stage, label, sourceName }` |
| `queue-update` | 下载状态/进度变化 | `{ taskId, songName, status, progress, sourceId }` |
| `song-progress` | 单曲完成/失败 | `{ taskId, songName, status, completed, total, sourceId }` |
| `log` | 日志写入 | `{ id, level, message, stage }` |
