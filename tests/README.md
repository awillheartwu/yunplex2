# 测试

所有自动化测试、测试夹具和测试专用工具集中在这里。`tests/unit/`、`tests/browser/` 与 `tests/helpers/` 使用临时数据库、临时文件和本地替身，不连接正式网易云或 Plex；真实外部验收只放在 `tests/acceptance/`，并按单独授权执行。

日常开发不新增或运行测试，也不通过 `test:watch`、`check:ci`、`acceptance:*` 或其他脚本间接运行测试。只有用户明确要求进入“版本收尾”时，才审查覆盖、补充必要测试并执行测试；审查或精简测试本身不自动触发收尾。

## 目录与配置

| 目录          | 内容                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `unit/`       | Vitest 单元与集成测试；按 `lib/`、`composables/`、`server/` 分组，跨模块检查放在目录根下 |
| `browser/`    | Playwright 页面与操作流程测试，页面共用辅助代码放在 `browser/helpers/`                   |
| `helpers/`    | 浏览器测试服务、临时数据库、失败场景和 Plex 契约替身                                     |
| `acceptance/` | Docker、生产包运行时检查、FLAC 对比和真实网易云/Plex/NAS 观察脚本                        |
| `fixtures/`   | 静音音频和图片等固定测试素材                                                             |

`vitest.config.ts` 只收集 `tests/unit/**/*.test.ts`，使用 Node 环境并限制为 2 个 worker。`playwright.config.ts` 只收集 `tests/browser`，使用 Chromium、单 worker 串行执行；CI 环境失败时重试一次，本地不重试。

业务目录中不放测试。新增测试沿用 `.test.ts`，浏览器测试沿用 `.spec.ts`；可以用 `~~/` 从项目根目录导入被测代码。

## 版本收尾

