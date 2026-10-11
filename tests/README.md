# 测试

所有测试代码和测试工具集中在这里。单元与集成测试使用临时文件、临时数据库和外部服务替身；浏览器测试由专用启动器创建空数据库，关闭自动同步并清空网易云/Plex 凭据。

## 目录

| 目录          | 内容                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| `unit/`       | Vitest 单元与集成测试；按 `lib/`、`composables/`、`server/` 分组，跨模块检查放在此目录根下 |
| `browser/`    | Playwright 页面与操作流程测试，辅助函数放在 `browser/helpers/`                             |
| `helpers/`    | 测试服务启动等共用工具                                                                     |
| `acceptance/` | Docker 和真实网易云/Plex 的验收脚本                                                        |

业务目录中不放测试。新增测试沿用 `.test.ts`，浏览器测试沿用 `.spec.ts`；可以用 `~~/` 从项目根目录导入被测代码。

## 本地检查

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm check:styles
pnpm check:repo-size
pnpm build
```

`pnpm check:ci` 依次执行上述检查和 `git diff --check`。只测一个模块时指定文件或目录，例如：

```bash
pnpm exec vitest run tests/unit/server/lib/download
pnpm acceptance:auto-sync
pnpm acceptance:media-reuse
```

## 浏览器

```bash
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
PLAYWRIGHT_PRODUCTION=1 pnpm test:browser
```

默认测试服务运行在 3011，生产包测试运行在 3013。`helpers/browser-test-server.ts` 创建的临时数据库会在服务退出后清理。指定测试文件时使用 `pnpm exec playwright test tests/browser/settings-persistence.spec.ts`。

不要把 `PLAYWRIGHT_REUSE_SERVER=1` 指向日常使用的实例，它会让测试操作那个实例。截图、trace 和报告放在 `test-results/` 或仓库外，不提交。

CI 运行 `pnpm check:ci`，页面测试在本地手动运行。

## Docker

在有 Docker 的机器上，先构建镜像再测试：

```bash
docker build -t reyunplex:test .
sh tests/acceptance/docker-smoke.sh reyunplex:test
```

脚本使用临时容器与卷，检查安装向导、数据库、重启和正常退出，结束后清理本次资源。它不连接网易云或 Plex；NAS 流水线使用同一个脚本。

## 真实网易云与 Plex

真实测试会下载文件、使用账户凭据和修改 Plex 歌单。先准备专用测试来源，并确认应用下载目录与 Plex 音乐库能看到同一份文件。结果核对实际音频、标签与歌单内容，不只看页面成功提示。

| 流程               | 检查结果                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 首次接管           | 分析阶段没有文件或歌单变动；确认后使用所选媒体，未匹配歌曲按选择处理                         |
| 快速方案与共享媒体 | 分数线改变预览；确认、仅存草案、恢复与取消行为正确；共用媒体仍保留各首歌曲的位置             |
| 重复同步与调序     | 重复运行不重复下载，网易云增加、删除和调序后 Plex 内容与顺序正确，音乐文件不因移除条目被删除 |
| 文件下载与修复     | 音频可播放，音质、艺人、歌词、封面和标签符合设置；失败替换保留原文件                         |
| 失败与重启         | 网络恢复后可以重试，暂停与继续生效，重启能恢复未完成任务，等待确认不会自行提交               |
| 自动同步与大歌单   | 不同来源按各自间隔执行，总下载并发不突破配置；运行规模扩大后没有持续积压或资源增长           |
| NAS 升级与恢复     | 真实目录权限、安装、升级和备份恢复有效，步骤见[运维手册](../docs/operations.md)              |

`acceptance/soak.ts` 可以从只读数据库取得连接配置，在独立数据库、专用音乐子目录与 Plex 测试歌单中执行真实任务。它需要生产构建；第二个参数必须是尚不存在的输出目录：

```bash
pnpm build
pnpm exec jiti tests/acceptance/soak.ts /path/to/data.db /tmp/reyunplex-smoke-run 3014 smoke
```

`smoke` 做短时检查，`quick` 检查快速接管，`soak` 连续观察 24 小时。共享路径不同时，先设置 `YUNPLEX2_ACCEPTANCE_MEDIA_ROOT` 和 `YUNPLEX2_ACCEPTANCE_PLEX_PREFIX`。输出含运行数据和凭据数据库，应留在本机仓库外；测试结束后核对资源趋势和 Plex 结果，并清理这次专用歌单与媒体。

手机触控、主题观感和长时间阅读体验需要实际查看。未完成的验证只保留在[待办](../ROADMAP.md)，每次测试结果放在运行输出中。
