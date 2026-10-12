# 运维手册

应用运行在单台 NAS 上，使用一个 Nitro 进程和一个 SQLite 数据目录。当前 CI 配置见 [.forgejo/workflows/ci.yml](../.forgejo/workflows/ci.yml)。

## CI 与部署

- 推送 `dev`、`main`、仓库内 PR 和手动触发运行质量检查：`pnpm check:ci`。
- 页面测试在本地手动运行，CI 不安装浏览器。
- 推送 `main` 或在 `main` 手动触发，检查通过后会构建并部署 NAS 镜像。
- 镜像用完整提交 SHA 标记，按 NAS 自身架构在本机 Docker 中构建和保存。临时卷测试通过后才更新应用。

runner 使用 `self-hosted`、`linux`、`docker` 标签，网络沿用 `core-net`。当前 runner 的 `docker_host` 会自动把宿主 Docker socket 挂到每个 job，工作流不重复挂载。`privileged: false` 不能收回 socket 的宿主管理权限；因此这台 runner 只能执行受信任代码，工作流排除了 fork PR。代码没有上传应用数据或备份的步骤。

工作流使用 Node 24 镜像，runner 复用 NAS 已保存的镜像，缺失时才拉取。通过 Corepack 按 package.json 启用 pnpm，安装使用 lockfile。唯一远程 action 是固定提交的官方 checkout。

部署工具使用固定摘要的官方 `docker:27.5.1-cli` 镜像，内含 Docker 27.5.1 和 Compose 2.33.0。首次缺失时由 NAS 拉取，之后直接从本地镜像复制两个命令到 job；临时容器只用于取文件，用完删除。无需配置 Actions 缓存或新增变量、密钥，工具也不进入应用镜像。

构建优先复用 NAS 上的 `node:24-alpine` 镜像，缺失时才拉取。需要更新基础镜像时，在 NAS 执行 `docker pull node:24-alpine`；拉取失败时先检查 NAS Docker 的网络、代理或镜像加速配置。

本地复现和测试方法见[测试说明](../tests/README.md)。

## NAS 配置与首次安装

在 Forgejo 仓库的 Actions Variables 配置实际路径和运行身份：

| 变量                           | 用途                                             |
| ------------------------------ | ------------------------------------------------ |
| `NAS_APP_ROOT`                 | 应用专用目录，格式为 `/volumeN/docker/reyunplex` |
| `NAS_MUSIC_DIR`                | 已存在的音乐目录，容器中映射为 `/mnt/nas`        |
| `NAS_PORT`                     | 网页端口，默认 `3210`，映射到容器的 `3000`       |
| `NAS_BIND_ADDRESS`             | 监听地址，默认 `0.0.0.0`                          |
| `NAS_UID`、`NAS_GID`           | 非 root 应用运行用户，需要音乐目录读写权限       |

路径、UID 和 GID 必须配置，没有个人机器默认值。容器配置见 [deploy/nas.compose.yml](../deploy/nas.compose.yml)。应用目录的父目录需要先存在；部署不会替音乐目录修改权限。

1. 配好 runner、变量和目录权限，将检查通过的代码合入 `main`。
2. 等部署完成，打开 `http://NAS地址:3210`（设置了 `NAS_PORT` 则用该端口），在向导设置管理员、网易云、Plex 和下载路径。
3. 用少量歌曲确认真实下载和 Plex 歌单更新，再开启自动同步。

网易云 Cookie、Plex Token 和管理员设置保存在 SQLite 中，由向导和设置页管理。下载目录与 Plex 路径前缀对应同一批文件，配置方法见[项目首页](../README.md)。下载目录填应用容器内的路径，默认 `/mnt/nas`；`NAS_MUSIC_DIR` 是挂载到这里的宿主目录。Plex 路径前缀填 Plex 自己看到的音乐根目录，只做路径换算，不传输文件。

应用目录包含：

```text
data/data.db          # 数据、配置和凭据，运行时另有 WAL/SHM
backups/              # 升级前备份
compose.yml、.env      # 部署使用的容器配置
deployment.json       # 部署状态、镜像版本和备份位置
.reyunplex-root.json  # 目录与运行身份记录
```

