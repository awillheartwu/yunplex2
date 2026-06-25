import { success } from '../../lib/response'
import { getSystemHealthSnapshot } from '../../lib/system-health'

export default defineEventHandler(async () => {
  return success(await getSystemHealthSnapshot())
})
