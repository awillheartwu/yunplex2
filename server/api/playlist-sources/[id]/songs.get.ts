import { success, fail } from '../../../lib/response'
import { getSource } from '../../../lib/playlist/store'
import { getDb } from '../../../lib/db'

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

  const jobRow = getDb().prepare('SELECT data FROM jobs WHERE id = ?').get(source.lastJobId) as { data: string } | undefined
  if (!jobRow) return success([])

  try {
    const data = JSON.parse(jobRow.data)
    const songs: JobSong[] = data.songs || []
    const filtered = songs.filter((s) => !s.sourceId || s.sourceId === id)
    return success(filtered)
  } catch {
    return success([])
  }
})
