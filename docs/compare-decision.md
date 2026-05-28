# 歌单同步 — 决策流程

## 每个歌单源的完整判断链路

```
同步歌单源
  │
  ├─ Step 1: 拉取数据
  │   ├─ GET playlist/detail → trackUpdateTime + trackIds (ordered)
  │   ├─ GET Plex playlist metadata → plexUpdatedAt (如已有 ratingKey)
  │   └─ 解析 lastTrackUpdateTime / lastPlexUpdatedAt / trackIdSnapshot (DB)
  │
  ├─ Step 1: 计算变量
  │   neteaseChanged = !trackUpdateTime || trackUpdateTime != 上次
  │   plexChanged    = !plexUpdatedAt || plexUpdatedAt != 上次
  │   manualForce    = API forceFull || 全局forceFullCompare || 单源forceFullCompare
  │   autoForce      = consecutiveSkips >= fullCompareAfterSkips (>0)
  │                   || (now - lastFullCompareAt) >= fullCompareAfterDays天 (>0)
  │   currentOrder   = trackIds.map(id)
  │   oldOrder       = JSON.parse(trackIdSnapshot)
  │   addedIds       = currentOrder - oldOrder
  │   removedIds     = oldOrder - currentOrder
  │   orderChanged   = currentOrder != oldOrder (顺序不同)
  │   isPureAddition = addedIds>0 && removedIds==0 && !orderChanged
  │   isPureDeletion = addedIds==0 && removedIds>0 && !orderChanged
  │   isPureReorder  = addedIds==0 && removedIds==0 && orderChanged
  │   canIncremental = isPureAddition || isPureDeletion || isPureReorder
  │   needFull       = manualForce || autoForce || dryRun || !canIncremental || oldOrder空
  │
  ├─ 决策
  │   ┌──────────────────────────────────────────────────────────────┐
  │   │ ① SKIP                                                        │
  │   │   !neteaseChanged && !plexChanged                              │
  │   │   && !manualForce && !autoForce && !dryRun                    │
  │   ├──────────────────────────────────────────────────────────────┤
  │   │ ② PURE REORDER (增量捷径)                                     │
  │   │   isPureReorder && !needFull                                  │
  │   │   → song_lookup缓存取所有plexRatingKey → LCS重排，0次下载     │
  │   ├──────────────────────────────────────────────────────────────┤
  │   │ ③ FULL COMPARE                                                │
  │   │   其余所有情况                                                 │
  │   │   → tiered lookup(Plex歌单→DB缓存→searchTrack→磁盘→下载)      │
  │   │   → 仅下载needs_download → LCS全量重排                        │
  │   └──────────────────────────────────────────────────────────────┘
  │
  └─ 路径②③结束时：保存 trackIdSnapshot, consecutiveSkips=0, lastFullCompareAt=now
     路径①结束时：consecutiveSkips+1
```

---

## 为什么纯新增/纯删除不走独立的增量路径？

因为收益为 0。

| 操作 | 全量 | 纯增量 | 差额 |
|------|------|--------|------|
| 逐首对比 | N 次 song_lookup DB 查询 (μs) | N 次 | **无** |
| searchTrack | 0 (缓存命中 100%) | 0 | **无** |
| 下载 | 只下 needs_download | 只下新增 | **无** |
| 重排 | LCS 全量 | LCS 全量 | **无** |

song_lookup 缓存使全量对比几乎免费，额外成本可忽略。只有纯重排值得做捷径——它能跳过 download、Plex 扫描、findTrackWithRetry，节省显著。

---

## 场景矩阵

| 网易云 | Plex | 操作类型 | manual | auto | dryRun | 结果 |
|--------|------|---------|--------|------|--------|------|
| 没变 | 没变 | — | 无 | 无 | ✗ | **① SKIP** |
| 没变 | 变了 | 纯删/纯重排 | 无 | 无 | ✗ | **③ FULL** (plexChanged落地) |
| 变了 | 没变 | 仅增1首 | 无 | 无 | ✗ | **③ FULL** (无独立增量路径) |
| 变了 | 没变 | 仅顺序变化 | 无 | 无 | ✗ | **② PURE REORDER** (跳过下载) |
| 变了 | 变了 | 混合 | 无 | 无 | ✗ | **③ FULL** |
| 没变 | 没变 | — | forceFull | 任意 | ✗ | **③ FULL** (手动强制) |
| 没变 | 没变 | — | 无 | N次跳过 | ✗ | **③ FULL** (自动兜底) |
| 没变 | 没变 | — | 无 | N天未全量 | ✗ | **③ FULL** (自动兜底) |
| 任意 | 任意 | 任意 | 任意 | 任意 | ✓ | **③ FULL** (预览不跳过) |
| 任意 | 无ratingKey | 任意 | 任意 | 任意 | ✗ | **③ FULL** (首次同步) |

---

## 三层强制全量

```
单次 API forceFull
     ↓ 覆盖
单源 forceFullCompare (编辑弹窗)
     ↓ 覆盖
全局 forceFullCompare (/config)
```

---

## 配置项 (`/config` → 同步策略)

| 配置 | 默认 | 说明 | 0 含义 |
|------|------|------|--------|
| `forceFullCompare` | false | 全局始终走全量 | — |
| `fullCompareAfterSkips` | 5 | 连续跳过N次后强制全量 | 不限 |
| `fullCompareAfterDays` | 7 | 距上次全量N天后强制全量 | 不限 |