1. **确认范围**：核对当前需求、工作区差异和待办，确定这一版应交付的行为及尚未完成的外部验收。保留与本次工作无关的未提交改动。
2. **精简现有测试**：删除已失效、重复、只锁定当前源码写法、类名、固定像素或历史组件结构的测试。保留真实输入输出、状态变化、数据安全、关键失败路径及有独立价值的跨模块约束，例如只有下载 worker 能消费队列；不因文件名旧或使用 mock 就删除。测试失败先判断需求、夹具或业务实现哪一方有误，不为过时断言修改正确业务代码。
3. **补充必要覆盖**：只为本版改变的关键行为、已确认缺陷或缺失的失败路径补测试，不按函数、配置字段或代码行数追求数量，不把实现细节复制成断言，不在业务代码新增仅用于让测试通过的分支。
4. **执行本地门禁**：运行一次 `pnpm check:ci`，它依次执行 `lint`、`typecheck`、`test`、`check:styles`、`check:repo-size`、`build` 和 `git diff --check`。它不运行浏览器、Docker 或真实网易云/Plex 验收。涉及页面、交互或启动运行时，使用刚才生成的生产包运行相关浏览器测试；涉及镜像或部署时，再做隔离 Docker 验收。通过的检查不重复执行，除非代码又改动或仍有具体未解决问题。
5. **核对交付材料**：同步当前用法和配置说明，从 `ROADMAP.md` 删除真正完成的待办；核对变更范围、版本信息以及未完成验收。截图、日志和报告留在仓库外，不新增历史总结文档。
6. **按授权交付**：用户说“版本收尾”只授权上述本地工作，不自动授权版本号变更、提交、标签、推送、部署或公开分发。获得相应授权后，提交按 Conventional Commits 处理，发布按[正式发版与 GHCR 分发](../docs/operations.md#正式发版与-ghcr-分发)执行。
7. **报告验收状态**：分别列出本地检查、CI、部署和真实网易云/Plex/NAS 验收的结果及阻塞项。自动化通过不代表真实环境验收完成；临时资源按本次运行范围清理。

CI 在推送和 PR 时运行 `pnpm check:ci`，仍执行现有检查；它不运行浏览器或真实外部验收。本地“版本收尾”规则不关闭 CI。`pnpm check:ci` 包含测试，日常开发使用单独的静态检查。

## 单项测试

`pnpm test` 运行 `tests/unit/**/*.test.ts`。只测一个模块时指定已有文件或目录，例如：

```bash
pnpm exec vitest run tests/unit/server/lib/download
```

下面两个 `acceptance:*` 命令实际运行本地 Vitest，使用替身和临时数据，不访问真实服务：

```bash
pnpm acceptance:auto-sync
pnpm acceptance:media-reuse
```

## 浏览器

首次使用 Playwright 时安装 Chromium；这一步可能需要网络，已安装则可跳过：

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

默认的 `pnpm test:browser` 在 3011 启动 Nuxt 开发服务。测试辅助进程创建 `/tmp/reyunplex-browser-tests-*` 临时数据库，关闭自动同步，清空网易云与 Plex 配置，并在服务退出后删除临时目录。

生产包测试需要先生成 `.output/`，再使用 3013：

```bash
pnpm build
PLAYWRIGHT_PRODUCTION=1 pnpm test:browser
```

指定测试文件时使用 `pnpm exec playwright test tests/browser/settings-persistence.spec.ts`。`PLAYWRIGHT_REUSE_SERVER=1` 会复用端口上已有的实例，只能指向专用测试服务；不要把它指向日常或生产实例。失败截图和 trace 位于已忽略的 `test-results/`，也可以写到仓库外，不提交。

## Docker

需要可用的 Docker CLI、Docker daemon，以及本地已有的应用镜像。先构建隔离测试镜像，再用脚本验证：

```bash
docker build -t reyunplex:test .
sh tests/acceptance/docker-smoke.sh reyunplex:test
```

脚本不发布端口、使用 `--network none`，创建本次专用的数据卷与音乐卷，检查安装状态页、SPA、SQLite、原生标签运行时、重启和正常退出，结束时只清理本次创建的容器与卷。它不连接网易云或 Plex；镜像是前置条件，不会被脚本构建或删除。

## 标签运行时与 FLAC 对比

`unit/server/lib/tag-writer.integration.test.ts` 使用仓库内固定素材，覆盖无填充块、前置 ID3、完整字段、自定义标签、封面保留及写入失败。运行测试不需要 FFmpeg。

生产构建后可以单独检查输出包内的原生模块和元数据读取依赖：

```bash
node tests/acceptance/tag-runtime-smoke.mjs .output/server
```

用户要求更换依赖并对比时，可用 `compare-flac-writers.mjs` 比较新旧 Worker。第一个参数是可独立加载旧依赖的 Worker 快照，第二个参数是只读 FLAC 样本目录；脚本只修改临时副本，比较标签、封面和音频数据哈希，并在独立子进程测量耗时及内存。新 Worker 的计时包含回读核验，旧 Worker 不包含。报告写到仓库外：

```bash
node tests/acceptance/compare-flac-writers.mjs /tmp/legacy/server/lib/tag-writer-worker.ts /path/to/flac-samples 3 /tmp/flac-comparison.json
```

## 真实网易云与 Plex

真实测试会下载文件、使用账户凭据并修改 Plex 歌单。必须先取得对应操作授权，并准备专用的网易云来源、Plex 账户或测试库、测试歌单和可丢弃的共享音乐目录；不要指向需要保留的生产歌单、音乐目录或日常服务实例。结果核对实际音频、标签与歌单内容，不只看页面成功提示。

| 流程               | 检查结果                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 首次接管           | 分析阶段没有文件或歌单变动；确认后使用所选媒体，未匹配歌曲按选择处理                                                                   |
| 快速方案与共享媒体 | 分数线改变预览；确认、仅存草案、恢复与取消行为正确；共用媒体仍保留各首歌曲的位置                                                       |
| 重复同步与调序     | 重复运行不重复下载，网易云增加、删除和调序后 Plex 内容与顺序正确，音乐文件不因移除条目被删除                                           |
| 文件下载与修复     | 音频可播放，音质、艺人、歌词、封面和标签符合设置；失败替换保留原文件                                                                   |
| 失败与重启         | 每轮失败计次，达到上限后忽略；手动重试只开放所选项；执行中断计次后等下轮，首次准备继续未完成步骤；暂停与继续生效，等待确认不会自行提交 |
| 自动同步与大歌单   | 不同来源按各自间隔执行，总下载并发不突破配置；运行规模扩大后没有持续积压或资源增长                                                     |
| NAS 升级与恢复     | 真实目录权限、安装、升级和备份恢复有效，步骤见[运维手册](../docs/operations.md)                                                        |

`acceptance/soak.ts` 从只读数据库取得连接配置，并按创建时间取第一份歌单作为网易云来源；先核对输入数据库中的连接目标与这份来源。它在独立数据库、专用音乐子目录与随机命名的 Plex 测试歌单中执行真实任务，需要生产构建；第二个参数必须是尚不存在的输出目录。输出目录、媒体根目录和 Plex 目标都必须可清理：

```bash
pnpm build
pnpm exec jiti tests/acceptance/soak.ts /path/to/data.db /tmp/reyunplex-smoke-run 3014 smoke
```

`smoke` 观察两分钟，`quick` 检查快速接管，`soak` 连续观察 24 小时。共享路径不同时，先设置 `YUNPLEX2_ACCEPTANCE_MEDIA_ROOT` 和 `YUNPLEX2_ACCEPTANCE_PLEX_PREFIX`，两者都要指向本次专用目录。输出含运行数据和凭据数据库，应留在仓库外；测试结束后核对资源趋势和 Plex 结果，并清理这次专用歌单与媒体。

手机触控、主题观感和长时间阅读体验需要实际查看。未完成的验证只保留在[待办](../ROADMAP.md)，每次测试结果放在运行输出中。
