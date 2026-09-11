import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listSources: vi.fn(),
  createSource: vi.fn(),
  deleteSource: vi.fn(),
  selectDownloadResource: vi.fn(),
  createDownloadCommand: vi.fn(),
  setArtistAliases: vi.fn(),
}))

vi.mock('../playlist/store', () => ({
  listSources: mocks.listSources,
  createSource: mocks.createSource,
  deleteSource: mocks.deleteSource,
}))
vi.mock('./resource-selection', () => ({ selectDownloadResource: mocks.selectDownloadResource }))
vi.mock('./download-command', () => ({ createDownloadCommand: mocks.createDownloadCommand }))
vi.mock('../netease', () => ({ setArtistAliases: mocks.setArtistAliases }))

describe('save source download command', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.listSources.mockReturnValue([])
    mocks.selectDownloadResource.mockResolvedValue({
      type: 'playlist',
      resourceId: 88,
      sourceLabel: 'Playlist',
      songs: [{ id: 1, name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album' } }],
      failures: [],
    })
    mocks.createSource.mockResolvedValue({ id: 'source-one', name: 'Playlist任务' })
    mocks.createDownloadCommand.mockReturnValue({ batchId: 'run-one', total: 1, selectionFailures: [] })
  })

  it('creates a disabled source before persisting source-attributed managed tasks', async () => {
    let sourceCreated = false
    mocks.createSource.mockImplementation(async () => {
      sourceCreated = true
      return { id: 'source-one', name: 'Playlist任务' }
    })
    mocks.createDownloadCommand.mockImplementation((input) => {
      expect(sourceCreated).toBe(true)
      expect(input.sourceContext).toEqual({ id: 'source-one', name: 'Playlist · 下载并托管' })
      expect(input.config.target).toEqual({ kind: 'computed', requireManagedCopy: true })
      return { batchId: 'run-one', total: 1, selectionFailures: [] }
    })
    const { startSourceAttributedResourceDownload } = await import('./save-source-download-command')

    const result = await startSourceAttributedResourceDownload({
      type: 'playlist',
      neteaseId: 88,
      selectedSongIds: [1],
      name: 'Playlist',
      config: fakeConfig(),
    })

    expect(mocks.createSource).toHaveBeenCalledWith(88, 'cookie', expect.objectContaining({
      type: 'playlist',
      enabled: false,
      name: 'Playlist',
    }))
    expect(result).toMatchObject({ sourceId: 'source-one', batchId: 'run-one', total: 1 })
  })

  it('rolls back the newly-created disabled source when task persistence fails', async () => {
    mocks.createDownloadCommand.mockImplementation(() => { throw new Error('queue unavailable') })
    const { startSourceAttributedResourceDownload } = await import('./save-source-download-command')

    await expect(startSourceAttributedResourceDownload({
      type: 'playlist',
      neteaseId: 88,
      selectedSongIds: [1],
      name: 'Playlist',
      config: fakeConfig(),
    })).rejects.toThrow('queue unavailable')
    expect(mocks.deleteSource).toHaveBeenCalledWith('source-one')
  })
})

function fakeConfig(): any {
  return {
    netease: { cookie: 'cookie', quality: 'lossless' },
    download: { dir: '/music', downloadLyrics: true, embedMetadata: true, embedCover: true },
    other: { pathFormat: '{title}', multiArtistFormat: 'first', artistAliases: {}, applyAliasToAlbum: false },
  }
}
