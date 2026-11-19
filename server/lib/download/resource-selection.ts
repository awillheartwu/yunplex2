import {
  fetchAlbumSongs,
  fetchPlaylistSongs,
  fetchSongDetail,
  type NeteaseSong,
} from '../netease'

export type DownloadResourceType = 'playlist' | 'album' | 'songs'

export interface ResourceSelectionFailure {
  songId: number
  reason: string
}

export interface DownloadResourceSelection {
  type: DownloadResourceType
  resourceId?: number
  sourceLabel: string
  songs: NeteaseSong[]
  failures: ResourceSelectionFailure[]
}

export interface SelectDownloadResourceInput {
  type: DownloadResourceType
  resourceId?: number
  selectedSongIds?: number[]
  cookie: string
}

function validUniqueSongIds(ids: number[] | undefined): number[] | undefined {
  if (ids === undefined) return undefined
  const unique: number[] = []
  const seen = new Set<number>()
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

function uniqueSnapshot(songs: NeteaseSong[]): NeteaseSong[] {
  const seen = new Set<number>()
  return songs.filter((song) => {
    if (seen.has(song.id)) return false
    seen.add(song.id)
    return true
  })
}

function filterSnapshot(
  songs: NeteaseSong[],
  selectedSongIds: number[] | undefined,
): { songs: NeteaseSong[]; failures: ResourceSelectionFailure[] } {
  const snapshot = uniqueSnapshot(songs)
  if (selectedSongIds === undefined) return { songs: snapshot, failures: [] }
  const selected = new Set(selectedSongIds)
  const available = new Set(snapshot.map(song => song.id))
  return {
    songs: snapshot.filter(song => selected.has(song.id)),
    failures: selectedSongIds
      .filter(id => !available.has(id))
      .map(songId => ({ songId, reason: '歌曲不在最新资源快照中' })),
  }
}

async function selectIndividualSongs(ids: number[], cookie: string): Promise<{
  songs: NeteaseSong[]
  failures: ResourceSelectionFailure[]
}> {
  const results: Array<NeteaseSong | ResourceSelectionFailure | undefined> = new Array(ids.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(8, ids.length) }, async () => {
    while (cursor < ids.length) {
      const index = cursor++
      const songId = ids[index]
      if (songId === undefined) continue
      try {
        results[index] = await fetchSongDetail(songId, cookie)
      } catch (error) {
        results[index] = {
          songId,
          reason: error instanceof Error ? error.message : '获取歌曲信息失败',
        }
      }
    }
  })
  await Promise.all(workers)
  return {
    songs: results.filter((result): result is NeteaseSong => Boolean(result && 'id' in result)),
    failures: results.filter((result): result is ResourceSelectionFailure => Boolean(result && 'songId' in result)),
  }
}

/** Resolve every manual/managed download resource into one ordered song model. */
export async function selectDownloadResource(
  input: SelectDownloadResourceInput,
): Promise<DownloadResourceSelection> {
  const selectedSongIds = validUniqueSongIds(input.selectedSongIds)
  if (selectedSongIds?.length === 0) throw new Error('请至少选择一首歌曲')

  if (input.type === 'songs') {
    if (!selectedSongIds) throw new Error('单曲下载需要提供歌曲 ID')
    const selected = await selectIndividualSongs(selectedSongIds, input.cookie)
    return {
      type: input.type,
      sourceLabel: `${selectedSongIds.length} 首单曲`,
      ...selected,
    }
  }

  if (!Number.isSafeInteger(input.resourceId) || (input.resourceId ?? 0) <= 0) {
    throw new Error(`${input.type} 下载需要提供资源 ID`)
  }
  const resourceId = input.resourceId!
  if (input.type === 'playlist') {
    const playlist = await fetchPlaylistSongs(resourceId, undefined, input.cookie)
    return {
      type: input.type,
      resourceId,
      sourceLabel: playlist.playlistName || `网易云歌单 ${resourceId}`,
      ...filterSnapshot(playlist.songs, selectedSongIds),
    }
  }

  const albumSongs = await fetchAlbumSongs(resourceId, input.cookie)
  return {
    type: input.type,
    resourceId,
    sourceLabel: albumSongs[0]?.album.name || `网易云专辑 ${resourceId}`,
    ...filterSnapshot(albumSongs, selectedSongIds),
  }
}
