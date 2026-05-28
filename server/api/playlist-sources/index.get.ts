import { success } from '../../lib/response'
import { listSources } from '../../lib/playlist/store'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const enabledOnly = query.enabled === '1'
  return success(listSources(enabledOnly))
})
