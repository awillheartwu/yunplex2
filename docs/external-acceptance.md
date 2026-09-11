# reYunPlex 真实环境验收手册

2026-08-29 已完成一次真实环境验收，结果与证据见
[2026-08-29 真实环境验收结果](external-acceptance-results-2026-08-29.md)。

本文只包含无法由仓库内替身完全证明的 Plex、网易云、NAS、容器与 Forgejo
验收。自动化部分先执行：

```bash
pnpm check:ci
pnpm acceptance:media-reuse
pnpm acceptance:auto-sync
pnpm test:browser
```

自动化通过不代表下面的真实环境步骤已经通过。

## 2026-09-07 入口统一的验收边界

本轮只运行隔离数据库、文件与外部服务替身，以及隔离浏览器服务；未操作生产 Plex、媒体或现有数据库。此前真实验收报告不覆盖本轮变化。

以下入口衔接与恢复场景已于 2026-09-08 至 09-09 使用独立数据库及受控真实媒体验证，结果见 [当前验收报告](external-acceptance-results-2026-09-09.md)。后续修改相关代码时，应重新执行：

- 混合来源批次先同步就绪来源、再分析需接管来源，等待确认不占用消费者；忙时拒绝没有额外入队。
- 接管提交后、worker 唤醒前重启，核对同一后续请求、双向 Run 关联和无重复绑定；禁用来源不续接。
- 分析中停止服务、重启后重新读快照；审核草案保持未提交，重新分析失败不放开同步闸门。
- 共享文件任务去重保留各调用者归属；Repair 文件完成后中断仍能恢复 Plex 刷新，且不等待无关下载批次。
- 单曲重试成功提示“下载完成，待同步”，未自动修改 Plex 歌单；显式同步后的 Plex 写入与读回符合身份及删除保护。

首次媒体接管还应覆盖大歌单抽样与人工审核：

- 对高置信候选分层抽样，覆盖时长误差边界、Live/Remix、重录版本、完整艺人集合、专辑与曲号。候选等级不能替代人工确认。
- 先在禁用测试来源提交小规模方案，核对身份冲突、稀疏决定和零自动续接，再扩大样本；不直接批量接管整库候选。
- 检查已有绑定不可编辑、跨页决定保留、旧页面重启/提交冲突，以及候选规则版本不兼容时只读且要求重新分析。
- 分析前后比较下载任务、身份、Local Media Asset 与 Plex 快照，确认分析没有文件或媒体写入；审核期间不占用来源消费者。

## 1. 验收前准备

- 使用可删除的网易云测试歌单与 Plex 测试歌单，不要直接使用唯一生产歌单。
- 测试歌单至少包含：
  - 一首 YunPlex 已下载并托管的歌曲；
  - 一首 Plex 已存在、但从未被 YunPlex 接管的外部歌曲；
  - 一首没有可验证媒体的歌曲。
- 记录当前 Git revision、Plex 版本、音乐库名称、metadata agent/scraper 名称。
- 使用 SQLite 在线备份，不要复制正在写入的 WAL 文件：

