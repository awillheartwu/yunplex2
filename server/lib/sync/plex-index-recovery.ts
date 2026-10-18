import { createHash } from 'node:crypto'
import type { AppConfig } from '../config/types'

export function plexRecoveryConfigFingerprint(config: AppConfig): string {
  return createHash('sha256').update(JSON.stringify([config.plex, config.download.dir,
    config.download.plexLibraryPathPrefix, config.sync.songLimit])).digest('hex')
}
