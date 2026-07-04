import { describe, expect, it } from 'vitest'
import { markPlexReorderFailures } from '../../server/lib/sync/reorder-failure-reporting'
import type { SongTask } from '../../server/lib/job/types'

function makeJob() {
  const updates: Array<{ songId: string; update: Partial<Pick<SongTask, 'status' | 'phase' | 'error'>> }> = []
  return {
    updates,
    updateSong(songId: string, update: Partial<Pick<SongTask, 'status' | 'phase' | 'error'>>) {
      updates.push({ songId, update })
    },
  }
}

describe('reorder failure reporting', () => {
  it('marks insert failures by Plex rating key', () => {
    const job = makeJob()

    const count = markPlexReorderFailures(job, [
      { action: 'insert', ratingKey: 'rating-1', message: 'insert failed' },
    ], {
      ratingKeyToSongId: new Map([['rating-1', 'song-task-1']]),
    })

    expect(count).toBe(1)
    expect(job.updates).toEqual([
      {
        songId: 'song-task-1',
        update: {
          status: 'failed_plex_insert',
          phase: 'plex_insert',
          error: {
            title: 'Plex 歌单插入失败',
            message: 'insert failed',
            stage: 'plex_insert',
            context: {
              action: 'insert',
              ratingKey: 'rating-1',
              playlistItemId: undefined,
            },
          },
        },
      },
    ])
  })

  it('marks move failures by playlist item id', () => {
    const job = makeJob()

    const count = markPlexReorderFailures(job, [
      { action: 'move', playlistItemId: 42, message: 'move failed' },
    ], {
      playlistItemIdToRatingKey: new Map([[42, 'rating-2']]),
      ratingKeyToSongId: new Map([['rating-2', 'song-task-2']]),
    })

    expect(count).toBe(1)
    expect(job.updates[0]).toMatchObject({
      songId: 'song-task-2',
      update: {
        status: 'failed_plex_insert',
        phase: 'plex_insert',
        error: {
          title: 'Plex 歌单排序失败',
          message: 'move failed',
        },
      },
    })
  })

  it('marks remove failures against the pending removed track task', () => {
    const job = makeJob()

    const count = markPlexReorderFailures(job, [
      { action: 'remove', playlistItemId: 99, ratingKey: 'extra-rating', message: 'remove failed' },
    ], {
      playlistItemIdToRemovedSongId: new Map([[99, 'removed-task']]),
    })

    expect(count).toBe(1)
    expect(job.updates[0]).toMatchObject({
      songId: 'removed-task',
      update: {
        status: 'failed_plex_insert',
        phase: 'plex_insert',
        error: {
          title: 'Plex 歌单移除失败',
          message: 'remove failed',
        },
      },
    })
  })
})
