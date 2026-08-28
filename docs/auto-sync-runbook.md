# 自动同步验收与诊断

本文验证 Source Schedule 与 Source Convergence Request 的可靠性。受控验收、数据库诊断和真实外部 E2E 是三层不同证据，不能互相替代。

## 1. 受控验收

```bash
pnpm acceptance:auto-sync
```

该命令使用临时 SQLite 数据库和受控 Source Convergence 替身，实际运行当前的调度 store、worker 与下载队列，覆盖：

- 独立到期与未来来源跳过；
- 全局严格串行和同窗口幂等；
- 单来源失败后继续后续来源；
- 手动同步覆盖、停用取消、重启恢复与过期 lease 回收；
- 重复 daemon 初始化与数据库级单消费者；
- 下载任务不突破全局并发上限。

## 2. 真实数据库只读诊断

```bash
pnpm diagnose:auto-sync
pnpm diagnose:auto-sync -- --data-dir /app/data
```

输出 JSON，检查活跃请求、过期租约、重复计划窗口、来源调度错误、下载并发、开放异常和最近十次自动运行。违反结构不变量时命令以非零状态退出。该命令以只读模式打开已有 `data.db`，路径错误时直接失败，不创建数据库。

常用人工核对：

```bash
sqlite3 data/data.db "SELECT status, COUNT(*) FROM source_sync_queue GROUP BY status;"
sqlite3 data/data.db "SELECT id, status, trigger, started_at, finished_at, summary FROM task_runs WHERE trigger='schedule' ORDER BY started_at DESC LIMIT 10;"
sqlite3 data/data.db "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

## 3. 真实网易云与 Plex E2E

先用预览模式检查单个来源，不写 Plex：

```bash
pnpm diagnose:sync-source -- --source <SOURCE_ID> --runs 2
```

确认输出后才能显式执行真实收敛：

```bash
pnpm diagnose:sync-source -- --source <SOURCE_ID> --runs 2 --apply --mode normal
```

验收必须同时核对：两次 task run、来源 NetEase cursor、Plex read-back fingerprint、下载队列和具体 Plex Playlist Occurrence。生产数据执行 `--apply` 前应先备份数据库。

## 已完成证据（2026-08-28）

- 两个来源使用临时 1 分钟周期连续运行，均为 `attempts=1`；
- 修复后的真实串行周期中，第一个来源于 `13:29:07.532Z` 完成，第二个于 `13:29:07.537Z` 开始，无重叠；
- 服务重启、旧进程 lease、同 PID 重复 daemon 初始化均已复现并形成回归测试；
- 当前 schema 使用部分唯一索引保证整个 SQLite 最多一个 `running` 请求；
- 临时来源间隔已恢复为空，继续继承全局间隔。
