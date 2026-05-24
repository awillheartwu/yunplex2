# YunPlex2

将网易云音乐歌单同步到 Plex 媒体服务器的 Web 管理工具。

## 功能

- **Web 管理面板** -- 可视化管理配置、触发同步、查看状态
- **定时同步** -- 按设定间隔自动同步网易云歌单到 Plex
- **手动同步** -- 支持手动触发及 dry-run 预览模式
- **日志追踪** -- 同步任务日志落盘，支持按级别过滤查看
- **文件标签** -- 下载歌曲时写入 ID3/FLAC 元数据和封面
- **Docker 部署** -- 单容器 Docker Compose 部署，配置持久化

## 项目结构

```
YunPlex2/
├── server/
│   ├── api/           # API 路由（配置、同步、日志、系统）
│   ├── lib/           # 核心逻辑（config store、log store、sync service）
│   └── plugins/       # Nitro 插件（sync daemon）
├── pages/             # 前端页面（仪表盘、配置、日志、任务、系统）
├── components/        # Vue 组件
├── composables/       # 可组合函数
├── assets/css/        # 全局样式
├── data/              # 运行时数据目录
│   └── data.db        # SQLite 数据库（配置 + 日志）
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 本地开发

### 前置要求

- Node.js 22+
- pnpm

### 安装与启动

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

开发服务器默认运行在 `http://localhost:3000`。

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

所有配置通过 Web 管理面板操作，页面路径：**配置**。

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
| 下载歌词 | 是否下载 .lrc 歌词文件 |
| 写入元数据 | 是否写入 ID3/FLAC 标签 |
| 嵌入封面 | 是否在音频文件中嵌入封面图 |

### 同步策略

| 配置项 | 说明 |
|--------|------|
| 同步间隔 | 自动同步间隔（分钟），建议 30-60 |
| 歌曲上限 | 每次同步处理的歌曲数量 |
| 启用自动同步 | 开关 |

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
| POST | /api/sync/trigger | 触发同步（可选 `{ dryRun: true }`） |
| GET | /api/sync/status | 查询同步状态 |
| POST | /api/sync/cancel | 取消正在运行的同步 |
| GET | /api/logs | 查询日志（参数 `level`, `limit`） |
| DELETE | /api/logs | 清空日志 |
| GET | /api/system/health | 健康检查 |
| GET | /api/system/info | 系统信息 |

## 旧项目

本项目的旧版 CLI 工具（yunplex）保留在 `../yunplex` 目录，功能稳定可作保底使用。
