import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'

const getSource = vi.fn()
const listPlaylistSourceTrackOccurrences = vi.fn()
const runDownloadBatch = vi.fn()

vi.mock('~~/server/lib/playlist/store', () => ({ getSource }))
vi.mock('~~/server/lib/sync/match-management-store', () => ({ listPlaylistSourceTrackOccurrences }))
vi.mock('~~/server/lib/config/store', () => ({ readConfig: () => structuredClone(DEFAULT_CONFIG) }))
vi.mock('~~/server/lib/download/download-batch', () => ({ runDownloadBatch }))

describe('managed media command', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getSource.mockReturnValue({
      id: 'source-one',
      name: '测试歌单',
      neteasePlaylistName: '测试歌单',
    })
    listPlaylistSourceTrackOccurrences.mockReturnValue([{ neteaseSongId: 123 }])
    runDownloadBatch.mockResolvedValue({ batchId: 'batch-one', total: 1 })
  })

  it('preserves Playlist Source context and requests a managed copy', async () => {
    const { startManagedSongDownload } = await import('~~/server/lib/download/managed-media-command')

    await expect(startManagedSongDownload({ sourceId: 'source-one', neteaseSongId: 123 }))
      .resolves.toEqual({ batchId: 'batch-one', total: 1 })
    expect(runDownloadBatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'songs',
      songIds: [123],
      sourceContext: { id: 'source-one', name: '测试歌单 · 下载并托管' },
      config: expect.objectContaining({
        target: { kind: 'computed', requireManagedCopy: true },
      }),
    }))
  })

  it('rejects songs that are no longer current in the source', async () => {
    listPlaylistSourceTrackOccurrences.mockReturnValue([])
    const { startManagedSongDownload } = await import('~~/server/lib/download/managed-media-command')

    await expect(startManagedSongDownload({ sourceId: 'source-one', neteaseSongId: 123 }))
      .rejects.toThrow('这首歌已不在当前同步源中')
    expect(runDownloadBatch).not.toHaveBeenCalled()
  })
})
