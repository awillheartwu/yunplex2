# YunPlex2

将网易云音乐歌单同步到 Plex 媒体服务器的 Web 管理工具。

## 功能

- **Web 管理面板** -- 可视化管理配置、触发同步、查看状态
- **定时同步** -- 按设定间隔自动同步网易云歌单到 Plex
- **手动同步** -- 支持普通、全量和无副作用预览模式
- **来源管理** -- 支持歌单与专辑来源、来源级同步策略和批量操作
- **手动下载与任务中心** -- 支持歌单、专辑、单曲下载，实时任务、并发限制和失败处理
- **安全复用** -- 托管文件按精确路径自动复用，外部媒体明确接管，无法确认时自动下载
- **日志追踪** -- 同步任务日志落盘，支持按级别过滤查看
- **文件标签** -- 下载歌曲时写入 ID3/FLAC 元数据和封面
- **Docker 部署** -- 单容器 Docker Compose 部署，配置持久化

## 项目结构

```
YunPlex2/
├── server/
│   ├── api/           # API 路由（配置、同步、日志、系统）
│   ├── lib/           # 配置、数据库、下载队列、身份与同步领域逻辑
│   └── plugins/       # Nitro 插件（sync daemon）
├── pages/             # 前端页面（仪表盘、同步源、手动下载、任务、设置、系统）
├── components/        # Vue 组件
├── composables/       # 可组合函数
├── assets/css/        # 全局样式
├── docs/              # 当前实现文档与架构决策
├── data/              # 运行时数据目录
│   └── data.db        # SQLite 数据库
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 本地开发

### 前置要求

- Node.js 24（与 .nvmrc、CI 和 Docker 一致）
- pnpm 10.33.0（由 packageManager 固定）

### 安装与启动

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

开发服务器默认运行在 `http://localhost:3001`。

### 同步稳定性诊断

诊断单个歌单源时，可连续执行同步并比较 Plex 的歌曲顺序与
`playlistItemID`。命令默认预览，不修改 Plex；只有显式传入 `--apply`
才会执行真实同步：

```bash
npm run diagnose:sync-source -- --source <歌单源 ID> --runs 2
npm run diagnose:sync-source -- --source <歌单源 ID> --runs 2 --apply
```

输出中的 `identityFingerprint` 检查歌曲与顺序，`occurrenceFingerprint`
还会检查 Plex 歌单项身份，可识别“删除后重新加入同一首歌”。需要逐项
查看歌曲时增加 `--verbose`；也可使用 `--force-full`、`--rebuild-match`
或 `--data-dir <目录>`。运行真实诊断前请停止开发服务器，避免并发同步。

### 构建生产版本

```bash
pnpm build
node .output/server/index.mjs
```

## Docker 部署

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

服务运行在 `http://localhost:3000`。

### 持久化数据

SQLite 数据库 `data.db` 存储在容器的 `/app/data` 目录中。包含所有配置、同步日志和任务状态。
`docker-compose.yml` 默认将此目录挂载到宿主机的 `./data` 目录。修改宿主机路径即可自定义：

```yaml
volumes:
  - /your/custom/path/data:/app/data
```

## 配置说明

所有配置通过 Web 管理面板操作，页面路径：**设置**（`/config`）。

### 网易云音乐

| 配置项 | 说明 |
|--------|------|
| Cookie | 从浏览器开发者工具复制，用于认证 |
| 歌单 ID | 要同步的歌单数字 ID，多个用逗号分隔 |
| 音质偏好 | 标准 → 超清母带，按实际会员等级可选 |

### Plex Media Server

| 配置项 | 说明 |
|--------|------|
| 服务器地址 | Plex 服务器的 IP 或域名 |
| 端口 | 默认 32400 |
| Token | X-Plex-Token |
| 音乐库名称 | Plex 中音乐库的名称 |

### 下载与文件