```bash
mkdir -p data/backups
sqlite3 data/data.db ".backup 'data/backups/pre-external-acceptance.db'"
sqlite3 data/backups/pre-external-acceptance.db "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

预期：第一条检查输出 `ok`，外键检查没有输出。

## 2. 托管精确路径与 scraper 独立性

1. 在同步源“歌曲与媒体”中选择一首 YunPlex 托管歌曲。
2. 记录：
   - 网易云歌曲 ID；
   - 本地托管路径；
   - Plex `ratingKey`；
   - Plex `Media.Part.file`；
   - 当前 Plex 歌单中的 `playlistItemID`。
3. 执行一次普通同步，确认没有重复下载、没有新增第二份 Plex 媒体。
4. 在 Plex 中切换或刷新另一种 metadata agent/scraper，只允许它改变标题、艺人、
   专辑等展示信息，不移动文件。
5. 再执行一次普通同步。

通过条件：

- [ ] 两次同步都复用同一精确 `Media.Part.file`。
- [ ] scraper 改名后没有创建新 Media Link。
- [ ] 没有重复下载文件。
- [ ] 没有误删其他 Plex Playlist Occurrence。
- [ ] 写后读回顺序与网易云目标一致。

## 3. 未验证媒体的两条策略

### 3.1 download_managed

1. 设置 → 未验证媒体 → 选择“下载独立托管副本”。
2. 对没有 Media Link 的测试歌曲执行同步。
3. 等待下载、标签写入和 Plex 扫描完成，再执行一次同步。

通过条件：

- [ ] 文件名包含 `[netease-{songId}]`。
- [ ] Local Media Asset 为 managed。
- [ ] Plex 只按精确路径建立 path Media Link。
- [ ] Plex 尚未索引时保留旧 occurrence，不用标题或艺人猜测。

### 3.2 wait_manual

1. 设置 → 未验证媒体 → 选择“等待手动选择”。
2. 对另一首没有 Media Link 的测试歌曲执行同步。

通过条件：

- [ ] Task Run 显示等待手动选择，而不是同步失败。
- [ ] 没有自动下载。
- [ ] 没有自动选择标题相似的 Plex 媒体。
- [ ] 可以在歌曲上下文看到“使用 Plex 媒体”和“下载并托管”两个动作。

## 4. Explicit Adoption 与失效回退

1. 在 wait_manual 歌曲上点击“使用 Plex 媒体”。
2. 选择一条路径明确的 Plex 外部媒体并保存关联。
3. 执行同步，记录 ratingKey、精确路径和 playlistItemID。
4. 修改 Plex 展示元数据，再同步一次。

通过条件：

- [ ] 展示元数据变化不影响 manual Media Link。
- [ ] 外部 Local Media Asset 保持 external。
- [ ] 没有产生托管副本。

### 可选：ratingKey 变化恢复

这一步会操作 Plex 测试媒体，只能对可重建的测试文件执行。

1. 保持文件路径不变，让 Plex 删除并重新索引该测试媒体，使 ratingKey 改变。
2. 不在 YunPlex 中重新选择，直接执行同步。

通过条件：

- [ ] YunPlex 只在精确路径唯一时恢复到新 ratingKey。
- [ ] Media Link 仍为 manual。
- [ ] 精确路径对应多条 Plex 记录时停止，不任选第一条。

### 失效回退

1. 将已接管测试媒体移出 Plex 可见路径，执行同步。
2. 分别在 `download_managed` 和 `wait_manual` 下观察。

通过条件：

- [ ] 原 manual 关联被标记失效。
- [ ] download_managed 进入独立托管下载。
- [ ] wait_manual 回到等待选择。
- [ ] 两种情况都不授权删除未完成目标对应的旧 occurrence。

## 5. 重复路径冲突

仅当测试 Plex 环境能让同一音乐库暴露两个 ratingKey、且两者
`Media.Part.file` 完全相同时执行。

通过条件：

- [ ] Track Resolution 为身份冲突/不可用。
- [ ] 不建立或覆盖 Media Link。
- [ ] 不下载覆盖该路径。
- [ ] 不删除相关 playlistItemID。

如果 Plex 无法稳定制造该场景，记录“环境无法构造”；仓库内
`pnpm acceptance:media-reuse` 已覆盖受控替身场景。

## 6. Media Repair Command 重启恢复

1. 选择歌曲较多的测试来源，启动“修复标签、词图”。
2. 在任务中心确认 Repair Run 和 repair download tasks 已出现。
3. 正常重启容器，观察关停是否等待当前操作完成。
4. 如需验证非正常中断，只能在已备份、可恢复的测试环境中强制终止容器，
   随后重新启动。

通过条件：

- [ ] 正常关停不会把已完成文件标记失败。
- [ ] 非正常中断的 repair task 重启后回到 pending 并继续。
- [ ] Repair Run 最终计数等于成功 + 失败 + 跳过。
- [ ] Local Media Asset 在 task 标记 done 前已经提交。
- [ ] 外部文件仍为 external，既有 managed 文件仍为 managed。
- [ ] repair 期间 Source Schedule 只排队，不并发运行 Source Convergence。
- [ ] repair 只刷新 Plex 媒体库，不增删或重排 Plex 歌单。

## 7. 自动调度连续运行

让至少两个来源使用不同间隔运行两个完整周期，然后执行：

```bash
pnpm diagnose:auto-sync
```

通过条件：

- [ ] `healthy=true` 且 `violations=[]`。
- [ ] 没有多个 running Source Convergence Request。
- [ ] 没有过期 lease 或重复 schedule window。
- [ ] 两个来源严格串行。
- [ ] 下载并发不超过设置值。
- [ ] 最近 Task Run、来源 cursor 和 Plex read-back 与实际一致。

## 8. Docker 与 Forgejo

### Docker

```bash
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=200 yunplex2
```

通过条件：

- [ ] 镜像使用 Node 24。
- [ ] 容器 health 状态最终为 healthy。
- [ ] `/app/data` 与音乐目录挂载可写。
- [ ] 重启后数据库、来源排期和任务仍存在。

### Forgejo

1. 确认 runner 有 `ubuntu-latest` 标签。
2. 推送测试分支或创建 Pull Request。
3. 确认 Quality gates 完成：
   - lint、typecheck、完整单元/集成测试套件；
   - repository size；
   - production build；
   - Chromium 安装与 browser journeys。
4. 为 dev、main 启用分支保护，要求该检查通过。

## 9. 结果记录

| 场景                   | 环境/版本 | 结果            | Task Run / ratingKey / 路径证据 | 备注 |
| ---------------------- | --------- | --------------- | ------------------------------- | ---- |
| scraper A 精确路径复用 |           | 待执行          |                                 |      |
| scraper B 精确路径复用 |           | 待执行          |                                 |      |
| download_managed       |           | 待执行          |                                 |      |
| wait_manual            |           | 待执行          |                                 |      |
| Explicit Adoption      |           | 待执行          |                                 |      |
| ratingKey 恢复         |           | 待执行/无法构造 |                                 |      |
| 重复路径冲突           |           | 待执行/无法构造 |                                 |      |
| repair 重启恢复        |           | 待执行          |                                 |      |
| 双来源调度             |           | 待执行          |                                 |      |
| Docker health          |           | 待执行          |                                 |      |
| Forgejo Quality gates  |           | 待执行          |                                 |      |

验收完成后不要只写“通过”。保留对应 Task Run ID、前后 ratingKey、
Media.Part.file、playlistItemID、容器 revision 和失败截图；任何一项不符合时停止
继续破坏性测试，并从备份恢复测试数据库。
