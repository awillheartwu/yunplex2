import { success } from '../../lib/response'
import { getDailyDownloadStats } from '../../lib/download/stats'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const days = Math.min(parseInt(query.days as string, 10) || 7, 90)
  return success(getDailyDownloadStats(days))
})