| 配置项 | 说明 |
|--------|------|
| 下载目录 | 歌曲文件的存储根目录 |
| Plex 音乐库路径前缀 | 同一文件在 Plex 运行环境中的路径根，仅用于路径换算；不会上传或复制文件 |
| 下载歌词 | 是否下载 .lrc 歌词文件 |
| 写入元数据 | 是否写入 ID3/FLAC 标签 |
| 嵌入封面 | 是否在音频文件中嵌入封面图 |

> 如果 Plex 运行在另一台主机，下载目录必须通过 SMB/NFS/容器卷等方式与 Plex 的音乐库共享同一份文件，或由独立流程负责复制。Plex API 扫描只会索引 Plex 主机已经可见的文件。

### 同步策略

| 配置项 | 说明 |
|--------|------|
| 同步间隔 | 全局默认自动同步间隔（分钟），建议 30-60；单个来源可覆盖，留空则继承 |
| 歌曲上限 | 每次同步处理的歌曲数量 |
| 启用自动同步 | 开关 |
| 未验证媒体处理方式 | 默认“下载独立托管副本”；也可改为“等待手动选择”，再从同步源歌曲上下文明确接管 Plex 媒体或触发托管下载 |

人工接管始终优先，已验证的 YunPlex 托管媒体继续按精确路径复用。选择自动托管时，下载完成后只通过精确文件路径定位 Plex 项；选择等待手动处理时，同步保持待选择状态。失败或尚未索引时保留旧歌单条目，不使用元数据候选替代。

### 自动化验收

```bash
# 受控媒体身份与删除保护
pnpm acceptance:media-reuse

# 来源调度、重启恢复和串行执行
pnpm acceptance:auto-sync

# 独立临时数据库上的 Chromium 关键旅程
pnpm exec playwright install chromium
pnpm test:browser
```

浏览器测试使用独立生成的临时数据库，测试服务退出后自动清理；不会读取或修改项目的 `data/data.db`。真实 Plex scraper、共享路径和网易云下载
仍按 [真实环境验收手册](docs/external-acceptance.md) 操作。

## API 接口

所有接口返回统一格式：

```json
{ "code": 0, "msg": "ok", "data": {} }
```

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/config | 获取配置（敏感字段脱敏） |
| PUT | /api/config | 保存配置 |
| GET | /api/config/defaults | 获取默认配置 |
| POST | /api/config/test-connection | 测试连接 |
| POST | /api/sync/trigger | 按来源接受请求，返回逐来源结果（`{ mode: "normal" | "preview" | "full" }`） |
| POST | /api/playlist-sources/:id/sync | 单来源请求，忙时拒绝；返回请求、分析或等待确认状态 |
| GET | /api/source-requests/:id | 查询实际来源请求状态和关联 Run |
| POST | /api/playlist-sources/:id/initialization/restart | 携带当前 `initializationId` 原子重新分析，过期草案返回冲突 |
| POST | /api/playlist-sources/:id/initialization/commit | 携带 `initializationId` 幂等提交，返回实际后续请求 ID |
| GET | /api/sync/status | 查询同步状态 |
| POST | /api/sync/cancel | 取消当前来源请求及同批未执行请求，不取消共享文件任务 |
| GET | /api/logs | 查询日志（参数 `level`, `limit`） |
| DELETE | /api/logs | 清空日志 |
| GET | /api/system/health | 健康检查 |
| GET | /api/system/info | 系统信息 |

## 项目文档

- [项目路线图](ROADMAP.md)：当前能力、优先级、验收标准和后续开发顺序。
- [文档索引](docs/README.md)：当前架构、同步流程、比较决策和 ADR。
- [领域词汇](CONTEXT.md)：同步、身份、媒体和 Plex occurrence 的统一术语。

## 旧项目

本项目的旧版 CLI 工具（yunplex）保留在 `../yunplex` 目录，功能稳定可作保底使用。
