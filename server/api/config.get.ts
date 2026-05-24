import { readConfig } from '../lib/config/store'
import { success } from '../lib/response'

export default defineEventHandler(() => {
  return success(readConfig())
})
