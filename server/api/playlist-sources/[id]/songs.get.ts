import { success, fail } from '../../../lib/response'
import { getSource } from '../../../lib/playlist/store'
import { getRun } from '../../../lib/run/store'

interface JobSong {
  id: string
  sourceId?: string
  songName: string
  artist: string
  album: string
  status: string
}

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return fail('缺少 ID')

  const source = getSource(id)
  if (!source) return fail('歌单源不存在')
  if (!source.lastJobId) return success([])

  const run = getRun(source.lastJobId)
  if (!run) return success([])

  const songs: JobSong[] = run.songs || []
  const filtered = songs.filter((s) => !s.sourceId || s.sourceId === id)
  return success(filtered)
})
