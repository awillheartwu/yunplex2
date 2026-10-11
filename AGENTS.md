# 项目指引

reYunPlex 用 Nuxt 4、Nitro 和 SQLite，把网易云歌单或专辑同步为本地音乐与 Plex 歌单。按用户当前目标完成工作，保留无关的工作区改动。

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

文档改动检查格式、引用和差异；代码改动运行相关行为测试与 lint/typecheck；涉及构建、依赖或运行集成时执行 build。通过后只为新改动、失败或未解决的问题追加检查。测试使用临时数据库和文件，不连接正式网易云/Plex。真实环境验收另行说明。

所有测试、夹具和测试专用工具集中放在 `tests/`，目录与命令见 `tests/README.md`。不要在业务目录旁新增测试文件，也不要在 `scripts/` 放测试脚本。

提交使用 Conventional Commits。提交、推送和部署按用户授权范围执行。

## 主要代码入口

- `server/api/` 处理 HTTP 请求，调用业务模块；响应统一通过 `server/lib/response.ts`。
- `server/lib/sync/source-requests.ts` 接受来源请求，`request-store.ts` 保存，`worker.ts` 串行执行，`source-schedule-store.ts` 负责定时与恢复。
- `server/lib/sync/service.ts` 统一执行同步。下载准备、Plex 更新和结果保存分别在 `source-downloads.ts`、`source-plex-reconciliation.ts`、`source-finalization.ts`。
- `server/lib/download/worker.ts` 统一执行文件任务；`options.ts::resolveSingleSongConfig()` 组装单曲配置。
- `server/lib/source-initialization/` 负责首次接管分析和用户确认。
- `server/lib/db/schema.ts` 定义数据库结构，数据库文件是 `<dataDir>/data.db`。
- `server/plugins/sync-daemon.ts` 负责启动、任务恢复与关闭。

## 当前行为要求

- 媒体关联保存在 `song_identity_bindings`，本地文件保存在 `local_media_assets`。手动选择优先；只有唯一的托管文件准确路径可以自动建立关联，元数据相似仅用于推荐。
- Plex 歌单增删经过 `reconciliation-plan.ts` 和 `identity-coordinator.ts`，以具体 `playlistItemID` 操作；执行前核对关联，写后重新读取结果。同步不删除音乐文件。
- 下载并发是全局上限。替换文件先校验临时文件再切换，失败保留原文件。
- 路径前缀只换算 reYunPlex 与 Plex 的路径，文件共享由实际挂载提供。
- 配置先校验再合并；来源覆盖中的 `null` 继承全局值，不能把明确的 `false` 当成未设置。
- 不在代码和注释中硬编码个人路径或凭据。Cookie、Token 和密码不进入日志或提交产物。
- SSE 页面订阅在卸载时释放连接引用、监听器和计时器。
- Nuxt 自动导入 Vue API、组件和 composable。子组件内部样式由子组件负责，页面公共布局放在对应页面样式中。

## 文档

- 只写当前用法、实现和未完成事项，用直接好懂的语言。
- 同一内容保留一处，修改时合并重复说明。已完成的待办从 `ROADMAP.md` 删除。
- 历史决定和变更过程由 Git 保存，不维护 ADR、阶段总结或按日期保存的验收报告。
- 临时排查记录、截图、测试结果和机器路径放到仓库外，不新增永久清理报告。
