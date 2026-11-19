import { dirname } from 'node:path'
import { readConfigFromDb } from '../db'
import { withExternalRequestSignal } from '../external-request-context'
import { appendLog } from '../log/store'
import { refreshPath } from '../plex-client'
import { emitEvent } from '../sync/events'
import { mapLocalPathToPlex } from '../sync/path-map'

/** Request scanning after the tagged media and its successful task state have been saved. */
export async function scanManagedDownload(songName: string, filePath: string): Promise<void> {
  let entry: Parameters<typeof appendLog>[0]
  try {
    const cfg = readConfigFromDb()
    if (!cfg.plex.server || !cfg.plex.token || !cfg.plex.section) throw new Error('请先配置 Plex 音乐库')
    const plexPath = mapLocalPathToPlex(filePath, cfg)
    if (!plexPath) throw new Error('无法换算 Plex 文件路径，请检查路径映射')
    await withExternalRequestSignal(AbortSignal.timeout(30_000), () => refreshPath(cfg.plex, dirname(plexPath)))
    entry = { level: 'info', stage: 'refreshing_plex', message: `「${songName}」已保存，已请求 Plex 扫描所在目录` }
  } catch (error) {
    entry = {
      level: 'warn', stage: 'refreshing_plex', message: `「${songName}」文件已保存，但未能确认 Plex 收到扫描请求`,
      detail: error instanceof Error ? error.message : undefined,
    }
  }
  // Scan and log failures do not turn a completed audio write into a retry.
  try {
    const logged = appendLog(entry)
    emitEvent({ type: 'log', data: { ...logged }, timestamp: logged.timestamp })
  } catch { /* The file has already been saved. */ }
}
