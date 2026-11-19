import { DEFAULT_CONFIG } from '../../lib/config/defaults'
import { success } from '../../lib/response'

export default defineEventHandler(() => {
  return success(DEFAULT_CONFIG)
})