应用以非 root 用户运行，根文件系统只读，数据和音乐目录可写。数据目录权限为 0700。更改运行身份前先停机备份并核对目录属主。

## 升级与失败处理

升级同样通过 `main` 的部署任务执行：

```text
质量检查 → 构建镜像 → 临时卷测试 → 取得部署锁
→ 停应用 → 备份并校验 → 启动新镜像 → 等待 /api/system/ready
```

Forgejo 12 不支持 `concurrency`。检查与构建可以被新推送取消；开始升级后，独立的 `reyunplex-deploy-worker` 容器会完成备份、启动和就绪检查，取消 Actions 等待任务不会停止它。下次部署会等待前一次完成。部署锁防止同时操作数据目录；不同提交之间只允许向前更新，同一提交可以重新执行。

- 新程序尚未启动就失败：脚本尝试恢复已停止的原实例。
- 新程序启动失败或未就绪：保留备份和原镜像，记录失败并停机；Actions 输出会显示 Docker 错误和容器启动原因，再结合 `deployment.json` 排查。
- Actions 任务中断：用 `docker logs reyunplex-deploy-worker` 和 `deployment.json` 确认实际结果。若 NAS 或 Docker 本身中断，先确认容器状态，再处理留下的部署锁。

数据库不会自动回滚。需要恢复时，停机并使用备份对应的镜像与数据库；数据库恢复不能撤销已发生的 Plex 或音乐文件修改。

## 资源与保留

工作流、构建、测试、应用和维护容器均不设置内存或 CPU 上限。Vitest 最多两个 worker；runner 的 `capacity: 2` 允许两个仓库任务一起运行，可改为 `capacity: 1` 减少同时占用。

实际内存占用由歌单规模、下载和标签写入决定。Docker 测试输出就绪后的内存；它不能代表真实下载时的峰值。镜像超过 256 MiB 会使 CI 失败；镜像只包含生产包和维护工具，并移除网易云依赖附带的网页、截图和示例。

部署成功后保留最新三个完整 SHA 镜像，以及所有容器仍在使用的镜像和上一版镜像；只清理本项目标记且超过七天的闲置构建缓存。升级备份保留最新三份，并保护本次升级备份。日志最多三个 10 MiB 文件。清理不使用全局 `docker prune`，不处理其他项目、数据卷或音乐文件。

## 备份与恢复

NAS 自动部署每次升级前会把应用数据备份到 `backups/`。备份包含凭据，只保存在私有目录，音乐文件需要另行备份。

本机 [docker-compose.yml](../docker-compose.yml) 的容器名是 `yunplex2`，可用 [scripts/maintenance.sh](../scripts/maintenance.sh) 手动维护。应用应先停止，`/app/data` 使用 bind mount，备份目录放在数据目录之外：

手动 Compose 默认以 UID/GID `1000:1000` 运行，也可设置 `YUNPLEX2_UID`、`YUNPLEX2_GID`。启动前让该用户可以读写数据目录和音乐挂载。

```sh
docker compose stop yunplex2
sh scripts/maintenance.sh backup /path/to/backups
sh scripts/maintenance.sh verify /path/to/backups/reyunplex-时间戳
sh scripts/maintenance.sh restore /path/to/backups/reyunplex-时间戳
docker compose start yunplex2
```

维护工具核对文件校验和，并在临时副本上检查 SQLite。恢复时先校验备份再替换目录，原目录保留为 `data.before-restore-时间戳`。NAS 自动部署的容器名是 `reyunplex`，由部署脚本处理备份，不使用上述固定容器名命令。

## 诊断

系统状态页显示依赖、进程资源和日志。`/api/system/health` 检查进程存活，`/api/system/ready` 检查数据库和后台任务是否就绪；首次安装可以正常显示向导。

NAS 日志在应用目录执行：

```sh
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail 80 yunplex2
```

在有完整源码和依赖的工作区，可用以下命令诊断数据库与来源。第一条只读，第二条默认预览；只有显式加 `--apply` 才实际同步：

```bash
pnpm diagnose:auto-sync -- --data-dir /path/to/data
pnpm diagnose:sync-source -- --source <SOURCE_ID> --runs 2
```

真实 NAS、网易云与 Plex 的验证事项见[待办](../ROADMAP.md)。
