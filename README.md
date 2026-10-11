# reYunPlex

把网易云歌单和专辑保存为本地音乐，并更新 Plex 歌单。网页里可以管理收藏、下载歌曲、确认已有媒体、查看任务和调整设置。

## 启动

需要 Node.js 24 和 pnpm 10.33.0，版本分别由 `.nvmrc` 和 `package.json` 指定。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://localhost:3001`，按向导设置管理员密码、网易云 Cookie、Plex 连接和下载目录。配置保存在 `data/data.db`。

生产运行：

```bash
pnpm build
pnpm start
```

本机 Docker Compose：

```bash
docker compose up -d --build
```

先修改音乐挂载路径，并让运行用户能读写数据和音乐目录。默认 UID/GID 为 `1000:1000`，端口为 3000；变量和资源限制见 [docker-compose.yml](docker-compose.yml)，NAS 自动部署见[运维手册](docs/operations.md)。

## 怎么用

1. 在「音乐库」添加网易云歌单或专辑。
2. 首次同步歌单时，如果开启了媒体接管，先在来源详情确认已有 Plex 媒体的使用方案。
3. 启动同步，在「活动」查看下载、扫描和歌单更新结果；需要时再开启自动同步。
4. 临时下载歌单、专辑或单曲，用「添加音乐」。它负责保存文件，不直接修改 Plex 歌单。
5. 在「偏好设置」调整音质、歌词、标签、同步间隔和界面外观；连接与资源问题到「系统状态」查看。

下载目录与 Plex 音乐库必须指向同一批文件。Plex 在另一台主机时，需要先配置 SMB、NFS 或共享卷；「Plex 路径前缀」只换算路径，不传输文件。

同步按文件的准确路径或你的手动选择使用已有媒体。无法确认的歌曲可以下载独立副本，也可以等待手动处理。歌单增删只改变 Plex 歌单条目，不删除音乐文件。

## 开发与测试

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm check:ci
```

所有测试和测试工具放在 `tests/`。测试方法见[测试说明](tests/README.md)，模块位置见[代码结构](docs/architecture.md)。

## 文档

- [同步与下载](docs/sync-flow.md)
- [首次接管与匹配设置](docs/initialization-matching.md)
- [运维手册](docs/operations.md)
- [界面规范](docs/design-system.md)
- [待办](ROADMAP.md)
