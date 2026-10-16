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

## 版本收尾

日常开发只做代码审查及按影响选择的 lint、typecheck、构建和差异检查，不新增或运行测试。用户明确要求进入“版本收尾”后，按以下顺序处理；收尾过程中修改代码后，只重跑受影响的检查。

1. **确认范围**：核对当前需求、工作区差异和待办，确定这一版应交付的行为及尚未完成的外部验收。
2. **精简现有测试**：删除已失效、重复、只锁定当前源码写法、类名、固定像素或历史组件结构的测试。保留真实输入输出、状态变化、数据安全、关键失败路径及有独立价值的跨模块约束，例如只有下载 worker 能消费队列；不因文件名旧或使用 mock 就删除。测试失败先判断需求、夹具或业务实现哪一方有误，不为过时断言修改正确业务代码。
3. **补充必要覆盖**：只为本版改变的关键行为、已确认缺陷或缺失的失败路径补测试，不按函数、配置字段或代码行数追求数量，不把实现细节复制成断言，不在业务代码新增仅用于让测试通过的分支。
4. **执行本地门禁**：运行一次 `pnpm check:ci`，覆盖 lint、typecheck、单元与集成测试、样式规则、文件大小、生产构建及差异检查。涉及页面、交互或启动运行时，使用刚生成的生产包运行相关浏览器测试；涉及镜像或部署时，再做隔离 Docker 验收。通过的检查不重复执行，除非代码又改动或仍有具体未解决问题。
5. **核对交付材料**：同步当前用法和配置说明，从 `ROADMAP.md` 删除真正完成的待办；核对变更范围、版本信息以及未完成验收。截图、日志和报告留在仓库外，不新增历史总结文档。
6. **按授权交付**：用户说“版本收尾”只授权上述本地工作，不自动授权版本号变更、提交、标签、推送、部署或公开分发。获得相应授权后，按 Conventional Commits 提交，并执行[正式发版与 GHCR 分发](../docs/operations.md#正式发版与-ghcr-分发)。版本准备命令在 `dev` 生成版本和变更日志提交，`release:tag` 在 `main` 创建最终 tag；先只推 main 部署 NAS，验收并由用户最终确认 release 和公开分发后，再推本次 tag 自动分发镜像。一次明确授权覆盖的连续步骤不重复确认。
7. **报告验收状态**：分别列出本地检查、CI、部署和真实网易云/Plex/NAS 验收的结果及阻塞项。自动化通过不代表真实环境验收完成；临时资源按本次运行范围清理。

CI 是推送或 PR 触发的自动门禁，仍执行现有检查；本地“版本收尾”规则不关闭 CI。`pnpm check:ci` 包含测试，日常开发不要用它代替单独的静态检查。真实网易云/Plex 验收需要专用资源及对应操作授权。

## 收尾时的本地检查

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

## 音乐标签依赖

`unit/server/lib/tag-writer.integration.test.ts` 使用生成的静音音频，覆盖无填充块、前置 ID3、完整字段、自定义标签、封面保留及写入失败。`fixtures/` 中的静音和纯色图片由本地 FFmpeg 生成；运行测试不需要 FFmpeg。

生产构建后，可单独检查输出包内的原生模块和元数据读取依赖；Docker 冒烟也包含这项检查：

```bash
node tests/acceptance/tag-runtime-smoke.mjs .output/server
```

用户要求更换依赖并对比时，可用 `compare-flac-writers.mjs` 比较新旧 Worker。第一个参数是可独立加载旧依赖的 Worker 快照，第二个参数是只读 FLAC 样本目录；脚本只修改临时副本，比较标签、封面和音频数据哈希，并在独立子进程测量耗时及内存。新 Worker 的计时包含新增的回读核验，旧 Worker 不包含。报告写到仓库外：

```bash
node tests/acceptance/compare-flac-writers.mjs /tmp/legacy/server/lib/tag-writer-worker.ts /path/to/flac-samples 3 /tmp/flac-comparison.json
```

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
