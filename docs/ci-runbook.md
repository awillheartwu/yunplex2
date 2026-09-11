# 最小 CI 门禁

仓库使用 Forgejo Actions 运行基础质量门禁，不包含镜像构建、NAS 部署、数据库复制或清理。

## 本地复现

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check:ci
pnpm exec playwright install chromium
pnpm test:browser
```

`check:ci` 顺序执行 lint、TypeScript 类型检查、完整测试、设计变量检查、仓库体积检查、生产构建和 `git diff --check`。测试套件包含全新 SQLite 数据库建表与有界结构升级验证。Forgejo 随后安装 Chromium（含系统依赖）并执行隔离浏览器旅程。

Node 版本读取 `.nvmrc`，pnpm 版本读取 `package.json#packageManager`。CI 只缓存 pnpm 依赖，不缓存 `data/` 或任何运行时 SQLite 数据库。

## Forgejo 平台验收

1. 为仓库启用 Actions，并确认 runner 提供 `ubuntu-latest` 标签。
2. 推送分支后确认 `Quality gates` 能取得任务并完成。
3. 将 `dev`、`main` 设为受保护分支，要求 `Lint, typecheck, test and build` 通过后才能合并。
4. runner 标签若不同，只调整工作流的 `runs-on`，不要在未确认替代 runner 可用前删除现有 runner。

部署流水线必须另行设计，不能在本工作流追加生产目录、数据库、Docker volume 或服务变更。


## 生产包浏览器验收

运行 `pnpm build` 后执行 `PLAYWRIGHT_PRODUCTION=1 pnpm test:browser`，测试会在 3013 启动生产构建，并创建禁用调度、未配置外部连接的临时数据库；结束后自动停止服务并删除临时数据库。默认开发模式仍使用 3011。

禁止本地存储的首屏用例仅在生产构建执行，因为开发专用的 Vue Devtools 依赖在应用初始化前直接访问存储。应用外观缓存回退、登录和音乐库视图切换仍由完整生产包验证。测试读取已登录配置时使用浏览器认证上下文，避免独立 HTTP 客户端在本地 HTTP 环境不发送生产 Secure Cookie。
