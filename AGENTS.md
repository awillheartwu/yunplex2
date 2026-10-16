# 项目指引

YunPlex 用 Nuxt 4、Nitro 和 SQLite，把网易云歌单或专辑同步为本地音乐与 Plex 歌单。按用户当前目标完成工作，保留无关的工作区改动。

## 开发方式

- 项目尚未发布。优先解决当前需求，不为假想的旧版本增加兼容分支、历史迁移或备用流程。
- 用最小、直接的实现。校验实际输入和外部操作，不为没有证据的问题堆叠防御代码。
- 改动前读相关代码和文档即可，不要求通读全部文档。
- 当前模块位置见 `docs/architecture.md`；同步和首次接管分别见 `docs/sync-flow.md`、`docs/initialization-matching.md`。

## 命令与验证

```bash
pnpm dev                  # localhost:3001
pnpm test                 # tests/unit/ 下的单元与集成测试
pnpm test:browser         # tests/browser/ 下的浏览器测试
pnpm lint
pnpm typecheck
pnpm check:styles
pnpm check:repo-size      # 源码每文件最多 800 行
pnpm build                # 生成 .output/
pnpm start                # 运行生产构建
pnpm check:ci             # CI 使用的完整本地检查
```

日常开发不新增测试、不运行测试，也不通过 `test:watch`、`check:ci`、`acceptance:*` 或其他脚本间接运行测试。只有用户明确要求进入“版本收尾”时，才审查覆盖、补充必要测试并执行测试；审查或精简测试不自动触发收尾。文档改动检查格式、引用和差异；代码改动按影响运行 lint/typecheck，涉及构建、依赖或运行集成时执行 build。

版本收尾按 [tests/README.md 的流程](tests/README.md#版本收尾)执行。保留验证当前业务结果、关键失败路径及跨模块安全边界的测试，删除过时、重复、只锁定当前源码写法或固定样式的测试。测试失败时先核对当前需求，不为旧断言恢复已删除功能、兼容分支或特定实现。通过后只为新改动、失败或未解决的问题追加检查。

所有测试、夹具和测试专用工具集中放在 `tests/`，目录与命令见 `tests/README.md`。不要在业务目录旁新增测试文件，也不要在 `scripts/` 放测试脚本。测试使用临时数据库和文件，不连接正式网易云/Plex；真实环境验收按授权范围另行执行。

## 分支与发布

- 日常开发在 `dev`，开始修改前确认当前分支，不直接在 `main` 开发。
- 大范围调整可以从最新的 `dev` 创建 `codex/<主题>` 分支，完成后合回 `dev` 统一验收。
- `main` 用于已验收、准备部署的代码。只有用户验收通过并明确进入部署阶段，才将 `dev` 合入 `main` 并推送 `main`；本地检查通过不能代替用户验收。推送 `main` 会触发 NAS 自动部署。
- 切换或同步分支时保留全部未提交改动；分支有分叉时先检查，不用强制重置覆盖已有工作。提交使用 Conventional Commits；提交、推送和部署按用户授权范围执行。
- 提交信息不添加 AI 工具的 `Co-authored-by` 联署。
- 版本基线是 `2.0.9`。正式发版先在干净的 `dev` 准备版本和变更日志提交，合入 `main` 后再创建指向最终部署提交的 tag。首次准备使用 `pnpm release:first`，保留当前版本，后续按交付内容提升版本。
- NAS 验收并由用户最终确认 release 和公开分发后，才推送本次正式 tag，触发同一份已验收镜像分发到 GHCR；只提供 `linux/amd64`。main 和 tag 分开推送，分发不重新构建，不覆盖已有版本的不同内容，`latest` 最后更新且不得降级。具体步骤统一见 [运维手册](docs/operations.md#正式发版与-ghcr-分发)。

## 主要代码入口

- `server/api/` 处理 HTTP 请求，调用业务模块；响应统一通过 `server/lib/response.ts`。
- `server/lib/sync/source-requests.ts` 接受来源请求，`request-store.ts` 保存，`worker.ts` 串行执行，`source-schedule-store.ts` 负责定时与恢复。
- `server/lib/sync/service.ts` 统一执行同步。下载准备、Plex 更新和结果保存分别在 `source-downloads.ts`、`source-plex-reconciliation.ts`、`source-finalization.ts`。
- `server/lib/download/worker.ts` 统一执行文件任务；`options.ts::resolveSingleSongConfig()` 组装单曲配置。
- `server/lib/source-initialization/` 负责首次接管分析和用户确认。
- `server/lib/db/schema.ts` 定义数据库结构，数据库文件是 `<dataDir>/data.db`。
- `server/plugins/sync-daemon.ts` 负责启动、任务恢复与关闭。

## 当前行为要求

- 媒体关联保存在 `song_identity_bindings`，本地文件保存在 `local_media_assets`。手动选择优先；日常同步只有唯一的托管文件准确路径可以自动建立关联。首次准备可按用户明确选择的自动方案采用评分候选，执行时仍核对具体文件、现有归属和关联版本。
- Plex 歌单增删经过 `reconciliation-plan.ts` 和 `identity-coordinator.ts`，以具体 `playlistItemID` 操作；执行前核对关联，写后重新读取结果。同步不删除音乐文件。
- 下载并发是全局上限。替换文件先校验临时文件再切换，失败保留原文件。
- 路径前缀只换算 YunPlex 与 Plex 的路径，文件共享由实际挂载提供。
- 配置先校验再合并；来源覆盖中的 `null` 继承全局值，不能把明确的 `false` 当成未设置。
- 不在代码和注释中硬编码个人路径或凭据。Cookie、Token 和密码不进入日志或提交产物。
- SSE 页面订阅在卸载时释放连接引用、监听器和计时器。
- Nuxt 自动导入 Vue API、组件和 composable。子组件内部样式由子组件负责，页面公共布局放在对应页面样式中。

## 文档

- 只写当前用法、实现和未完成事项，用直接好懂的语言。
- 同一内容保留一处，修改时合并重复说明。已完成的待办从 `ROADMAP.md` 删除。
- 历史决定和变更过程由 Git 保存，不维护 ADR、阶段总结或按日期保存的验收报告。
- 临时排查记录、截图、测试结果和机器路径放到仓库外，不新增永久清理报告。
