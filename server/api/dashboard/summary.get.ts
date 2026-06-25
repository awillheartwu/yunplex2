import { success } from '../../lib/response'
import { getDashboardSummary } from '../../lib/dashboard/summary'

export default defineEventHandler(async () => {
  return success(await getDashboardSummary())
})
