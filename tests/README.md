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
4. **执行本地门禁**：运行一次 `pnpm check:ci`，它依次执行 `lint`、`typecheck`、`test`、`check:styles`、`check:repo-size`、`build` 和 `git diff --check`。它不运行浏览器、Docker 或真实网易云/Plex 验收；涉及 NAS 采样程序时，另行执行 [NAS 验收工具的 Python 回归检查](#nas-正式镜像与中断恢复)。涉及页面、交互或启动运行时，使用刚才生成的生产包运行相关浏览器测试；涉及镜像或部署时，再做隔离 Docker 验收。通过的检查不重复执行，除非代码又改动或仍有具体未解决问题。
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

脚本不发布端口、使用 `--network none`，创建本次专用的数据卷与音乐卷，检查安装状态页、SPA、SQLite、原生标签运行时、项目与第三方许可随附、重启和正常退出，结束时只清理本次创建的容器与卷。许可检查要求服务端运行依赖的原文缺失数为零。它不连接网易云或 Plex；镜像是前置条件，不会被脚本构建或删除。

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

### NAS 正式镜像与中断恢复

`acceptance/nas-release.py` 使用 NAS 本地已有的不可变候选镜像，配合 `nas-runtime.mjs`、`nas-plex-proxy.mjs`、`nas-entrypoint.sh` 做真实验收。候选可以与线上镜像不同；准备时先核对实际镜像 ID、完整提交号标签和 `linux/amd64` 平台，每次测试操作还核对专用容器的标签和实际运行镜像。它不构建、推送或部署镜像，不重启正式服务。需要单独取得真实下载、创建和删除专用 Plex 库与歌单、保存最小连接凭据副本的授权。正式库只读取连接字段和一首种子文件，正式来源、绑定和任务不会复制到测试数据库。

测试代理按流转发 Plex 通知，客户端断开时关闭上游连接；只有指定的写入断点会暂缓转发响应。`unit/acceptance/nas-plex-proxy.test.ts` 用本地 HTTP 替身核对通知及时到达、断开释放和两种写入中断边界，不连接真实 Plex。

先在仓库外新建权限为 `0700` 的 `yunplex-acceptance-<唯一标识>` 目录，将这四个文件放在其 `helpers/` 下。另准备可被 Plex 读取、名称相同的独立媒体目录，父目录权限 `0755`；不要放进正式音乐库。根目录放 `scope.json`（`{"scope":"目录名称"}`）和 `run.json`：

| 字段                                   | 内容                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `scope`、`mediaRoot`                   | 本次目录名称及独立媒体目录绝对路径；两者末级名称必须相同                         |
| `dockerCommand`                        | Docker 命令数组，如 `["docker"]` 或实际已获授权的 sudo 命令                      |
| `image`、`revision`                    | 本次候选的 `sha256:…` 镜像 ID 与完整提交号；镜像必须为 `linux/amd64`             |
| `productionContainer`、`productionUrl` | 仅供只读观察的正式容器名称与地址                                                 |
| `donorData`、`donorMusic`              | 只读配置数据库所在目录及种子文件所在的正式音乐挂载根目录                         |
| `uidGid`、`port`                       | 非 root 运行身份及未使用的本机端口；测试端口只绑定 `127.0.0.1`                   |
| `playlistId`、`seedSongId`             | 已核对的公开测试歌单与现有绑定歌曲；当前用例要求前两首恰好一首待下载、一首可复用 |
| `observationMode`                      | 默认 `full`：先空闲后同步；`periodic_sync`：直接执行周期同步补测                 |
| `durationSeconds`                      | `full` 至少 `86400`；`periodic_sync` 至少 `43200`                                |

`run.json` 不含凭据。`prepare` 从只读正式数据库中仅取网易云 Cookie 与 Plex 连接字段，放入本次 `0600` 的临时 SQLite；安装完成后删除种子数据库，后续凭据只在测试实例中保留。测试媒体按真实读取需要设为目录 `0755`、文件 `0644`，凭据目录与媒体目录分开。

设置 `RUN` 为本次绝对目录后依次运行，失败时先检查输出，不跳过失败直接宣布通过：

```bash
python3 "$RUN/helpers/nas-release.py" prepare --root "$RUN"
python3 "$RUN/helpers/nas-release.py" writes --root "$RUN"
python3 "$RUN/helpers/nas-release.py" download --root "$RUN"
python3 "$RUN/helpers/nas-release.py" backup --root "$RUN"
python3 "$RUN/helpers/nas-release.py" launch --root "$RUN"
python3 "$RUN/helpers/nas-release.py" status --root "$RUN"
```

| 用例                     | 验收证据                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| 混合首次接管             | 分析前后文件哈希不变，重复确认同一请求，实际两首歌单内容与顺序正确                     |
| 写入后丢失响应并强制终止 | 未确认写入记录落盘，Plex 已实际提交；重启后按回读恢复，没有第二次插入                  |
| 请求尚未发出就强制终止   | Plex 内容未变，重启与普通保存设置均保留待确认；明确确认目标后只补一次                  |
| 替换下载中强制终止       | 暂停并核实实际执行阶段，原文件哈希不变；重启记为中断，选中重试保留替换意图             |
| 备份恢复                 | 只停本次容器，篡改包被拒且目标未变；有效包恢复后认证、来源、文件与歌单可用，旧数据保留 |

`launch` 只在 NAS 启动有截止时间的采样进程，不创建提醒或自动复核。默认前 12 小时空闲，后 12 小时每 30 分钟同步这两首。已有空闲观察、只补持续同步时，设置 `observationMode: "periodic_sync"` 和 `durationSeconds: 43200`，立即开始约 24 轮周期同步。该模式只补同步覆盖，不代替新候选镜像的完整 24 小时观察。每分钟采集测试实例运行指标、SSE 开关后的连接数，以及两实例 Docker 资源和正式服务就绪状态。

候选修复复验中，专用实例将未验证媒体策略显式设为等待手动选择。`nas-runtime.mjs` 的 `deferred-choice` 会取消外部媒体的手工接管，并在专用歌单移除另一首托管曲目，核对待选择决定被保留、另一首仍能补回及媒体哈希不变；随后用 `restore-deferred` 恢复基线。托管文件仍可按准确路径重新关联，默认自动下载策略也不等于等待手选，不将这些正常行为误判为取消关联失败。中断测试还记录重启前后的实际 Node PID、任务终态及是否在旧租约到期前收尾。`browser/run-timeline-classification.spec.ts` 使用明确的分类夹具验证候选前端；对 NAS 专用实例运行时，`YUNPLEX_ACCEPTANCE_SESSION_FILE` 仅指向本次测试会话文件，不使用正式服务会话。

只读探测失败按阶段与次数记入 `probeErrorCounts`，不永久关闭后续负载。私有实例的读取失败会跳过本轮写入，下一次读回并核对基线后再继续；正式服务的就绪探测超时仅记录。写入请求执行失败或结果不明、实例更换或退出、媒体/歌单/任务基线变化、队列不排空、额外文件任务、SSE 未释放仍会暂停后续写入，继续收集只读证据。测试实例限制内存 `1 GiB`，连续五次 RSS 超过 `768 MiB` 也会暂停。内存趋势结合预热后与最后两小时的中位数、连接数和工作负载人工判断，单次峰值不直接判成泄漏。

结果只写本次目录。`status.json` 有开始、截止、最近心跳、样本数、预期/实际工作负载轮数、暂停标记和异常；`samples.jsonl` 是时间序列，`results.jsonl` 是即时用例结果。到时状态为 `observation_complete_pending_review`，不自动判为验收通过；轮数不足会明确记录 `coverageComplete: false`，采样进程退出或样本有大段缺口也不算通过。正常结束后清理本次 Plex 歌单、库、容器、音乐、凭据和备份，保留脱敏结果。提前结束用 `cleanup`，操作前仍须确认本次采样已停止；清理失败会保留明确状态供人工处理。

采样程序的回归检查使用假时钟与本地替身，不连接外部服务：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/unit/acceptance -p 'test_nas_observation.py' -v
```

发布工具的冲突、重试、`latest` 不降级与实际运行镜像约束由 `unit/release-publication.test.ts` 使用本地 Docker 和仓库替身验证。真实 GHCR 发布、公开可见性与无凭据拉取仍按发布授权另行验收。

手机触控、主题观感和长时间阅读体验需要实际查看。未完成的验证只保留在[待办](../ROADMAP.md)，每次测试结果放在运行输出中。
