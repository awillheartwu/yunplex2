import { success } from '../../lib/response'
import { listTaskSourceOptions } from '../../lib/task-filter-options'

export default defineEventHandler(() => {
  return success({ sources: listTaskSourceOptions() })
})
