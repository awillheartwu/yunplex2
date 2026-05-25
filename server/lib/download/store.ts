import { getDb } from '../db'

export interface DownloadRecord {
  id: string
  songName: string
  artist: string
  album: string
  filePath?: string
  fileType?: string
  quality?: string
  status: string
  downloadedAt: string
  jobId?: string
}

export function saveDownload(record: DownloadRecord): void {
  const db = getDb()
  db.prepare(`
    INSERT OR REPLACE INTO downloads (id, song_name, artist, album, file_path, file_type, quality, status, downloaded_at, job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.songName, record.artist, record.album,
    record.filePath ?? null, record.fileType ?? null, record.quality ?? null,
    record.status, record.downloadedAt, record.jobId ?? null,
  )
}

export function listDownloads(limit = 50, offset = 0): { items: DownloadRecord[]; total: number } {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as cnt FROM downloads').get() as { cnt: number }).cnt
  const rows = db.prepare(
    'SELECT * FROM downloads ORDER BY downloaded_at DESC LIMIT ? OFFSET ?',
  ).all(limit, offset) as Array<{
    id: string; song_name: string; artist: string; album: string
    file_path: string | null; file_type: string | null; quality: string | null
    status: string; downloaded_at: string; job_id: string | null
  }>
  return {
    items: rows.map((r) => ({
      id: r.id, songName: r.song_name, artist: r.artist, album: r.album,
      filePath: r.file_path ?? undefined, fileType: r.file_type ?? undefined,
      quality: r.quality ?? undefined, status: r.status,
      downloadedAt: r.downloaded_at, jobId: r.job_id ?? undefined,
    })),
    total,
  }
}

export function clearDownloads(): void {
  getDb().prepare('DELETE FROM downloads').run()
}
