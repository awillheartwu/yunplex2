import { success } from '../../lib/response'
import { getDb } from '../../lib/db'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const days = Math.min(parseInt(query.days as string, 10) || 7, 90)

  const db = getDb()
  const rows = db.prepare(`
    SELECT DATE(updated_at) as date, COUNT(*) as count
    FROM download_tasks
    WHERE status = 'done' AND updated_at >= DATE('now', ? || ' days')
    GROUP BY DATE(updated_at)
    ORDER BY date ASC
  `).all(`-${days}`) as { date: string; count: number }[]

  // Fill in missing dates with zero
  const result: { date: string; count: number }[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const found = rows.find((r) => r.date === dateStr)
    result.push({ date: dateStr, count: found ? found.count : 0 })
  }

  return success(result)
})
