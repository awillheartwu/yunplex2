import type { SongStatus } from '../job/types'
import type { RunBuilder } from '../run/builder'
import { classifyErrorCode } from '../domain-error'
import { pendingPlaylistWrite } from './playlist-write-state'

/** File completion alone does not prove playlist membership and order. */
export function beginPlaylistSongConfirmation(job: RunBuilder, sourceId: string) {
  const awaiting = new Map<string, SongStatus>()
  const songs = new Map(job.getRun().songs.map(song => [song.id, song]))
  for (const song of songs.values()) {
    if (song.sourceId !== sourceId || typeof song.neteaseIndex !== 'number'
      || !['success', 'skipped_existing', 'pending'].includes(song.status)) continue
    awaiting.set(song.id, song.status === 'skipped_existing' ? 'skipped_existing' : 'success')
    job.updateSong(song.id, { status: 'pending', phase: 'plex_insert' })
  }
  return {
    confirm(ids: Iterable<string>) {
      const current = new Map(job.getRun().songs.map(song => [song.id, song]))
      for (const id of ids) {
        const status = awaiting.get(id)
        if (!status || current.get(id)?.status !== 'pending') continue
        job.updateSong(id, { status, phase: 'done', error: undefined })
        awaiting.delete(id)
      }
    },
    defer(error?: unknown) {
      const code = classifyErrorCode(error, pendingPlaylistWrite(sourceId) ? 'plex_write_uncertain' : 'failed_plex_insert')
      const current = new Map(job.getRun().songs.map(song => [song.id, song]))
      for (const id of awaiting.keys()) {
        if (current.get(id)?.status !== 'pending') continue
        job.updateSong(id, { status: 'awaiting_retry', phase: 'plex_insert', error: {
          title: '歌单结果尚未确认', code, stage: 'plex_insert',
          message: error instanceof Error ? error.message : '文件处理结果已保留，歌单成员与顺序仍需重新核对',
        } })
      }
    },
  }
}
