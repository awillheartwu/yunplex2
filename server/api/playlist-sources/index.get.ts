import { success } from '../../lib/response'
import { listSources } from '../../lib/playlist/store'
import { parsePlaylistSourceFilters } from '../../lib/api-filter-params'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  return success(listSources(parsePlaylistSourceFilters(query)))
})
