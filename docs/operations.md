# 运维手册

本文面向部署维护者。首次安装入口见[项目首页](../README.md#快速开始)；这里说明配置、CI、升级、恢复和诊断。应用以单个 Nitro 进程运行，每个实例使用独立的 SQLite 数据目录。

## 配置与访问

网易云 Cookie、Plex Token 和业务设置保存在 SQLite 中，管理员密码保存为哈希。业务环境变量仅在配置表为空时导入，已有实例应在网页修改设置；修改 Compose 中的下载目录初值或同步开关不会覆盖已保存配置。源码入口见 [config-seed.ts](../server/lib/db/config-seed.ts)。

| 参数                                                                                  | 生效方式                                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `NUXT_DATA_DIR`                                                                       | 每次启动决定数据目录，源码默认 `./data`，容器为 `/app/data`。     |
| `NITRO_HOST`、`NITRO_PORT`                                                            | 生产服务监听地址与端口；容器内部使用 `0.0.0.0:3000`。             |
| `YUNPLEX2_DOWNLOAD_DIR`、`YUNPLEX2_PLEX_LIBRARY_PATH_PREFIX`、`YUNPLEX2_SYNC_ENABLED` | 空数据库的业务初值，之后由网页管理。                              |
| `YUNPLEX2_TRUSTED_PROXIES`                                                            | 每次启动读取的可信代理 IP/CIDR 列表，逗号分隔，默认不信任转发头。 |
| `YUNPLEX2_ADMIN_RESET_TOKEN`                                                          | 临时启用管理员密码重置，使用后该令牌失效。                        |

Compose 的 `.env` 用于替换模板变量，额外运行参数必须在服务的 `environment` 中显式传入。使用反向代理时保留原始 `Host`，正确设置 `X-Forwarded-Proto` 和 `X-Forwarded-For`，并只将实际代理地址加入可信列表。需要外部访问时由反向代理提供 HTTPS，应用端口按实际网络限制访问范围。

忘记管理员密码时，给应用临时传入自行生成的高强度 `YUNPLEX2_ADMIN_RESET_TOKEN` 并重建容器，在登录页使用该令牌重置密码。重置会撤销全部会话；完成后移除环境变量并重建容器。正常修改密码使用偏好设置，不删除数据库或管理员表。

## CI 与部署

- 推送 `dev`、`main`、仓库内 PR 和手动触发运行质量检查：`pnpm check:ci`。
- 页面测试在本地手动运行，CI 不安装浏览器。
- 推送 `main` 或在 `main` 手动触发，检查通过后会构建并部署 NAS 镜像。
- 镜像用完整提交 SHA 标记，按 NAS 自身架构在本机 Docker 中构建和保存。临时卷测试通过后才更新应用。

工作流见 [.forgejo/workflows/ci.yml](../.forgejo/workflows/ci.yml)。runner 需要 `self-hosted`、`linux`、`docker` 标签及宿主 Docker socket 访问权。它只能执行受信任代码，工作流排除了 fork PR；关闭 privileged 也不能收回 Docker socket 提供的宿主管理权限。

质量检查、NAS 部署和 GHCR 分发任务使用 Node 24 Trixie 镜像，安装后先核验 FLAC 原生模块可加载。质量检查通过 Corepack 按 `package.json` 启用 pnpm，并按 lockfile 安装。远程 checkout action 固定到提交，runner 的网络、镜像拉取策略与并行任务数由部署者配置。

部署工具使用固定摘要的官方 `docker:27.5.1-cli` 镜像，内含 Docker 27.5.1 和 Compose 2.33.0。首次缺失时由 NAS 拉取，之后直接从本地镜像复制两个命令到 job；临时容器只用于取文件，用完删除。工具本身不需要 Actions 缓存或密钥，也不进入应用镜像；GHCR 分发的凭据单独配置。

构建优先复用 NAS 上的 `node:24-alpine` 镜像，缺失时才拉取。需要更新基础镜像时，在 NAS 执行 `docker pull node:24-alpine`；拉取失败时先检查 NAS Docker 的网络、代理或镜像加速配置。

本地复现和测试方法见[测试说明](../tests/README.md)。

## 正式发版与 GHCR 分发

版本以 `package.json` 为准，基线是 `2.0.9`。侧栏和系统信息显示版本与构建 SHA。正式发版是一批通过验收的交付，不是每次开发提交；本地镜像仍使用 `reyunplex:<完整 SHA>`。`commit-and-tag-version` 负责准备版本和 `CHANGELOG.md`，NAS 部署和公开分发分别执行。

1. 在 `dev` 开发，按[版本收尾](../tests/README.md#版本收尾)完成检查，由用户验收功能。
2. 用户明确授权本次发版、提交、推送和 NAS 部署后，先提交本版改动，确认 `dev` 工作区干净并已取得已有 release tags。首次使用 `pnpm release:first --dry-run` 预览，再执行 `pnpm release:first`；保留 `package.json` 当前版本，生成变更日志和 release commit，不创建 tag。以后使用 `pnpm release:patch`、`release:minor`、`release:major`；`pnpm release` 可根据规范提交推荐提升级别。首次发版不能用普通 patch 命令。
3. 审阅变更日志、版本号与提交范围；核对更新后的生产构建。不要把首次生成的完整提交列表直接当成最终用户说明，应整理为本版实际交付内容。
4. 合入 `main`，确认没有未提交改动，运行 `pnpm release:tag`。它只为当前版本创建带注释的 `v<版本>`，指向最终 main 提交；已有 tag 指向其他提交时拒绝覆盖。将 main 的发布合并同步回 dev，保留后续开发的共同历史。
5. 只推送 main 到负责 NAS 部署的远端，触发现有 CI、镜像验证、备份和部署。本次正式 tag 暂留本地，不能与 main 一起推送。
6. 分别检查 CI、NAS 就绪、页面版本与 SHA，以及真实业务结果。部署通过不代表用户最终确认 release。
7. 用户最终确认本次 release 并授权公开分发后，只推送对应的正式 tag，例如 `git push <远端> refs/tags/v2.0.9`，自动触发 **Publish accepted YunPlex image to GHCR**。推 tag 代表分发确认，任务会复用已验收镜像并最后更新 `latest`。失败时可从 `main` 手动重试，输入同一 `tag`；仅重试固定标签时可关闭 `update_latest`，目标仍须是当前已验收的 NAS 部署。不要推送全部 tags。
8. 在 GitHub 包设置确认 GHCR 包为 public，用无凭据客户端按固定版本拉取并运行，核对 digest、架构、初始化、持久化和重启，再宣布分发完成。同步将 README 中的镜像占位地址替换为实际分发地址，并给出固定版本入口。

分发由 [.forgejo/workflows/publish.yml](../.forgejo/workflows/publish.yml) 调用 [publish.mjs](../scripts/release/publish.mjs)，只发布 `linux/amd64`，使用与 NAS 部署相同的 Docker daemon。它核对 tag 与代码版本、镜像 OCI labels、正在运行的镜像 ID、`deployment.json` 的 ready 状态和实时就绪接口；不会构建镜像、替换容器或写应用数据。目标镜像缺失、部署未完成或版本不符时停止，重新构建需要重新验收。

GHCR 标签包括固定版本（例如 `2.0.9`）、`sha-<完整 SHA>` 以及可移动的 `latest`。推送前检查两个固定标签，已有不同内容时拒绝覆盖；相同内容可安全重试。先推 SHA 与版本并核对远端 manifest digest，再更新 latest；已有更高版本时拒绝降低 latest。失败可能已留下固定标签，重试同一 tag 即可，不删除远端镜像或移动 Git tag。

分发使用独立的 `reyunplex-publish-lock` 容器锁，临时 GHCR 本地别名与登录目录在正常退出或失败时清理。任务被强制取消可能留下锁；确认发布任务及 Docker push 已结束后，只清理本次发布锁和临时别名再重试，不处理部署锁或生产容器。GHCR 上的历史正式版本不受 NAS 本地保留策略影响。

在 Forgejo 仓库配置：

| 类型     | 名称            | 用途                                                             |
| -------- | --------------- | ---------------------------------------------------------------- |
| Variable | `GHCR_IMAGE`    | 小写镜像地址，例如 `ghcr.io/你的账号/yunplex`，不含 tag          |
| Variable | `NAS_APP_ROOT`  | 沿用 NAS 部署的应用目录                                          |
| Secret   | `GHCR_USERNAME` | 有权发布到上述账号或组织的 GitHub 用户名                         |
| Secret   | `GHCR_TOKEN`    | GitHub classic PAT，授予 `write:packages`；组织启用 SSO 时需授权 |

令牌只用于分发步骤，不放入源码、构建参数或应用环境。首次接通时验证 NAS 到 GHCR 的网络及发布权限；公共镜像匿名拉取和实际运行另行验收。使用者的部署方式见[项目首页](../README.md#使用-ghcr-镜像)。

首次接通可先手动运行 GHCR 工作流：选择 `dev` 或 `main`，在 `tag` 填 `test-<NAS 当前已验收的完整提交 SHA>`。流程复用正在运行的 NAS 镜像，只推送 `test-<SHA 前 12 位>`，强制保留正式版本和 `latest` 标签；上传后以配置的账号拉取并核对镜像 ID，再用临时卷验证启动、SQLite、标签读写和重启。测试不创建 Git tag，也不重新构建或替换 NAS 应用；镜像包的公开可见性仍需单独确认。

## NAS 配置与首次安装

在 Forgejo 仓库的 Actions Variables 配置实际路径和运行身份：

| 变量                 | 用途                                             |
| -------------------- | ------------------------------------------------ |
| `NAS_APP_ROOT`       | 应用专用目录，格式为 `/volumeN/docker/reyunplex` |
| `NAS_MUSIC_DIR`      | 已存在的音乐目录，容器中映射为 `/mnt/nas`        |
| `NAS_PORT`           | 网页端口，默认 `3210`，映射到容器的 `3000`       |
| `NAS_BIND_ADDRESS`   | 监听地址，默认 `0.0.0.0`                         |
| `NAS_UID`、`NAS_GID` | 非 root 应用运行用户，需要音乐目录读写权限       |

路径、UID 和 GID 必须配置，没有个人机器默认值。容器配置见 [deploy/nas.compose.yml](../deploy/nas.compose.yml)。应用目录的父目录需要先存在；部署不会替音乐目录修改权限。

1. 配好 runner、变量和目录权限，按[项目分支与发布规范](../AGENTS.md#分支与发布)合入并推送 `main`。
2. 等部署完成，打开 `http://NAS地址:3210`（设置了 `NAS_PORT` 则用该端口），在向导设置管理员、网易云、Plex 和下载路径。
3. 用少量歌曲确认真实下载和 Plex 歌单更新，再开启自动同步。

下载目录填应用容器内的路径，默认 `/mnt/nas`；`NAS_MUSIC_DIR` 是挂载到这里的宿主目录。Plex 路径前缀填 Plex 自己看到的音乐根目录。共享文件和路径换算的区别见[运行前准备](../README.md#运行前准备)。

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

部署互斥由宿主容器锁负责。检查与构建可以被取消；开始升级后，独立的 `reyunplex-deploy-worker` 容器会完成备份、启动和就绪检查，取消 Actions 等待任务不会停止它。下次部署会等待前一次完成。部署锁防止同时操作数据目录；不同提交之间只允许向前更新，同一提交可以重新执行。

- 新程序尚未启动就失败：脚本尝试恢复已停止的原实例。
- 新程序启动失败或未就绪：保留备份和原镜像，记录失败并停机；Actions 输出会显示 Docker 错误和容器启动原因，再结合 `deployment.json` 排查。
- Actions 任务中断：用 `docker logs reyunplex-deploy-worker` 和 `deployment.json` 确认实际结果。若 NAS 或 Docker 本身中断，先确认容器状态，再处理留下的部署锁。

数据库不会自动回滚。需要恢复时，按[备份与恢复](#备份与恢复)停机并使用备份对应的镜像与数据库；数据库恢复不能撤销已发生的 Plex 或音乐文件修改。

## 资源与保留

仓库中的工作流和容器配置未设置内存或 CPU 上限，Vitest 最多两个 worker。runner 并行度与宿主资源限制由部署者管理，不能仅凭单个任务的占用判断总资源预算。

实际内存占用由歌单规模、下载和标签写入决定。Docker 测试输出就绪后的内存；它不能代表真实下载时的峰值。镜像超过 256 MiB 会使 CI 失败；镜像只包含生产包和维护工具，并移除网易云依赖附带的网页、截图和示例。

NAS 部署成功后保留最新三个完整 SHA 镜像，以及所有容器仍在使用的镜像和上一版镜像；只清理本项目标记且超过七天的闲置构建缓存。升级备份保留最新三份，并保护本次升级备份。容器日志最多三个 10 MiB 文件。手动 Compose 和 GHCR 安装不自动执行这套镜像、备份保留策略。

应用自身在启动时和此后每六小时清理过期运行、日志、下载明细、已解决异常及无用音频缓存，期限由偏好设置管理。待处理、已忽略异常以及媒体关联独立保留。宿主清理不使用全局 `docker prune`，不处理其他项目、数据卷或音乐文件。

## 备份与恢复

备份前停止应用，确认没有部署 worker、其他实例或维护命令正在使用同一数据目录。备份整个数据目录，包括可能存在的 SQLite WAL/SHM 和音频缓存；运行中的数据库不能只复制 `data.db`。备份包含凭据，保存到数据目录之外的私有目录；音乐文件另行备份，应用数据备份不会撤销 Plex 歌单或音乐文件变动。

维护工具校验文件清单、哈希和临时副本中的 SQLite。恢复时先校验备份，再在同一父目录准备新数据，保留原目录为 `data.before-restore-时间戳`。恢复必须配对备份时的镜像，不能只回退代码或只恢复数据库；升级前记录原镜像引用或 ID。

### 源码 Compose

根目录 [docker-compose.yml](../docker-compose.yml) 的服务和容器名均为 `yunplex2`，在该 Compose 目录使用 [scripts/maintenance.sh](../scripts/maintenance.sh)。它要求容器已经创建、应用已停止，且 `/app/data` 为 bind mount：

```sh
docker compose stop yunplex2
sh scripts/maintenance.sh backup /path/to/backups
sh scripts/maintenance.sh verify /path/to/backups/reyunplex-时间戳
docker compose start yunplex2
```

只有明确需要恢复时，才在应用停止期间执行 `sh scripts/maintenance.sh restore /path/to/backups/reyunplex-时间戳`，再用备份对应镜像启动。脚本沿用当前容器镜像，因此应先核对它与备份配对。

### GHCR 与 NAS 镜像

先在对应 Compose 目录停止服务，记录当前镜像：

| 安装方式     | 停止命令                                          | 镜像配置                                          |
| ------------ | ------------------------------------------------- | ------------------------------------------------- |
| GHCR         | `docker compose -f ghcr.compose.yml stop yunplex` | `.env` 的 `YUNPLEX_IMAGE`                         |
| NAS 自动部署 | `docker compose -f compose.yml stop yunplex2`     | `.env` 的 `REYUNPLEX_IMAGE`，容器名为 `reyunplex` |

NAS 每次升级前自动生成 `backups/` 和部署记录；需人工恢复时，镜像与备份位置可从 `deployment.json` 核对。

镜像自带 `/app/maintenance/cli.mjs`，可以离线维护，源码包装脚本不直接适用于 GHCR 服务。下面假设数据是应用专用父目录下的 `data/`，先替换镜像和绝对路径；父目录不应包含其他应用或音乐：

```sh
YUNPLEX_MAINT_IMAGE='ghcr.io/你的账号/yunplex:固定版本'
YUNPLEX_MAINT_ROOT=/path/to/yunplex
YUNPLEX_MAINT_BACKUPS=/path/to/yunplex-backups
mkdir -p "$YUNPLEX_MAINT_BACKUPS"
docker run --rm --network none --user 0:0 --entrypoint node \
  --mount "type=bind,source=$YUNPLEX_MAINT_ROOT,target=/maintenance-data" \
  --mount "type=bind,source=$YUNPLEX_MAINT_BACKUPS,target=/backups" \
  "$YUNPLEX_MAINT_IMAGE" /app/maintenance/cli.mjs backup /maintenance-data/data /backups
```

选择刚生成的备份目录，保持 `YUNPLEX_MAINT_IMAGE` 为配对镜像，先独立校验：

```sh
YUNPLEX_MAINT_BUNDLE=/path/to/yunplex-backups/reyunplex-时间戳
docker run --rm --network none --user 0:0 --entrypoint node \
  --mount "type=bind,source=$YUNPLEX_MAINT_BUNDLE,target=/backups,readonly" \
  "$YUNPLEX_MAINT_IMAGE" /app/maintenance/cli.mjs verify /unused /backups
```

需要恢复时，在应用仍停止的情况下执行：

```sh
docker run --rm --network none --user 0:0 --entrypoint node \
  --mount "type=bind,source=$YUNPLEX_MAINT_ROOT,target=/maintenance-data" \
  --mount "type=bind,source=$YUNPLEX_MAINT_BUNDLE,target=/backups,readonly" \
  "$YUNPLEX_MAINT_IMAGE" /app/maintenance/cli.mjs restore /maintenance-data/data /backups
```

将对应 `.env` 的镜像配置改为配对镜像，确认目录权限，再用对应 Compose 文件执行 `up -d`。检查就绪接口、登录和来源记录，再核对 Plex 与实际音频。NAS 自动部署只接受向前的提交；人工恢复旧版后，重新部署前应核对部署记录和后续升级方向。

### 本地 Node 运行

停止应用后，在已安装依赖的源码目录通过 `scripts/maintenance/bundle.mjs` 的 `backup`、`verify`、`restore` 使用同一备份格式。例如创建备份：

```sh
node --input-type=module -e 'import { backup } from "./scripts/maintenance/bundle.mjs"; import { readFile } from "node:fs/promises"; const { version } = JSON.parse(await readFile("package.json", "utf8")); console.log(await backup(process.argv[1], process.argv[2], version))' /path/to/yunplex/data /path/to/yunplex-backups
```

恢复前切换到备份对应版本并安装匹配依赖，在服务停止期间执行；路径指向当前数据目录和选定备份：

```sh
node --input-type=module -e 'import { restore } from "./scripts/maintenance/bundle.mjs"; console.log(await restore(process.argv[2], process.argv[1]))' /path/to/yunplex/data /path/to/yunplex-backups/reyunplex-时间戳
```

## 诊断

系统状态页显示依赖、进程资源和日志。`/api/system/health` 检查进程存活；`/api/system/ready` 检查数据库和后台 worker 是否就绪，未就绪返回 `503`。首次安装的 `setup_required` 表示可进入向导，不代表网易云、Plex 和共享目录已经通过验证。

NAS 日志在应用目录执行：

```sh
docker compose -f compose.yml ps
docker compose -f compose.yml logs --tail 80 yunplex2
```

在有完整源码和依赖的工作区，可用以下命令诊断数据库与来源：

```bash
pnpm diagnose:auto-sync -- --data-dir /path/to/data
pnpm diagnose:sync-source -- --data-dir /path/to/data-copy --source SOURCE_ID --runs 2
```

第一条以只读连接检查队列与调度。SQLite 只读连接仍可能影响 WAL/SHM；需要严格保持原目录不变时，先取得一致的数据副本再诊断。

第二条默认做业务预览，但会打开可写数据库、初始化结构和读取配置，也会访问真实网易云/Plex。它不是只读巡检，应使用完整数据副本；指定来源需已有 Plex 歌单关联。只有显式加 `--apply` 才执行真实下载与歌单修改，此时先确认实例已停止相关任务并取得对应操作授权，避免和后台队列并发执行。

诊断输出可能含来源名称、歌曲信息和文件路径，分享前按内容脱敏。

真实 NAS、网易云与 Plex 的验证事项见[待办](../ROADMAP.md)。
