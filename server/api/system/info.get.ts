import { success } from '../../lib/response'
import { getDataDir } from '../../lib/config/store'
import { resolve } from 'node:path'

export default defineEventHandler(() => {
  const dataDir = getDataDir()

  return success({
    version: '0.1.0',
    nodeVersion: process.version,
    dataDir: resolve(dataDir),
    dbFile: resolve(dataDir, 'data.db'),
    platform: process.platform,
    dockerHint: '如果使用 Docker，请确保 /app/data 目录已挂载到宿主机以持久化数据',
  })
})
