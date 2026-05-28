import { success } from '../../lib/response'
import { getDataDir } from '../../lib/config/store'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

function platformLabel(): string {
  const p = process.platform
  if (p === 'darwin') return 'macOS'
  if (p === 'win32') return 'Windows'
  if (isDocker()) return 'Linux (Docker)'
  return 'Linux'
}

function isDocker(): boolean {
  try {
    return existsSync('/.dockerenv') ||
      (existsSync('/proc/1/cgroup') && readFileSync('/proc/1/cgroup', 'utf-8').includes('docker'))
  } catch { return false }
}

export default defineEventHandler(() => {
  const dataDir = getDataDir()

  return success({
    version: '0.1.0',
    nodeVersion: process.version,
    dataDir: resolve(dataDir),
    dbFile: resolve(dataDir, 'data.db'),
    platform: platformLabel(),
    docker: isDocker(),
  })
})
