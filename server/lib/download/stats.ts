import { getDb } from '../db'

export interface DailyDownloadPoint {
  date: string
  count: number
}

export function getDailyDownloadStats(days = 7): DailyDownloadPoint[] {
  const normalizedDays = Math.min(Math.max(days, 1), 90)
  const db = getDb()
  const rows = db.prepare(`
    SELECT DATE(updated_at) as date, COUNT(*) as count
    FROM download_tasks
    WHERE status = 'done' AND updated_at >= DATE('now', ? || ' days')
    GROUP BY DATE(updated_at)
    ORDER BY date ASC
  `).all(`-${normalizedDays}`) as DailyDownloadPoint[]

  const result: DailyDownloadPoint[] = []
  const now = new Date()
  for (let i = normalizedDays - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const found = rows.find((row) => row.date === dateStr)
    result.push({ date: dateStr, count: found ? found.count : 0 })
  }

  return result
}
