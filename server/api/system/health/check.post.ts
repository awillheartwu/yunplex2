import { success } from '../../../lib/response'
import { getDependencyHealthSnapshot } from '../../../lib/system-health'

export default defineEventHandler(async () => {
  return success(await getDependencyHealthSnapshot({ force: true }))
})
